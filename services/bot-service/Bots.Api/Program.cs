using System.Security.Cryptography;
using System.Text;
using Bots.Api;
using Bots.Api.Billing;
using Bots.Api.Data;
using Bots.Api.Messaging;
using Bots.Api.Storage;
using Bots.Api.Tenancy;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

var jwtKey = builder.Configuration["Jwt:Key"];
if (string.IsNullOrEmpty(jwtKey) || jwtKey.Length < 32)
    throw new InvalidOperationException("Jwt:Key must be set (same as identity service) and 32+ characters.");

builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ITenantContext, TenantContext>();

builder.Services.AddDbContext<AppDbContext>(o =>
    o.UseNpgsql(builder.Configuration.GetConnectionString("Default"),
            n => n.MigrationsHistoryTable("__EFMigrationsHistory", "bots"))
     .UseSnakeCaseNamingConvention());

builder.Services.Configure<StorageOptions>(builder.Configuration.GetSection("Storage"));
builder.Services.PostConfigure<StorageOptions>(o =>
    // a relative path is relative to the project folder, not to wherever `dotnet run` was started
    o.RootPath = Path.GetFullPath(o.RootPath, builder.Environment.ContentRootPath));
builder.Services.Configure<RabbitMqOptions>(builder.Configuration.GetSection("RabbitMq"));
builder.Services.AddSingleton<IFileStorage, LocalFileStorage>();
builder.Services.AddSingleton<IEventPublisher, RabbitMqPublisher>();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddScoped<SubscriptionService>();
builder.Services.Configure<RazorpayOptions>(builder.Configuration.GetSection("Razorpay"));
builder.Services.AddHttpClient<IRazorpayClient, RazorpayClient>(c => c.Timeout = TimeSpan.FromSeconds(20));
builder.Services.AddHostedService<ConversationCleanup>();
if (builder.Configuration.GetValue("RabbitMq:ConsumeStatusEvents", true))
    builder.Services.AddHostedService<DocumentStatusConsumer>();

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.MapInboundClaims = false;
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = builder.Configuration["Jwt:Issuer"],
            ValidateAudience = true,
            ValidAudience = builder.Configuration["Jwt:Audience"],
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey)),
            ValidateLifetime = true,
            NameClaimType = "sub",
            RoleClaimType = "role"
        };
    });
builder.Services.AddAuthorization();

var app = builder.Build();

if (app.Configuration.GetValue("Database:MigrateOnStartup", true))
{
    using var scope = app.Services.CreateScope();
    scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.Migrate();
}

app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/health", () => Results.Ok(new { status = "ok", service = "bots" }));

// every /bots endpoint needs a valid token that carries a tenant id
var bots = app.MapGroup("/bots")
    .RequireAuthorization()
    .AddEndpointFilter(async (ctx, next) =>
    {
        var tenant = ctx.HttpContext.RequestServices.GetRequiredService<ITenantContext>();
        if (tenant.TenantId == Guid.Empty) return Results.Forbid();
        return await next(ctx);
    });

bots.MapPost("/", async (CreateBotRequest req, AppDbContext db, ITenantContext tenant, SubscriptionService subs) =>
{
    var error = BotRules.Validate(req.Name, req.WelcomeMessage) ?? BotRules.ValidateQuestions(req.SuggestedQuestions);
    if (error is not null) return Results.BadRequest(new { error });
    if (await subs.CheckBotLimitAsync(tenant.TenantId) is { } limit)
        return Results.Json(new { error = limit, code = "plan_limit" }, statusCode: StatusCodes.Status402PaymentRequired);

    var bot = new Bot
    {
        TenantId = tenant.TenantId,
        Name = req.Name!.Trim(),
        PublicKey = "bk_" + Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant()
    };
    if (!string.IsNullOrWhiteSpace(req.WelcomeMessage))
        bot.WelcomeMessage = req.WelcomeMessage.Trim();
    if (req.SuggestedQuestions is not null)
        bot.SuggestedQuestions = BotRules.NormalizeQuestions(req.SuggestedQuestions);

    db.Bots.Add(bot);
    await db.SaveChangesAsync();
    return Results.Created($"/bots/{bot.Id}", BotDto.From(bot));
});

