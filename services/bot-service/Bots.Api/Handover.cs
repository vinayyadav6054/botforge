using System.Net.Http.Json;
using Bots.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Bots.Api;

/// <summary>
/// Human handover: the owner takes over a conversation and replies themselves; the bot stays quiet meanwhile.
/// The takeover lasts <see cref="Window"/> after the owner's last action, so a forgotten takeover never leaves a
/// customer without answers.
/// </summary>
public static class Handover
{
    public static readonly TimeSpan Window = TimeSpan.FromHours(2);
    public const int MaxReplyChars = 2000;

    public static bool IsHuman(Conversation c, DateTime now) => c.HumanUntil is { } until && until > now;

    public static void MapHandoverEndpoints(this RouteGroupBuilder bots, WebApplication app)
    {
        bots.MapPost("/{botId:guid}/conversations/{conversationId:guid}/takeover", async (Guid botId, Guid conversationId,
            AppDbContext db, TimeProvider clock) =>
        {
            var c = await db.Conversations.FirstOrDefaultAsync(x => x.Id == conversationId && x.BotId == botId);
            if (c is null) return Results.NotFound();
            var now = clock.GetUtcNow().UtcDateTime;
            c.HumanUntil = now + Window;
            await db.SaveChangesAsync();
            return Results.Ok(new HandoverState(true, c.HumanUntil));
        });

        bots.MapPost("/{botId:guid}/conversations/{conversationId:guid}/release", async (Guid botId, Guid conversationId,
            AppDbContext db) =>
        {
            var c = await db.Conversations.FirstOrDefaultAsync(x => x.Id == conversationId && x.BotId == botId);
            if (c is null) return Results.NotFound();
            c.HumanUntil = null;
            await db.SaveChangesAsync();
            return Results.Ok(new HandoverState(false, null));
        });

        // the owner's reply: shown in the website chat on its next check, or sent through the messaging app at once
        bots.MapPost("/{botId:guid}/conversations/{conversationId:guid}/reply", async (Guid botId, Guid conversationId,
            AgentReplyRequest req, AppDbContext db, ChatRelay relay, TimeProvider clock, CancellationToken ct) =>
        {
            var text = req.Text?.Trim() ?? "";
            if (text.Length is 0 or > MaxReplyChars) return Results.BadRequest(new { error = $"Write a reply of 1-{MaxReplyChars} characters." });
            var c = await db.Conversations.FirstOrDefaultAsync(x => x.Id == conversationId && x.BotId == botId, ct);
            if (c is null) return Results.NotFound();
            if (c.MessageCount >= ConversationRules.MaxMessagesPerConversation)
                return Results.BadRequest(new { error = "This conversation is too long to continue here." });

            if (c.Channel != "web")
            {
                var channel = await db.Channels.Where(x => x.BotId == botId && x.Kind == c.Channel)
                    .OrderBy(x => x.CreatedAt).Select(x => (Guid?)x.Id).FirstOrDefaultAsync(ct);
                if (channel is null || c.ContactId is null)
                    return Results.BadRequest(new { error = "This messaging app is no longer connected." });
                var error = await relay.SendAsync(channel.Value, c.ContactId, text, ct);
                if (error is not null) return Results.Json(new { error }, statusCode: StatusCodes.Status502BadGateway);
            }

            var now = clock.GetUtcNow().UtcDateTime;
            var message = new ConversationMessage { ConversationId = c.Id, TenantId = c.TenantId, Role = "agent", Text = text, CreatedAt = now };
            db.ConversationMessages.Add(message);
            c.MessageCount += 1;
            c.LastMessageAt = now;
            c.HumanUntil = now + Window;   // replying takes over (or keeps it)
            await db.SaveChangesAsync(ct);
            return Results.Ok(new ConversationMessageDto(message.Role, message.Text, true, message.CreatedAt));
        });

        // ---------- internal: the chat service asks before answering, and the widget polls for the owner's replies ----------

        app.MapGet("/internal/bots/{publicKey}/conversations/{conversationId:guid}/updates", async (string publicKey,
            Guid conversationId, DateTime? after, HttpRequest request, AppDbContext db, IConfiguration config, TimeProvider clock) =>
        {
            if (!KeyCheck.HasInternalKey(request, config)) return Results.Unauthorized();
            var botId = await db.Bots.IgnoreQueryFilters().Where(b => b.PublicKey == publicKey).Select(b => (Guid?)b.Id).FirstOrDefaultAsync();
            if (botId is null) return Results.NotFound();
            var c = await db.Conversations.IgnoreQueryFilters()
                .Where(x => x.Id == conversationId && x.BotId == botId)
                .Select(x => new { x.Id, x.HumanUntil }).FirstOrDefaultAsync();
            // unknown conversation: nothing to report (a new visitor), not an error
            if (c is null) return Results.Ok(new HandoverUpdates(false, []));
            var since = (after ?? DateTime.MinValue).ToUniversalTime();
            var messages = await db.ConversationMessages.IgnoreQueryFilters()
                .Where(m => m.ConversationId == c.Id && m.Role == "agent" && m.CreatedAt > since)
                .OrderBy(m => m.CreatedAt).Take(50)
                .Select(m => new AgentMessageDto(m.Text, m.CreatedAt)).ToListAsync();
            var human = c.HumanUntil is { } until && until > clock.GetUtcNow().UtcDateTime;
            return Results.Ok(new HandoverUpdates(human, messages));
        });
    }
}

public record HandoverState(bool Human, DateTime? HumanUntil);
public record AgentReplyRequest(string? Text);
public record AgentMessageDto(string Text, DateTime CreatedAt);
public record HandoverUpdates(bool Human, List<AgentMessageDto> Messages);

/// <summary>Sends the owner's reply through a messaging app, using the chat service (which talks to the platforms).</summary>
public class ChatRelay(HttpClient http, IConfiguration config)
{
    /// <summary>null when sent, otherwise what went wrong.</summary>
    public async Task<string?> SendAsync(Guid channelId, string to, string text, CancellationToken ct)
    {
        var url = $"{(config["Services:ChatUrl"] ?? "http://localhost:8000").TrimEnd('/')}/internal/channels/{channelId}/send";
        using var msg = new HttpRequestMessage(HttpMethod.Post, url) { Content = JsonContent.Create(new { to, text }) };
        msg.Headers.Add("X-Internal-Key", config["Internal:ApiKey"] ?? "");
        try
        {
            using var res = await http.SendAsync(msg, ct);
            if (res.IsSuccessStatusCode) return null;
            var body = await res.Content.ReadFromJsonAsync<Dictionary<string, object?>>(ct).ConfigureAwait(false);
            return body?.GetValueOrDefault("detail")?.ToString() ?? "The messaging app did not accept the message.";
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException)
        {
            return "The messaging app could not be reached. Try again in a moment.";
        }
    }
}
