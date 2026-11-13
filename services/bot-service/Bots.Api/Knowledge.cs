using System.Text.RegularExpressions;
using Bots.Api.Billing;
using Bots.Api.Data;
using Bots.Api.Messaging;
using Bots.Api.Tenancy;
using Microsoft.EntityFrameworkCore;

namespace Bots.Api;

public record QaRequest(string? Question, string? Answer, string? FromQuestion = null);
public record QaDto(Guid Id, string Question, string Answer, DateTime UpdatedAt)
{
    public static QaDto From(QaEntry q) => new(q.Id, q.Question, q.Answer, q.UpdatedAt);
}
public record UnansweredDto(string Question, int Count, DateTime LastAskedAt);
public record DismissRequest(string? Question);
public record SourceRequest(string? Kind, string? Url, string? Token = null, int? SyncIntervalDays = null);

public static partial class SourceRules
{
    public const int MaxQaPerBot = 300;
    public static readonly int[] SyncIntervals = [0, 1, 7, 30];

    [GeneratedRegex(@"^https://docs\.google\.com/(document|spreadsheets|presentation)/d/[A-Za-z0-9_-]{20,}")]
    private static partial Regex GoogleDoc();
    [GeneratedRegex(@"^https://drive\.google\.com/(file/d/[A-Za-z0-9_-]{20,}|open\?id=[A-Za-z0-9_-]{20,})")]
    private static partial Regex GoogleDrive();
    [GeneratedRegex(@"^https://(www\.)?notion\.(so|site)/|^https://[a-z0-9-]+\.notion\.site/")]
    private static partial Regex Notion();
    [GeneratedRegex(@"^https://(www\.|m\.)?(youtube\.com/(watch\?v=|shorts/|live/)|youtu\.be/)[A-Za-z0-9_-]{11}")]
    private static partial Regex YouTube();

    /// <summary>Validates a new online source; returns (error, display name).</summary>
    public static (string? Error, string Name) Validate(SourceRequest r)
    {
        var url = (r.Url ?? "").Trim();
        if (url.Length is 0 or > 1000 || !Uri.TryCreate(url, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp) || string.IsNullOrEmpty(uri.Host))
            return ("Enter a full web address starting with https://", "");
        if (r.SyncIntervalDays is { } days && !SyncIntervals.Contains(days))
            return ("Sync interval must be 0, 1, 7 or 30 days.", "");

        switch (r.Kind)
        {
            case "website":
                return (null, uri.Host);
            case "google":
                if (!GoogleDoc().IsMatch(url) && !GoogleDrive().IsMatch(url))
                    return ("Paste a Google Docs, Sheets, Slides or Drive file link.", "");
                return (null, url.Contains("/spreadsheets/") ? "Google Sheet" : url.Contains("/presentation/") ? "Google Slides"
                    : url.Contains("drive.google.com") ? "Google Drive file" : "Google Doc");
            case "notion":
                if (!Notion().IsMatch(url)) return ("Paste a Notion page link (notion.so or notion.site).", "");
                if (string.IsNullOrWhiteSpace(r.Token) || r.Token.Length > 500)
                    return ("Paste your Notion integration secret (starts with ntn_ or secret_).", "");
                return (null, "Notion page");
            case "youtube":
                if (!YouTube().IsMatch(url)) return ("Paste a YouTube video link.", "");
                return (null, "YouTube video");
            default:
                return ("Kind must be website, google, notion or youtube.", "");
        }
    }

    public static string Key(string question) => Regex.Replace(question.Trim().ToLowerInvariant(), @"\s+", " ");
}