bots.MapGet("/", async (AppDbContext db) =>
    Results.Ok(await db.Bots.OrderByDescending(b => b.CreatedAt).Select(b => BotDto.From(b)).ToListAsync()));

bots.MapGet("/{id:guid}", async (Guid id, AppDbContext db) =>
{
    var bot = await db.Bots.FirstOrDefaultAsync(b => b.Id == id);
    return bot is null ? Results.NotFound() : Results.Ok(BotDto.From(bot));
});

bots.MapPut("/{id:guid}", async (Guid id, CreateBotRequest req, AppDbContext db) =>
{
    var bot = await db.Bots.FirstOrDefaultAsync(b => b.Id == id);
    if (bot is null) return Results.NotFound();

    var error = BotRules.Validate(req.Name, req.WelcomeMessage)
                ?? LeadRules.ValidateSettings(req.LeadPrompt, req.LeadAfterMessages)
                ?? BotRules.ValidateQuestions(req.SuggestedQuestions);
    if (error is not null) return Results.BadRequest(new { error });

    bot.Name = req.Name!.Trim();
    if (!string.IsNullOrWhiteSpace(req.WelcomeMessage))
        bot.WelcomeMessage = req.WelcomeMessage.Trim();
    if (req.LeadCaptureEnabled is { } enabled) bot.LeadCaptureEnabled = enabled;
    if (req.LeadPrompt is not null)
        bot.LeadPrompt = string.IsNullOrWhiteSpace(req.LeadPrompt) ? LeadRules.DefaultPrompt : req.LeadPrompt.Trim();
    if (req.LeadAfterMessages is { } after) bot.LeadAfterMessages = after;
    if (req.SuggestedQuestions is not null)
        bot.SuggestedQuestions = BotRules.NormalizeQuestions(req.SuggestedQuestions);
    await db.SaveChangesAsync();
    return Results.Ok(BotDto.From(bot));
});

bots.MapDelete("/{id:guid}", async (
    Guid id, AppDbContext db, IFileStorage storage, IEventPublisher publisher, ILogger<Program> log) =>
{
    var bot = await db.Bots.FirstOrDefaultAsync(b => b.Id == id);
    if (bot is null) return Results.NotFound();

    var keys = await db.Documents.Where(d => d.BotId == id).Select(d => d.StorageKey).ToListAsync();
    db.Bots.Remove(bot);   // documents cascade in the database
    await db.SaveChangesAsync();

    foreach (var key in keys)
        await storage.DeleteAsync(key);
    await TryPublishAsync(publisher, log, "bot.deleted", new BotDeleted(bot.Id, bot.TenantId));
    return Results.NoContent();
});

bots.MapGet("/{botId:guid}/documents", async (Guid botId, AppDbContext db) =>
{
    if (!await db.Bots.AnyAsync(b => b.Id == botId)) return Results.NotFound();
    var docs = await db.Documents.Where(d => d.BotId == botId)
        .OrderByDescending(d => d.CreatedAt)
        .Select(d => DocumentDto.From(d)).ToListAsync();
    return Results.Ok(docs);
});

bots.MapGet("/{botId:guid}/documents/{docId:guid}", async (Guid botId, Guid docId, AppDbContext db) =>
{
    var doc = await db.Documents.FirstOrDefaultAsync(d => d.Id == docId && d.BotId == botId);
    return doc is null ? Results.NotFound() : Results.Ok(DocumentDto.From(doc));
});

