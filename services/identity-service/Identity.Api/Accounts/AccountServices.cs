using System.Globalization;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using Identity.Api.Data;
using Identity.Api.Email;
using Microsoft.EntityFrameworkCore;

namespace Identity.Api.Accounts;

public static class TokenPurpose
{
    public const string VerifyEmail = "verify-email";
    public const string ResetPassword = "reset-password";
}

/// <summary>One-time tokens for email links. The raw token only ever exists in the email.</summary>
public class AccountTokens(AppDbContext db, TimeProvider clock)
{
    public static readonly TimeSpan VerifyLifetime = TimeSpan.FromHours(24);
    public static readonly TimeSpan ResetLifetime = TimeSpan.FromHours(1);
    /// <summary>At most one email of each kind per user per minute.</summary>
    public static readonly TimeSpan Cooldown = TimeSpan.FromMinutes(1);

    public DateTime Now => clock.GetUtcNow().UtcDateTime;

    public static string Hash(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))).ToLowerInvariant();

    public async Task<bool> RecentlySentAsync(Guid userId, string purpose) =>
        await db.UserTokens.AnyAsync(t => t.UserId == userId && t.Purpose == purpose && t.CreatedAt > Now - Cooldown);

    public async Task<string> CreateAsync(Guid userId, string purpose)
    {
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        db.UserTokens.Add(new UserToken
        {
            UserId = userId,
            Purpose = purpose,
            TokenHash = Hash(token),
            CreatedAt = Now,
            ExpiresAt = Now + (purpose == TokenPurpose.ResetPassword ? ResetLifetime : VerifyLifetime)
        });
        await db.SaveChangesAsync();
        return token;
    }

    /// <summary>Marks a valid, unused, unexpired token as used and returns its user; null otherwise.</summary>
    public async Task<User?> ConsumeAsync(string? token, string purpose)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Length > 200) return null;
        var hash = Hash(token.Trim());
        var row = await db.UserTokens.FirstOrDefaultAsync(t => t.TokenHash == hash && t.Purpose == purpose);
        if (row is null || row.UsedAt is not null || row.ExpiresAt <= Now) return null;

        // all open tokens of this kind die with it (an older reset link must not work afterwards)
        var open = await db.UserTokens.Where(t => t.UserId == row.UserId && t.Purpose == purpose && t.UsedAt == null).ToListAsync();
        foreach (var t in open) t.UsedAt = Now;
        return await db.Users.Include(u => u.Tenant).FirstOrDefaultAsync(u => u.Id == row.UserId);
    }
}

public class AppOptions
{
    /// <summary>Public address of the dashboard, used in email links.</summary>
    public string DashboardUrl { get; set; } = "http://localhost:3000";

    public string Link(string path, string token) => $"{DashboardUrl.TrimEnd('/')}{path}?token={Uri.EscapeDataString(token)}";
}

public record MonthlyStats(Guid TenantId, int Bots, string Plan, int Answers, int Conversations, int Unanswered, int Leads);

/// <summary>Calls the bot service's internal API (same Internal:ApiKey as the chat service).</summary>
public interface IBotsClient
{
    Task DeleteTenantAsync(Guid tenantId, CancellationToken ct = default);
    Task<List<MonthlyStats>> MonthlyReportAsync(string period, CancellationToken ct = default);
}

public class BotsClient(HttpClient http, IConfiguration config) : IBotsClient
{
    private HttpRequestMessage Request(HttpMethod method, string path)
    {
        var msg = new HttpRequestMessage(method, $"{config["Services:BotsUrl"]?.TrimEnd('/')}{path}");
        msg.Headers.Add("X-Internal-Key", config["Internal:ApiKey"] ?? "");
        return msg;
    }

    public async Task DeleteTenantAsync(Guid tenantId, CancellationToken ct = default)
    {
        using var res = await http.SendAsync(Request(HttpMethod.Delete, $"/internal/tenants/{tenantId}"), ct);
        res.EnsureSuccessStatusCode();
    }

    public async Task<List<MonthlyStats>> MonthlyReportAsync(string period, CancellationToken ct = default)
    {
        using var res = await http.SendAsync(Request(HttpMethod.Get, $"/internal/reports/monthly?period={period}"), ct);
        res.EnsureSuccessStatusCode();
        return await res.Content.ReadFromJsonAsync<List<MonthlyStats>>(ct) ?? [];
    }
}

/// <summary>
/// Early each month, emails every business with a verified owner a summary of the previous month.
/// Checks hourly, so a sleeping free-tier server still sends once it wakes up; ReportLog prevents duplicates.
/// </summary>
public class MonthlyReportService(IServiceScopeFactory scopes, IConfiguration config, TimeProvider clock,
    ILogger<MonthlyReportService> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!config.GetValue("Reports:Enabled", true)) return;
        if (string.IsNullOrEmpty(config["Services:BotsUrl"]) || string.IsNullOrEmpty(config["Internal:ApiKey"]))
        {
            log.LogInformation("Monthly reports are off: set Services:BotsUrl and Internal:ApiKey to enable them");
            return;
        }
        await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken);   // let the other services start first
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = scopes.CreateScope();
                await SendDueAsync(scope.ServiceProvider, clock.GetUtcNow().UtcDateTime, stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogWarning(ex, "Monthly reports failed; retrying in an hour");
            }
            await Task.Delay(TimeSpan.FromHours(1), stoppingToken);
        }
    }

    /// <summary>Sends the previous month's report to every business that has not had it yet. Returns how many were sent.</summary>
    public static async Task<int> SendDueAsync(IServiceProvider sp, DateTime now, CancellationToken ct = default)
    {
        var db = sp.GetRequiredService<AppDbContext>();
        var bots = sp.GetRequiredService<IBotsClient>();
        var email = sp.GetRequiredService<IEmailSender>();
        var app = sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<AppOptions>>().Value;

        var monthStart = new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        var periodStart = monthStart.AddMonths(-1);
        var period = periodStart.ToString("yyyy-MM", CultureInfo.InvariantCulture);
        var monthName = periodStart.ToString("MMMM yyyy", CultureInfo.InvariantCulture);

        var done = (await db.ReportLogs.Where(r => r.Period == period).Select(r => r.TenantId).ToListAsync(ct)).ToHashSet();
        var stats = (await bots.MonthlyReportAsync(period, ct)).Where(s => s.Bots > 0 && !done.Contains(s.TenantId)).ToList();
        if (stats.Count == 0) return 0;

        var ids = stats.Select(s => s.TenantId).ToList();
        var owners = await db.Users.Include(u => u.Tenant)
            .Where(u => ids.Contains(u.TenantId) && u.Role == "Owner" && u.EmailVerifiedAt != null && u.Tenant.CreatedAt < monthStart)
            .ToListAsync(ct);

        var sent = 0;
        foreach (var s in stats)
        {
            var owner = owners.FirstOrDefault(o => o.TenantId == s.TenantId);
            if (owner is null) continue;
            await email.SendAsync(EmailTemplates.MonthlyReport(owner.Email,
                new EmailTemplates.ReportNumbers(owner.Tenant.Name, monthName, s.Plan, s.Answers, s.Conversations, s.Leads, s.Unanswered),
                $"{app.DashboardUrl.TrimEnd('/')}/bots"), ct);
            db.ReportLogs.Add(new ReportLog { TenantId = s.TenantId, Period = period, SentAt = now });
            await db.SaveChangesAsync(ct);
            sent++;
        }
        return sent;
    }
}
