using System.Security.Cryptography;
using System.Text;
using Bots.Api;
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

bots.MapPost("/", async (CreateBotRequest req, AppDbContext db, ITenantContext tenant) =>
{
    var error = BotRules.Validate(req.Name, req.WelcomeMessage);
    if (error is not null) return Results.BadRequest(new { error });

    var bot = new Bot
    {
        TenantId = tenant.TenantId,
        Name = req.Name!.Trim(),
        PublicKey = "bk_" + Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant()
    };
    if (!string.IsNullOrWhiteSpace(req.WelcomeMessage))
        bot.WelcomeMessage = req.WelcomeMessage.Trim();

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

    var error = BotRules.Validate(req.Name, req.WelcomeMessage);
    if (error is not null) return Results.BadRequest(new { error });

    bot.Name = req.Name!.Trim();
    if (!string.IsNullOrWhiteSpace(req.WelcomeMessage))
        bot.WelcomeMessage = req.WelcomeMessage.Trim();
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
    IFileStorage storage, IEventPublisher publisher, ILogger<Program> log) =>
{
    // the global filter means a bot of another tenant simply "does not exist" here
    if (!await db.Bots.AnyAsync(b => b.Id == botId)) return Results.NotFound();

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

    var queued = await TryPublishAsync(publisher, log, "document.uploaded", DocumentUploaded.From(doc));
    doc.Status = queued ? "Uploaded" : "UploadedUnqueued";
    doc.Error = null;
    doc.ChunkCount = null;
    await db.SaveChangesAsync();
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

// Internal endpoint for other services (never expose this through the public gateway)
app.MapGet("/internal/bots/{publicKey}", async (string publicKey, HttpRequest request, AppDbContext db, IConfiguration config) =>
{
    var expected = config["Internal:ApiKey"] ?? "";
    var provided = request.Headers["X-Internal-Key"].ToString();
    if (expected.Length == 0 ||
        !CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(provided), Encoding.UTF8.GetBytes(expected)))
        return Results.Unauthorized();

    // no tenant in context for service-to-service calls, so bypass the filter on purpose
    var bot = await db.Bots.IgnoreQueryFilters()
        .Where(b => b.PublicKey == publicKey)
        .Select(b => new { botId = b.Id, tenantId = b.TenantId, name = b.Name, welcomeMessage = b.WelcomeMessage })
        .FirstOrDefaultAsync();

    return bot is null ? Results.NotFound() : Results.Ok(bot);
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