public static class KnowledgeEndpoints
{
    public static void MapKnowledgeEndpoints(this RouteGroupBuilder bots)
    {
        // ---------- Q&A: the owner's own answers ----------
        bots.MapGet("/{botId:guid}/qa", async (Guid botId, AppDbContext db) =>
        {
            if (!await db.Bots.AnyAsync(b => b.Id == botId)) return Results.NotFound();
            return Results.Ok(await db.QaEntries.Where(q => q.BotId == botId).OrderByDescending(q => q.UpdatedAt)
                .Select(q => QaDto.From(q)).ToListAsync());
        });

        bots.MapPost("/{botId:guid}/qa", async (Guid botId, QaRequest req, AppDbContext db, ITenantContext tenant,
            IEventPublisher publisher, ILogger<Program> log) =>
        {
            if (!await db.Bots.AnyAsync(b => b.Id == botId)) return Results.NotFound();
            if (ValidateQa(req) is { } error) return Results.BadRequest(new { error });
            if (await db.QaEntries.CountAsync(q => q.BotId == botId) >= SourceRules.MaxQaPerBot)
                return Results.BadRequest(new { error = $"A bot can have at most {SourceRules.MaxQaPerBot} answers." });

            var qa = new QaEntry { TenantId = tenant.TenantId, BotId = botId, Question = req.Question!.Trim(), Answer = req.Answer!.Trim() };
            db.QaEntries.Add(qa);
            await db.SaveChangesAsync();
            if (!string.IsNullOrWhiteSpace(req.FromQuestion)) await MarkAnsweredAsync(db, botId, req.FromQuestion);
            await Publish(publisher, log, "qa.upserted", new QaUpserted(qa.Id, qa.TenantId, qa.BotId, qa.Question, qa.Answer));
            return Results.Created($"/bots/{botId}/qa/{qa.Id}", QaDto.From(qa));
        });

        bots.MapPut("/{botId:guid}/qa/{qaId:guid}", async (Guid botId, Guid qaId, QaRequest req, AppDbContext db,
            IEventPublisher publisher, ILogger<Program> log) =>
        {
            var qa = await db.QaEntries.FirstOrDefaultAsync(q => q.Id == qaId && q.BotId == botId);
            if (qa is null) return Results.NotFound();
            if (ValidateQa(req) is { } error) return Results.BadRequest(new { error });
            qa.Question = req.Question!.Trim();
            qa.Answer = req.Answer!.Trim();
            qa.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            await Publish(publisher, log, "qa.upserted", new QaUpserted(qa.Id, qa.TenantId, qa.BotId, qa.Question, qa.Answer));
            return Results.Ok(QaDto.From(qa));
        });

        bots.MapDelete("/{botId:guid}/qa/{qaId:guid}", async (Guid botId, Guid qaId, AppDbContext db,
            IEventPublisher publisher, ILogger<Program> log) =>
        {
            var qa = await db.QaEntries.FirstOrDefaultAsync(q => q.Id == qaId && q.BotId == botId);
            if (qa is null) return Results.NotFound();
            db.QaEntries.Remove(qa);
            await db.SaveChangesAsync();
            await Publish(publisher, log, "qa.deleted", new QaDeleted(qa.Id, qa.TenantId, qa.BotId));
            return Results.NoContent();
        });

        // ---------- questions the documents could not answer (last 90 days) ----------
        bots.MapGet("/{botId:guid}/unanswered", async (Guid botId, AppDbContext db) =>
        {
            if (!await db.Bots.AnyAsync(b => b.Id == botId)) return Results.NotFound();
            var since = DateTime.UtcNow.AddDays(-90);
            var rows = await db.ConversationMessages
                .Where(m => m.Role == "user" && !m.Answered && m.CreatedAt >= since &&
                            db.Conversations.Any(c => c.Id == m.ConversationId && c.BotId == botId))
                .OrderByDescending(m => m.CreatedAt).Take(2000)
                .Select(m => new { m.Text, m.CreatedAt }).ToListAsync();
            var grouped = rows.GroupBy(r => SourceRules.Key(r.Text))
                .Select(g => new UnansweredDto(g.First().Text, g.Count(), g.First().CreatedAt))
                .OrderByDescending(u => u.Count).ThenByDescending(u => u.LastAskedAt).Take(50).ToList();
            return Results.Ok(grouped);
        });

        bots.MapPost("/{botId:guid}/unanswered/dismiss", async (Guid botId, DismissRequest req, AppDbContext db) =>
        {
            if (!await db.Bots.AnyAsync(b => b.Id == botId)) return Results.NotFound();
            if (string.IsNullOrWhiteSpace(req.Question)) return Results.BadRequest(new { error = "question is required." });
            return Results.Ok(new { updated = await MarkAnsweredAsync(db, botId, req.Question) });
        });

        // ---------- online sources: website, Google, Notion, YouTube ----------
        bots.MapPost("/{botId:guid}/sources", async (Guid botId, SourceRequest req, AppDbContext db, ITenantContext tenant,
            SubscriptionService subs, IEventPublisher publisher, ILogger<Program> log) =>
        {
            if (!await db.Bots.AnyAsync(b => b.Id == botId)) return Results.NotFound();
            var (error, name) = SourceRules.Validate(req);
            if (error is not null) return Results.BadRequest(new { error });
            if (await subs.CheckDocumentLimitAsync(tenant.TenantId) is { } limit)
                return Results.Json(new { error = limit, code = "plan_limit" }, statusCode: StatusCodes.Status402PaymentRequired);

            var plan = await subs.EffectivePlanAsync(tenant.TenantId);
            var doc = new BotDocument
            {
                TenantId = tenant.TenantId, BotId = botId, Kind = req.Kind!, FileName = name,
                SourceUrl = req.Url!.Trim(), SourceSecret = req.Kind == "notion" ? req.Token!.Trim() : null,
                ContentType = "text/html", StorageKey = "", SizeBytes = 0,
                MaxPages = req.Kind == "website" ? Math.Max(1, plan.WebsitePages) : 0,
                SyncIntervalDays = req.SyncIntervalDays ?? (req.Kind == "youtube" ? 0 : 7)
            };
            db.Documents.Add(doc);
            await db.SaveChangesAsync();
            if (!await Publish(publisher, log, "document.uploaded", DocumentUploaded.From(doc)))
            {
                doc.Status = "UploadedUnqueued";
                await db.SaveChangesAsync();
            }
            return Results.Accepted($"/bots/{botId}/documents/{doc.Id}", DocumentDto.From(doc));
        });

        bots.MapPatch("/{botId:guid}/sources/{docId:guid}", async (Guid botId, Guid docId, SourceRequest req, AppDbContext db) =>
        {
            var doc = await db.Documents.FirstOrDefaultAsync(d => d.Id == docId && d.BotId == botId && d.Kind != "file");
            if (doc is null) return Results.NotFound();
            if (req.SyncIntervalDays is not { } days || !SourceRules.SyncIntervals.Contains(days))
                return Results.BadRequest(new { error = "Sync interval must be 0, 1, 7 or 30 days." });
            doc.SyncIntervalDays = days;
            await db.SaveChangesAsync();
            return Results.Ok(DocumentDto.From(doc));
        });
    }

