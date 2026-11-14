using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Identity.Api.Accounts;
using Identity.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Identity.Tests.Integration;

[Trait("Level", "Integration")]
[Collection(IdentityApiCollection.Name)]
public class AccountEndpointsTests(IdentityApiFactory factory)
{
    private readonly HttpClient _client = factory.CreateClient();
    private const string Password = "Passw0rd!";

    private record AuthResponse(string Token, Guid TenantId, string TenantSlug, string Email, string Role);

    private async Task<(string Email, AuthResponse Auth)> Register(string business = "Sunrise Academy")
    {
        var email = $"acct-{Guid.NewGuid():N}@example.com";
        var res = await _client.PostAsJsonAsync("/auth/register-tenant", new { tenantName = business, email, password = Password });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        return (email, (await res.Content.ReadFromJsonAsync<AuthResponse>())!);
    }

    private HttpClient As(string token)
    {
        var c = factory.CreateClient();
        c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return c;
    }

    private async Task<JsonElement> Me(string token) => await As(token).GetFromJsonAsync<JsonElement>("/auth/me");

    private async Task AgeTokens(string email)
    {
        // pretend the last email went out a while ago, so the one-per-minute limit does not apply
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var user = await db.Users.SingleAsync(u => u.Email == email);
        await db.UserTokens.Where(t => t.UserId == user.Id).ExecuteUpdateAsync(s => s.SetProperty(t => t.CreatedAt, t => t.CreatedAt.AddMinutes(-5)));
    }

    [Fact]
    public async Task Sign_up_sends_a_verification_link_that_works_once()
    {
        var (email, auth) = await Register();
        var me = await Me(auth.Token);
        Assert.False(me.GetProperty("emailVerified").GetBoolean());
        Assert.Equal("Sunrise Academy", me.GetProperty("tenantName").GetString());

        var mail = factory.Emails.To(email).Single();
        Assert.Contains("https://dash.example/verify-email?token=", mail.Text);
        var token = factory.Emails.LastToken(email, "/verify-email");

        Assert.Equal(HttpStatusCode.OK, (await _client.PostAsJsonAsync("/auth/verify-email", new { token })).StatusCode);
        Assert.True((await Me(auth.Token)).GetProperty("emailVerified").GetBoolean());
        Assert.Equal(HttpStatusCode.BadRequest, (await _client.PostAsJsonAsync("/auth/verify-email", new { token })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await _client.PostAsJsonAsync("/auth/verify-email", new { token = "made-up" })).StatusCode);
    }

    [Fact]
    public async Task Sign_up_still_works_when_email_cannot_be_sent()
    {
        factory.Emails.Fail = true;
        try
        {
            var (_, auth) = await Register();
            Assert.False(string.IsNullOrEmpty(auth.Token));
        }
        finally { factory.Emails.Fail = false; }
    }

