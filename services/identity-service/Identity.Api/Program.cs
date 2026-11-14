using System.Security.Claims;
using System.Text;
using Identity.Api.Accounts;
using Identity.Api.Auth;
using Identity.Api.Email;
using Identity.Api.Data;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using Npgsql;

var builder = WebApplication.CreateBuilder(args);

var jwt = builder.Configuration.GetSection("Jwt").Get<JwtOptions>()
          ?? throw new InvalidOperationException("Jwt section missing");
if (jwt.Key.Length < 32)
    throw new InvalidOperationException("Jwt:Key must be at least 32 characters");

builder.Services.Configure<JwtOptions>(builder.Configuration.GetSection("Jwt"));

builder.Services.AddDbContext<AppDbContext>(o =>
    o.UseNpgsql(builder.Configuration.GetConnectionString("Default"),
            n => n.MigrationsHistoryTable("__EFMigrationsHistory", "identity"))
     .UseSnakeCaseNamingConvention());

builder.Services.AddSingleton<TokenService>();
builder.Services.AddSingleton<IPasswordHasher<User>, PasswordHasher<User>>();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddScoped<AccountTokens>();
builder.Services.Configure<AppOptions>(builder.Configuration.GetSection("App"));
builder.Services.Configure<EmailOptions>(builder.Configuration.GetSection("Email"));
if (!string.IsNullOrWhiteSpace(builder.Configuration["Email:Brevo:ApiKey"]))
    builder.Services.AddHttpClient<IEmailSender, BrevoEmailSender>(c => c.Timeout = TimeSpan.FromSeconds(20));
else if (!string.IsNullOrWhiteSpace(builder.Configuration["Email:Smtp:Host"]))
    builder.Services.AddSingleton<IEmailSender, SmtpEmailSender>();
else
    builder.Services.AddSingleton<IEmailSender, LogEmailSender>();
builder.Services.AddHttpClient<IBotsClient, BotsClient>(c => c.Timeout = TimeSpan.FromSeconds(30));
builder.Services.AddHostedService<MonthlyReportService>();

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.MapInboundClaims = false;   // keep "sub", "email", "role" as-is instead of the long WS-* claim names
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = jwt.Issuer,
            ValidateAudience = true,
            ValidAudience = jwt.Audience,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.Key)),
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

app.MapGet("/health", () => Results.Ok(new { status = "ok", service = "identity" }));

app.MapPost("/auth/register-tenant", async (
    RegisterTenantRequest req, AppDbContext db,
    IPasswordHasher<User> hasher, TokenService tokens, AccountTokens links, IEmailSender mailer,
    IOptions<AppOptions> appOptions, ILogger<Program> log) =>
{
    var name = (req.TenantName ?? "").Trim();
    var email = (req.Email ?? "").Trim().ToLowerInvariant();
    var password = req.Password ?? "";

    if (name.Length is 0 or > 200 || !TenantRules.IsValidEmail(email) || password.Length is < 8 or > 128)
        return Results.BadRequest(new { error = "Tenant name (max 200 chars), a valid email and a password of 8-128 characters are required." });

    if (await db.Users.AnyAsync(u => u.Email == email))
        return Results.Conflict(new { error = "Email already registered." });

    var tenant = new Tenant { Name = name, Slug = await MakeUniqueSlugAsync(db, name) };
    var user = new User { Tenant = tenant, Email = email, Role = "Owner" };
    user.PasswordHash = hasher.HashPassword(user, password);

    db.Users.Add(user);   // adds the tenant too (object graph)
    try
    {
        await db.SaveChangesAsync();
    }
    catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
    {
        // two sign-ups with the same email raced past the AnyAsync check above
        return Results.Conflict(new { error = "Email already registered." });
    }

    await SendVerificationAsync(user, links, mailer, appOptions.Value, log);
    return Results.Ok(new AuthResponse(tokens.Create(user), tenant.Id, tenant.Slug, user.Email, user.Role));
});