bots.MapPost("/{botId:guid}/documents", async (
    Guid botId, IFormFile? file, AppDbContext db, ITenantContext tenant,
    IFileStorage storage, IEventPublisher publisher, SubscriptionService subs, ILogger<Program> log) =>
{
    // the global filter means a bot of another tenant simply "does not exist" here
    if (!await db.Bots.AnyAsync(b => b.Id == botId)) return Results.NotFound();
    if (await subs.CheckDocumentLimitAsync(tenant.TenantId) is { } limit)
        return Results.Json(new { error = limit, code = "plan_limit" }, statusCode: StatusCodes.Status402PaymentRequired);

    if (file is null) return Results.BadRequest(new { error = "Send the file as multipart form field 'file'." });
    if (file.Length == 0) return Results.BadRequest(new { error = "File is empty." });
    if (file.Length > DocumentRules.MaxFileBytes) return Results.BadRequest(new { error = "File is larger than 10 MB." });

    var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
    if (!DocumentRules.AllowedExtensions.Contains(ext))
        return Results.BadRequest(new { error = "Allowed types: .pdf, .txt, .md, .docx" });

    var doc = new BotDocument
    {
        TenantId = tenant.TenantId,
        BotId = botId,
        FileName = DocumentRules.SafeFileName(file.FileName),
        ContentType = DocumentRules.Truncate(string.IsNullOrEmpty(file.ContentType) ? "application/octet-stream" : file.ContentType, 150),
        SizeBytes = file.Length
    };
    doc.StorageKey = $"{tenant.TenantId}/{botId}/{doc.Id}{ext}";

    await using (var stream = file.OpenReadStream())
        await storage.SaveAsync(doc.StorageKey, stream);

    db.Documents.Add(doc);
    try
    {
        await db.SaveChangesAsync();
    }
    catch
    {
        await storage.DeleteAsync(doc.StorageKey);   // do not leave an orphan file behind
        throw;
    }

    if (!await TryPublishAsync(publisher, log, "document.uploaded", DocumentUploaded.From(doc)))
    {
        doc.Status = "UploadedUnqueued";
        await db.SaveChangesAsync();
    }

    return Results.Accepted($"/bots/{botId}/documents/{doc.Id}", DocumentDto.From(doc));
}).DisableAntiforgery();

// queue a document again, e.g. after a failure or when publishing to RabbitMQ did not work
bots.MapPost("/{botId:guid}/documents/{docId:guid}/reprocess", async (
    Guid botId, Guid docId, AppDbContext db, IEventPublisher publisher, ILogger<Program> log) =>
{
    var doc = await db.Documents.FirstOrDefaultAsync(d => d.Id == docId && d.BotId == botId);
    if (doc is null) return Results.NotFound();

    // save the new state BEFORE publishing: the worker can answer within milliseconds, and its
    // status event must not be overwritten by this request finishing afterwards
    doc.Status = "Uploaded";
    doc.Error = null;
    doc.ChunkCount = null;
    await db.SaveChangesAsync();

    if (!await TryPublishAsync(publisher, log, "document.uploaded", DocumentUploaded.From(doc)))
    {
        doc.Status = "UploadedUnqueued";
        await db.SaveChangesAsync();
    }
    return Results.Accepted($"/bots/{botId}/documents/{doc.Id}", DocumentDto.From(doc));
});

bots.MapDelete("/{botId:guid}/documents/{docId:guid}", async (
    Guid botId, Guid docId, AppDbContext db, IFileStorage storage, IEventPublisher publisher, ILogger<Program> log) =>
{
    var doc = await db.Documents.FirstOrDefaultAsync(d => d.Id == docId && d.BotId == botId);
    if (doc is null) return Results.NotFound();

    db.Documents.Remove(doc);
    await db.SaveChangesAsync();
    await storage.DeleteAsync(doc.StorageKey);
    await TryPublishAsync(publisher, log, "document.deleted", new DocumentDeleted(doc.Id, doc.TenantId, doc.BotId));
    return Results.NoContent();
});

// ---------- leads (dashboard) ----------