    [Fact]
    public async Task Verification_can_be_resent_but_not_flooded()
    {
        var (email, auth) = await Register();
        var owner = As(auth.Token);
        Assert.Equal((HttpStatusCode)429, (await owner.PostAsync("/auth/resend-verification", null)).StatusCode);

        await AgeTokens(email);
        Assert.Equal(HttpStatusCode.OK, (await owner.PostAsync("/auth/resend-verification", null)).StatusCode);
        Assert.Equal(2, factory.Emails.To(email).Count);
        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.PostAsync("/auth/resend-verification", null)).StatusCode);
    }

    [Fact]
    public async Task Password_reset_changes_the_password_and_old_links_stop_working()
    {
        var (email, _) = await Register();

        Assert.Equal(HttpStatusCode.OK, (await _client.PostAsJsonAsync("/auth/forgot-password", new { email = email.ToUpperInvariant() })).StatusCode);
        var first = factory.Emails.LastToken(email, "/reset-password");
        await AgeTokens(email);
        await _client.PostAsJsonAsync("/auth/forgot-password", new { email });
        var second = factory.Emails.LastToken(email, "/reset-password");
        Assert.NotEqual(first, second);

        Assert.Equal(HttpStatusCode.BadRequest,
            (await _client.PostAsJsonAsync("/auth/reset-password", new { token = second, password = "short" })).StatusCode);
        var reset = await _client.PostAsJsonAsync("/auth/reset-password", new { token = second, password = "N3w-password!" });
        Assert.Equal(HttpStatusCode.OK, reset.StatusCode);
        var auth = (await reset.Content.ReadFromJsonAsync<AuthResponse>())!;
        Assert.True((await Me(auth.Token)).GetProperty("emailVerified").GetBoolean());

        // the older link died with the reset
        Assert.Equal(HttpStatusCode.BadRequest,
            (await _client.PostAsJsonAsync("/auth/reset-password", new { token = first, password = "An0ther-pass!" })).StatusCode);

        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.PostAsJsonAsync("/auth/login", new { email, password = Password })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await _client.PostAsJsonAsync("/auth/login", new { email, password = "N3w-password!" })).StatusCode);
    }

    [Fact]
    public async Task Forgot_password_does_not_reveal_whether_an_account_exists()
    {
        var before = factory.Emails.Sent.Count;
        var res = await _client.PostAsJsonAsync("/auth/forgot-password", new { email = $"nobody-{Guid.NewGuid():N}@example.com" });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal(before, factory.Emails.Sent.Count);
    }

    [Fact]
    public async Task Expired_reset_links_are_rejected()
    {
        var (email, _) = await Register();
        await _client.PostAsJsonAsync("/auth/forgot-password", new { email });
        var token = factory.Emails.LastToken(email, "/reset-password");
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var hash = AccountTokens.Hash(token);
            await db.UserTokens.Where(t => t.TokenHash == hash).ExecuteUpdateAsync(s => s.SetProperty(t => t.ExpiresAt, DateTime.UtcNow.AddMinutes(-1)));
        }
        Assert.Equal(HttpStatusCode.BadRequest,
            (await _client.PostAsJsonAsync("/auth/reset-password", new { token, password = "N3w-password!" })).StatusCode);
    }

    [Fact]
    public async Task Deleting_the_account_needs_the_password_and_removes_everything()
    {
        var (email, auth) = await Register();
        var owner = As(auth.Token);

        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync("/auth/delete-account", new { password = "wrong" })).StatusCode);

        factory.Bots.Fail = true;
        try
        {
            Assert.Equal(HttpStatusCode.BadGateway, (await owner.PostAsJsonAsync("/auth/delete-account", new { password = Password })).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await _client.PostAsJsonAsync("/auth/login", new { email, password = Password })).StatusCode);
        }
        finally { factory.Bots.Fail = false; }

        Assert.Equal(HttpStatusCode.NoContent, (await owner.PostAsJsonAsync("/auth/delete-account", new { password = Password })).StatusCode);
        Assert.Contains(auth.TenantId, factory.Bots.Deleted);
        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.PostAsJsonAsync("/auth/login", new { email, password = Password })).StatusCode);
        // the email can be used for a new sign-up again
        var again = await _client.PostAsJsonAsync("/auth/register-tenant", new { tenantName = "Again", email, password = Password });
        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
    }

    [Fact]
    public async Task Export_lists_the_business_and_its_users()
    {
        var (email, auth) = await Register("Export Co");
        var json = await As(auth.Token).GetFromJsonAsync<JsonElement>("/auth/export");
        Assert.Equal("Export Co", json.GetProperty("business").GetProperty("name").GetString());
        Assert.Equal(email, json.GetProperty("users")[0].GetProperty("email").GetString());
    }

    [Fact]
    public async Task Admin_tenant_list_needs_the_admin_key()
    {
        var (email, _) = await Register("Admin Visible");
        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.GetAsync("/admin/tenants")).StatusCode);

        var msg = new HttpRequestMessage(HttpMethod.Get, "/admin/tenants");
        msg.Headers.Add("X-Admin-Key", IdentityApiFactory.AdminKey);
        var list = await (await _client.SendAsync(msg)).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains(list.EnumerateArray(), t => t.GetProperty("owner").GetProperty("email").GetString() == email);
    }

    [Fact]
    public async Task Monthly_report_goes_once_to_verified_owners_of_older_businesses()
    {
        var (email, auth) = await Register("Report Co");
        var (unverifiedEmail, unverified) = await Register("Unverified Co");
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Tenants.Where(t => t.Id == auth.TenantId || t.Id == unverified.TenantId)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.CreatedAt, DateTime.UtcNow.AddMonths(-3)));
        await db.Users.Where(u => u.Email == email).ExecuteUpdateAsync(s => s.SetProperty(u => u.EmailVerifiedAt, DateTime.UtcNow));

        factory.Bots.Stats =
        [
            new MonthlyStats(auth.TenantId, 1, "Starter", 120, 40, 3, 7),
            new MonthlyStats(unverified.TenantId, 1, "Free trial", 5, 2, 0, 0),
        ];
        var now = DateTime.UtcNow;
        await MonthlyReportService.SendDueAsync(scope.ServiceProvider, now);

        var report = factory.Emails.To(email).Single(m => m.Subject.StartsWith("Your Kahiye report"));
        Assert.Contains("Conversations: 40", report.Text);
        Assert.Contains("New leads: 7", report.Text);
        Assert.DoesNotContain(factory.Emails.To(unverifiedEmail), m => m.Subject.StartsWith("Your Kahiye report"));

        // running again in the same month sends nothing new
        await MonthlyReportService.SendDueAsync(scope.ServiceProvider, now);
        Assert.Single(factory.Emails.To(email), m => m.Subject.StartsWith("Your Kahiye report"));
        factory.Bots.Stats = [];
    }
}
