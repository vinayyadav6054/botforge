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
builder.Services.AddHostedService<DocumentStatusConsumer>();

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
builder.Services.Configure<RabbitMqOptions>(builder.Configuration.GetSection("RabbitMq"));
builder.Services.AddSingleton<IFileStorage, LocalFileStorage>();
builder.Services.AddSingleton<IEventPublisher, RabbitMqPublisher>();

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
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

app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/health", () => Results.Ok(new { status = "ok", service = "bots" }));

var allowedExtensions = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { ".pdf", ".txt", ".md", ".docx" };
const long maxFileBytes = 10 * 1024 * 1024;

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
    var name = (req.Name ?? "").Trim();
    if (name.Length == 0) return Results.BadRequest(new { error = "Name is required." });

    var bot = new Bot
    {
        TenantId = tenant.TenantId,
        Name = name,
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

bots.MapGet("/{botId:guid}/documents", async (Guid botId, AppDbContext db) =>
{
    if (!await db.Bots.AnyAsync(b => b.Id == botId)) return Results.NotFound();
    var docs = await db.Documents.Where(d => d.BotId == botId)
        .OrderByDescending(d => d.CreatedAt)
        .Select(d => DocumentDto.From(d)).ToListAsync();
    return Results.Ok(docs);
});

bots.MapPost("/{botId:guid}/documents", async (
    Guid botId, IFormFile file, AppDbContext db, ITenantContext tenant,
    IFileStorage storage, IEventPublisher publisher, ILogger<Program> log) =>
{
    // the global filter means a bot of another tenant simply "does not exist" here
    if (!await db.Bots.AnyAsync(b => b.Id == botId)) return Results.NotFound();

    if (file.Length == 0) return Results.BadRequest(new { error = "File is empty." });
    if (file.Length > maxFileBytes) return Results.BadRequest(new { error = "File is larger than 10 MB." });

    var ext = Path.GetExtension(file.FileName);
    if (!allowedExtensions.Contains(ext))
        return Results.BadRequest(new { error = "Allowed types: .pdf, .txt, .md, .docx" });

    var doc = new BotDocument
    {
        TenantId = tenant.TenantId,
        BotId = botId,
        FileName = Path.GetFileName(file.FileName),
        ContentType = file.ContentType,
        SizeBytes = file.Length
    };
    doc.StorageKey = $"{tenant.TenantId}/{botId}/{doc.Id}{ext.ToLowerInvariant()}";

    await using (var stream = file.OpenReadStream())
        await storage.SaveAsync(doc.StorageKey, stream);

    db.Documents.Add(doc);
    await db.SaveChangesAsync();

    try
    {
        await publisher.PublishAsync("document.uploaded", new DocumentUploaded(
            doc.Id, doc.TenantId, doc.BotId, doc.StorageKey, doc.FileName, doc.ContentType, DateTime.UtcNow));
    }
    catch (Exception ex)
    {
        log.LogError(ex, "Could not publish document.uploaded for {DocumentId}", doc.Id);
        doc.Status = "UploadedUnqueued";
        await db.SaveChangesAsync();
    }

    return Results.Accepted($"/bots/{botId}/documents/{doc.Id}", DocumentDto.From(doc));
}).DisableAntiforgery();

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