bots.MapGet("/{botId:guid}/leads", async (Guid botId, AppDbContext db) =>
{
    if (!await db.Bots.AnyAsync(b => b.Id == botId)) return Results.NotFound();
    var leads = await db.Leads.Where(l => l.BotId == botId)
        .OrderByDescending(l => l.CreatedAt).Take(1000)
        .Select(l => LeadDto.From(l)).ToListAsync();
    return Results.Ok(leads);
});

bots.MapPatch("/{botId:guid}/leads/{leadId:guid}", async (Guid botId, Guid leadId, UpdateLeadRequest req, AppDbContext db) =>
{
    var lead = await db.Leads.FirstOrDefaultAsync(l => l.Id == leadId && l.BotId == botId);
    if (lead is null) return Results.NotFound();
    if (req.Status is null || !LeadStatus.All.Contains(req.Status))
        return Results.BadRequest(new { error = $"Status must be one of: {string.Join(", ", LeadStatus.All)}." });
    lead.Status = req.Status;
    await db.SaveChangesAsync();
    return Results.Ok(LeadDto.From(lead));
});

// a visitor may ask for their data to be removed
bots.MapDelete("/{botId:guid}/leads/{leadId:guid}", async (Guid botId, Guid leadId, AppDbContext db) =>
{
    var lead = await db.Leads.FirstOrDefaultAsync(l => l.Id == leadId && l.BotId == botId);
    if (lead is null) return Results.NotFound();
    db.Leads.Remove(lead);
    await db.SaveChangesAsync();
    return Results.NoContent();
});

bots.MapGet("/{botId:guid}/leads/export", async (Guid botId, AppDbContext db) =>
{
    var bot = await db.Bots.FirstOrDefaultAsync(b => b.Id == botId);
    if (bot is null) return Results.NotFound();
    var leads = await db.Leads.Where(l => l.BotId == botId).OrderByDescending(l => l.CreatedAt).ToListAsync();
    var bytes = Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(LeadCsv.Build(leads))).ToArray(); // BOM: Excel reads UTF-8
    return Results.File(bytes, "text/csv; charset=utf-8", $"leads-{DateTime.UtcNow:yyyy-MM-dd}.csv");
});

// ---------- conversations (dashboard) ----------

bots.MapGet("/{botId:guid}/conversations", async (Guid botId, DateTime? before, int? take, AppDbContext db) =>
{
    if (!await db.Bots.AnyAsync(b => b.Id == botId)) return Results.NotFound();
    var size = Math.Clamp(take ?? 30, 1, 100);
    var query = db.Conversations.Where(c => c.BotId == botId);
    if (before is { } b) query = query.Where(c => c.LastMessageAt < b.ToUniversalTime());
    var list = await query.OrderByDescending(c => c.LastMessageAt).Take(size)
        .Select(c => new ConversationSummaryDto(c.Id, c.StartedAt, c.LastMessageAt, c.MessageCount, c.UnansweredCount,
            c.Messages.Where(m => m.Role == "user").OrderBy(m => m.CreatedAt).Select(m => m.Text).FirstOrDefault(),
            c.PageUrl))
        .ToListAsync();
    return Results.Ok(list);
});

bots.MapGet("/{botId:guid}/conversations/{conversationId:guid}", async (Guid botId, Guid conversationId, AppDbContext db) =>
{
    var c = await db.Conversations.Include(x => x.Messages).FirstOrDefaultAsync(x => x.Id == conversationId && x.BotId == botId);
    if (c is null) return Results.NotFound();
    return Results.Ok(new ConversationDto(c.Id, c.StartedAt, c.LastMessageAt, c.PageUrl,
        c.Messages.OrderBy(m => m.CreatedAt).ThenBy(m => m.Role == "user" ? 0 : 1)
            .Select(m => new ConversationMessageDto(m.Role, m.Text, m.Answered, m.CreatedAt)).ToList()));
});

