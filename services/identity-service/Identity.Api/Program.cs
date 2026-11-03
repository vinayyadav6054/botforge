using System.Net.Mail;
using System.Security.Claims;
using System.Text;
using System.Text.RegularExpressions;
using Identity.Api.Auth;
using Identity.Api.Data;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
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
    IPasswordHasher<User> hasher, TokenService tokens) =>
{
    var name = (req.TenantName ?? "").Trim();
    var email = (req.Email ?? "").Trim().ToLowerInvariant();
    var password = req.Password ?? "";

    if (name.Length is 0 or > 200 || !IsValidEmail(email) || password.Length is < 8 or > 128)
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

app.MapGet("/auth/me", (ClaimsPrincipal p) => Results.Ok(new
{
    userId = p.FindFirstValue("sub"),
    email = p.FindFirstValue("email"),
    tenantId = p.FindFirstValue("tenant_id"),
    role = p.FindFirstValue("role")
})).RequireAuthorization();

app.Run();

static bool IsValidEmail(string email) =>
    email.Length <= 256 && MailAddress.TryCreate(email, out var parsed) && parsed.Address == email && email.Contains('.');

static async Task<string> MakeUniqueSlugAsync(AppDbContext db, string name)
{
    var baseSlug = Regex.Replace(name.ToLowerInvariant(), "[^a-z0-9]+", "-").Trim('-');
    if (baseSlug.Length > 80) baseSlug = baseSlug[..80].TrimEnd('-');
    if (baseSlug.Length == 0) baseSlug = "tenant";
    var slug = baseSlug;
    while (await db.Tenants.AnyAsync(t => t.Slug == slug))
        slug = $"{baseSlug}-{Guid.NewGuid().ToString("N")[..4]}";
    return slug;
}

public partial class Program;