app.MapPost("/auth/login", async (
    LoginRequest req, AppDbContext db,
    IPasswordHasher<User> hasher, TokenService tokens) =>
{
    var email = (req.Email ?? "").Trim().ToLowerInvariant();
    var user = await db.Users.Include(u => u.Tenant).FirstOrDefaultAsync(u => u.Email == email);
    if (user is null) return Results.Unauthorized();

    var result = hasher.VerifyHashedPassword(user, user.PasswordHash, req.Password ?? "");
    if (result == PasswordVerificationResult.Failed) return Results.Unauthorized();

    return Results.Ok(new AuthResponse(tokens.Create(user), user.TenantId, user.Tenant.Slug, user.Email, user.Role));
});

app.MapGet("/auth/me", async (ClaimsPrincipal p, AppDbContext db) =>
{
    var user = await CurrentUserAsync(p, db);
    return user is null ? Results.Unauthorized() : Results.Ok(new
    {
        userId = user.Id, email = user.Email, tenantId = user.TenantId, role = user.Role,
        tenantName = user.Tenant.Name, emailVerified = user.EmailVerifiedAt is not null
    });
}).RequireAuthorization();

// ---------- email verification ----------

app.MapPost("/auth/verify-email", async (TokenRequest req, AccountTokens links, AppDbContext db) =>
{
    var user = await links.ConsumeAsync(req.Token, TokenPurpose.VerifyEmail);
    if (user is null) return Results.BadRequest(new { error = "This link is invalid or has expired. Log in and send a new one." });
    user.EmailVerifiedAt ??= links.Now;
    await db.SaveChangesAsync();
    return Results.Ok(new { email = user.Email, emailVerified = true });
});

app.MapPost("/auth/resend-verification", async (ClaimsPrincipal p, AppDbContext db, AccountTokens links,
    IEmailSender email, IOptions<AppOptions> appOptions, ILogger<Program> log) =>
{
    var user = await CurrentUserAsync(p, db);
    if (user is null) return Results.Unauthorized();
    if (user.EmailVerifiedAt is not null) return Results.Ok(new { sent = false, emailVerified = true });
    if (await links.RecentlySentAsync(user.Id, TokenPurpose.VerifyEmail))
        return Results.Json(new { error = "We just sent one. Please wait a minute and check your spam folder." }, statusCode: 429);
    var sent = await SendVerificationAsync(user, links, email, appOptions.Value, log);
    return sent ? Results.Ok(new { sent = true, emailVerified = false })
                : Results.Json(new { error = "The email could not be sent. Please try again later." }, statusCode: 502);
}).RequireAuthorization();

// ---------- password reset ----------

// always answers the same, so nobody can find out which emails have an account
app.MapPost("/auth/forgot-password", async (ForgotPasswordRequest req, AppDbContext db, AccountTokens links,
    IEmailSender email, IOptions<AppOptions> appOptions, ILogger<Program> log) =>
{
    var address = (req.Email ?? "").Trim().ToLowerInvariant();
    var user = TenantRules.IsValidEmail(address) ? await db.Users.FirstOrDefaultAsync(u => u.Email == address) : null;
    if (user is not null && !await links.RecentlySentAsync(user.Id, TokenPurpose.ResetPassword))
    {
        var token = await links.CreateAsync(user.Id, TokenPurpose.ResetPassword);
        try { await email.SendAsync(EmailTemplates.Reset(user.Email, appOptions.Value.Link("/reset-password", token))); }
        catch (Exception ex) { log.LogError(ex, "Could not send a password reset email: {Reason}", ex.Message); }
    }
    return Results.Ok(new { ok = true });
});

app.MapPost("/auth/reset-password", async (ResetPasswordRequest req, AppDbContext db, AccountTokens links,
    IPasswordHasher<User> hasher, TokenService tokens) =>
{
    var password = req.Password ?? "";
    if (password.Length is < 8 or > 128) return Results.BadRequest(new { error = "The password must be 8-128 characters." });
    var user = await links.ConsumeAsync(req.Token, TokenPurpose.ResetPassword);
    if (user is null) return Results.BadRequest(new { error = "This link is invalid or has expired. Ask for a new one." });

    user.PasswordHash = hasher.HashPassword(user, password);
    user.EmailVerifiedAt ??= links.Now;   // they just proved they can read this inbox
    await db.SaveChangesAsync();
    return Results.Ok(new AuthResponse(tokens.Create(user), user.TenantId, user.Tenant.Slug, user.Email, user.Role));
});