// a visitor may ask for their chat to be removed
bots.MapDelete("/{botId:guid}/conversations/{conversationId:guid}", async (Guid botId, Guid conversationId, AppDbContext db) =>
{
    var removed = await db.Conversations.Where(c => c.Id == conversationId && c.BotId == botId).ExecuteDeleteAsync();
    return removed == 0 ? Results.NotFound() : Results.NoContent();
});

app.MapAccountEndpoints();

// ---------- internal endpoints for other services (never expose these through the public gateway) ----------

app.MapGet("/internal/bots/{publicKey}", async (string publicKey, HttpRequest request, AppDbContext db, IConfiguration config,
    SubscriptionService subs) =>
{
    if (!KeyCheck.HasInternalKey(request, config)) return Results.Unauthorized();

    // no tenant in context for service-to-service calls, so bypass the filter on purpose
    var bot = await db.Bots.IgnoreQueryFilters()
        .Where(b => b.PublicKey == publicKey)
        .Select(b => new
        {
            botId = b.Id, tenantId = b.TenantId, name = b.Name, welcomeMessage = b.WelcomeMessage,
            leadCapture = new { enabled = b.LeadCaptureEnabled, prompt = b.LeadPrompt, afterMessages = b.LeadAfterMessages },
            suggestedQuestions = b.SuggestedQuestions
        })
        .FirstOrDefaultAsync();
    if (bot is null) return Results.NotFound();

    var plan = await subs.EffectivePlanAsync(bot.tenantId);
    return Results.Ok(new
    {
        bot.botId, bot.tenantId, bot.name, bot.welcomeMessage, bot.leadCapture, bot.suggestedQuestions,
        showBranding = !plan.RemoveBranding,
        active = plan.AnswersPerMonth > 0
    });
});

// the chat service asks before every AI answer: counts it if the plan's monthly limit allows
app.MapPost("/internal/bots/{publicKey}/answers", async (string publicKey, HttpRequest request, AppDbContext db,
    IConfiguration config, SubscriptionService subs) =>
{
    if (!KeyCheck.HasInternalKey(request, config)) return Results.Unauthorized();
    var tenantId = await db.Bots.IgnoreQueryFilters().Where(b => b.PublicKey == publicKey)
        .Select(b => (Guid?)b.TenantId).FirstOrDefaultAsync();
    if (tenantId is null) return Results.NotFound();

    var plan = await subs.EffectivePlanAsync(tenantId.Value);
    if (plan.AnswersPerMonth == 0) return Results.Ok(new { allowed = false, reason = "inactive" });
    var allowed = await subs.TryConsumeAnswerAsync(tenantId.Value, plan.AnswersPerMonth);
    return Results.Ok(new { allowed, reason = allowed ? null : "limit" });
});

// the AI call failed after the answer was counted: the visitor got an error, so it does not count
app.MapPost("/internal/bots/{publicKey}/answers/refund", async (string publicKey, HttpRequest request, AppDbContext db,
    IConfiguration config, SubscriptionService subs) =>
{
    if (!KeyCheck.HasInternalKey(request, config)) return Results.Unauthorized();
    var tenantId = await db.Bots.IgnoreQueryFilters().Where(b => b.PublicKey == publicKey)
        .Select(b => (Guid?)b.TenantId).FirstOrDefaultAsync();
    if (tenantId is null) return Results.NotFound();
    await subs.RefundAnswerAsync(tenantId.Value);
    return Results.NoContent();
});