    private static string? ValidateQa(QaRequest r)
    {
        var q = (r.Question ?? "").Trim();
        var a = (r.Answer ?? "").Trim();
        if (q.Length is 0 or > 300) return "The question must be 1-300 characters.";
        if (a.Length is 0 or > 2000) return "The answer must be 1-2000 characters.";
        return null;
    }

    /// <summary>The owner has covered this question: it leaves the unanswered list.</summary>
    private static async Task<int> MarkAnsweredAsync(AppDbContext db, Guid botId, string question)
    {
        var key = SourceRules.Key(question);
        var ids = await db.ConversationMessages
            .Where(m => m.Role == "user" && !m.Answered && db.Conversations.Any(c => c.Id == m.ConversationId && c.BotId == botId))
            .Select(m => new { m.Id, m.Text }).ToListAsync();
        var match = ids.Where(m => SourceRules.Key(m.Text) == key).Select(m => m.Id).ToList();
        if (match.Count == 0) return 0;
        return await db.ConversationMessages.Where(m => match.Contains(m.Id))
            .ExecuteUpdateAsync(s => s.SetProperty(m => m.Answered, true));
    }

    private static async Task<bool> Publish<T>(IEventPublisher publisher, ILogger log, string key, T message)
    {
        try
        {
            await publisher.PublishAsync(key, message);
            return true;
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Could not publish {RoutingKey}", key);
            return false;
        }
    }
}

/// <summary>Re-fetches online sources whose sync interval has passed (checked every 30 minutes).</summary>
public class SourceSync(IServiceScopeFactory scopes, ILogger<SourceSync> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Delay(TimeSpan.FromMinutes(2), stoppingToken);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = scopes.CreateScope();
                await RunOnceAsync(scope.ServiceProvider, DateTime.UtcNow, stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogWarning(ex, "Source sync failed; retrying later");
            }
            await Task.Delay(TimeSpan.FromMinutes(30), stoppingToken);
        }
    }

    public static async Task<int> RunOnceAsync(IServiceProvider sp, DateTime now, CancellationToken ct = default)
    {
        var db = sp.GetRequiredService<AppDbContext>();
        var publisher = sp.GetRequiredService<IEventPublisher>();
        var subs = sp.GetRequiredService<SubscriptionService>();
        var due = await db.Documents.IgnoreQueryFilters()
            .Where(d => d.Kind != "file" && d.SyncIntervalDays > 0 && d.Status != "Uploaded" &&
                        (d.LastSyncedAt == null || d.LastSyncedAt < now.AddDays(-d.SyncIntervalDays)))
            .OrderBy(d => d.LastSyncedAt).Take(20).ToListAsync(ct);
        var queued = 0;
        foreach (var doc in due)
        {
            var plan = await subs.EffectivePlanAsync(doc.TenantId, ct);
            if (plan.AnswersPerMonth == 0) { doc.LastSyncedAt = now; continue; }   // inactive plan: no fetching
            if (doc.Kind == "website") doc.MaxPages = Math.Max(1, plan.WebsitePages);
            doc.Status = "Uploaded";
            doc.Error = null;
            await db.SaveChangesAsync(ct);
            try
            {
                await publisher.PublishAsync("document.uploaded", DocumentUploaded.From(doc), ct);
                queued++;
            }
            catch (Exception)
            {
                doc.Status = "UploadedUnqueued";
            }
        }
        await db.SaveChangesAsync(ct);
        return queued;
    }
}