// ---------- your data: export and deletion ----------

app.MapGet("/auth/export", async (ClaimsPrincipal p, AppDbContext db) =>
{
    var me = await CurrentUserAsync(p, db);
    if (me is null) return Results.Unauthorized();
    var users = await db.Users.Where(u => u.TenantId == me.TenantId)
        .Select(u => new { u.Email, u.Role, u.CreatedAt, u.EmailVerifiedAt }).ToListAsync();
    return Results.Ok(new { business = new { me.Tenant.Name, me.Tenant.Slug, me.Tenant.CreatedAt }, users });
}).RequireAuthorization();

app.MapPost("/auth/delete-account", async (DeleteAccountRequest req, ClaimsPrincipal p, AppDbContext db,
    IPasswordHasher<User> hasher, IBotsClient bots, ILogger<Program> log) =>
{
    var user = await CurrentUserAsync(p, db);
    if (user is null) return Results.Unauthorized();
    if (user.Role != "Owner") return Results.Forbid();
    if (hasher.VerifyHashedPassword(user, user.PasswordHash, req.Password ?? "") == PasswordVerificationResult.Failed)
        return Results.BadRequest(new { error = "Wrong password." });

    try
    {
        await bots.DeleteTenantAsync(user.TenantId);   // bots, documents, leads, chats, subscription
    }
    catch (HttpRequestException ex)
    {
        log.LogError(ex, "Could not delete the bot data of tenant {Tenant}", user.TenantId);
        return Results.Json(new { error = "Your account could not be deleted right now. Please try again." }, statusCode: 502);
    }
    await db.Tenants.Where(t => t.Id == user.TenantId).ExecuteDeleteAsync();   // users and tokens cascade
    log.LogInformation("Deleted tenant {Tenant} at the owner's request", user.TenantId);
    return Results.NoContent();
}).RequireAuthorization();

// ---------- admin (platform owner, Admin:ApiKey) ----------

app.MapGet("/admin/tenants", async (HttpRequest request, IConfiguration config, AppDbContext db) =>
{
    var expected = config["Admin:ApiKey"] ?? "";
    var provided = request.Headers["X-Admin-Key"].ToString();
    if (expected.Length == 0 || !System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(
            System.Text.Encoding.UTF8.GetBytes(provided), System.Text.Encoding.UTF8.GetBytes(expected)))
        return Results.Unauthorized();

    var tenants = await db.Tenants.OrderByDescending(t => t.CreatedAt).Select(t => new
    {
        tenantId = t.Id, name = t.Name, slug = t.Slug, createdAt = t.CreatedAt,
        owner = t.Users.Where(u => u.Role == "Owner").OrderBy(u => u.CreatedAt)
            .Select(u => new { u.Email, emailVerified = u.EmailVerifiedAt != null }).FirstOrDefault()
    }).ToListAsync();
    return Results.Ok(tenants);
});

app.Run();

static async Task<User?> CurrentUserAsync(ClaimsPrincipal p, AppDbContext db) =>
    Guid.TryParse(p.FindFirstValue("sub"), out var id)
        ? await db.Users.Include(u => u.Tenant).FirstOrDefaultAsync(u => u.Id == id)
        : null;

// a failed email must never break sign-up; the owner can resend it from the dashboard
static async Task<bool> SendVerificationAsync(User user, AccountTokens links, IEmailSender email, AppOptions app, ILogger log)
{
    try
    {
        var token = await links.CreateAsync(user.Id, TokenPurpose.VerifyEmail);
        await email.SendAsync(EmailTemplates.Verify(user.Email, app.Link("/verify-email", token)));
        return true;
    }
    catch (Exception ex)
    {
        log.LogError(ex, "Could not send the verification email: {Reason}", ex.Message);
        return false;
    }
}

static async Task<string> MakeUniqueSlugAsync(AppDbContext db, string name)
{
    var baseSlug = TenantRules.Slugify(name);
    var slug = baseSlug;
    while (await db.Tenants.AnyAsync(t => t.Slug == slug))
        slug = $"{baseSlug}-{Guid.NewGuid().ToString("N")[..4]}";
    return slug;
}

public partial class Program;