// the chat service stores each question and answer so the owner can read the conversations
app.MapPost("/internal/bots/{publicKey}/conversations", async (string publicKey, RecordTurnRequest req, HttpRequest request,
    AppDbContext db, IConfiguration config, TimeProvider clock) =>
{
    if (!KeyCheck.HasInternalKey(request, config)) return Results.Unauthorized();
    if (ConversationRules.Validate(req) is { } error) return Results.BadRequest(new { error });

    var bot = await db.Bots.IgnoreQueryFilters().Where(b => b.PublicKey == publicKey)
        .Select(b => new { b.Id, b.TenantId }).FirstOrDefaultAsync();
    if (bot is null) return Results.NotFound();

    var now = clock.GetUtcNow().UtcDateTime;
    var conversation = await db.Conversations.IgnoreQueryFilters().FirstOrDefaultAsync(c => c.Id == req.ConversationId);
    if (conversation is null)
    {
        conversation = new Conversation
        {
            Id = req.ConversationId!.Value, TenantId = bot.TenantId, BotId = bot.Id,
            PageUrl = LeadRules.CleanPageUrl(req.PageUrl), StartedAt = now
        };
        db.Conversations.Add(conversation);
    }
    else if (conversation.BotId != bot.Id)
    {
        return Results.Conflict(new { error = "This conversation belongs to another bot." });
    }
    else if (conversation.MessageCount >= ConversationRules.MaxMessagesPerConversation)
    {
        return Results.Ok(new { stored = false });
    }

    db.ConversationMessages.AddRange(
        new ConversationMessage
        {
            ConversationId = conversation.Id, TenantId = bot.TenantId, Role = "user", Answered = req.Answered, CreatedAt = now,
            Text = DocumentRules.Truncate(req.Question!.Trim(), ConversationRules.MaxQuestionChars)
        },
        new ConversationMessage
        {
            ConversationId = conversation.Id, TenantId = bot.TenantId, Role = "assistant", Answered = req.Answered, CreatedAt = now,
            Text = DocumentRules.Truncate(req.Answer!.Trim(), ConversationRules.MaxAnswerChars)
        });
    conversation.MessageCount += 2;
    if (!req.Answered) conversation.UnansweredCount += 1;
    conversation.LastMessageAt = now;
    try
    {
        await db.SaveChangesAsync();
    }
    catch (DbUpdateException ex) when (ex.InnerException is Npgsql.PostgresException { SqlState: Npgsql.PostgresErrorCodes.UniqueViolation })
    {
        // the first two turns of a new conversation arrived at the same time; the visitor will not notice
        return Results.Conflict(new { error = "Retry." });
    }
    return Results.Ok(new { stored = true });
});

// a website visitor left their details in the widget (forwarded by the chat service)
app.MapPost("/internal/bots/{publicKey}/leads", async (
    string publicKey, CreateLeadRequest req, HttpRequest request, AppDbContext db, IConfiguration config) =>
{
    if (!KeyCheck.HasInternalKey(request, config)) return Results.Unauthorized();

    var bot = await db.Bots.IgnoreQueryFilters().FirstOrDefaultAsync(b => b.PublicKey == publicKey);
    if (bot is null) return Results.NotFound();
    if (!bot.LeadCaptureEnabled) return Results.Conflict(new { error = "This assistant is not collecting details." });

    var error = LeadRules.Validate(req, out var lead);
    if (error is not null) return Results.BadRequest(new { error });

    // the same person submitting twice (double click, page reload) must not create two leads
    var since = DateTime.UtcNow - LeadRules.DuplicateWindow;
    var existing = await db.Leads.IgnoreQueryFilters()
        .FirstOrDefaultAsync(l => l.BotId == bot.Id && l.Phone == lead.Phone && l.CreatedAt >= since);
    if (existing is not null) return Results.Ok(new { id = existing.Id, duplicate = true });

    lead.TenantId = bot.TenantId;
    lead.BotId = bot.Id;
    db.Leads.Add(lead);
    await db.SaveChangesAsync();
    return Results.Created($"/bots/{bot.Id}/leads/{lead.Id}", new { id = lead.Id, duplicate = false });
});

app.Run();

static async Task<bool> TryPublishAsync<T>(IEventPublisher publisher, ILogger log, string routingKey, T message)
{
    try
    {
        await publisher.PublishAsync(routingKey, message);
        return true;
    }
    catch (Exception ex)
    {
        log.LogError(ex, "Could not publish {RoutingKey}", routingKey);
        return false;
    }
}

public partial class Program;
