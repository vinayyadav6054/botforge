using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace Identity.Tests.Integration;

[Trait("Level", "Integration")]
public class AuthEndpointsTests(IdentityApiFactory factory) : IClassFixture<IdentityApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    private static string NewEmail() => $"user-{Guid.NewGuid():N}@example.com";

    private record AuthResponse(string Token, Guid TenantId, string TenantSlug, string Email, string Role);

    private async Task<HttpResponseMessage> Register(string tenant, string email, string password = "Passw0rd!") =>
        await _client.PostAsJsonAsync("/auth/register-tenant", new { tenantName = tenant, email, password });

    [Fact]
    public async Task Health_is_ok()
    {
        var res = await _client.GetAsync("/health");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }

    [Fact]
    public async Task Register_creates_tenant_and_returns_token()
    {
        var email = NewEmail();
        var res = await Register("Sunrise Bakery", email.ToUpperInvariant());

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<AuthResponse>();
        Assert.NotNull(body);
        Assert.False(string.IsNullOrEmpty(body.Token));
        Assert.Equal(email, body.Email);            // stored lower-case
        Assert.StartsWith("sunrise-bakery", body.TenantSlug);
        Assert.Equal("Owner", body.Role);
    }

    [Fact]
    public async Task Same_tenant_name_gets_a_unique_slug()
    {
        var a = await (await Register("Twin Shop", NewEmail())).Content.ReadFromJsonAsync<AuthResponse>();
        var b = await (await Register("Twin Shop", NewEmail())).Content.ReadFromJsonAsync<AuthResponse>();
        Assert.NotEqual(a!.TenantSlug, b!.TenantSlug);
        Assert.NotEqual(a.TenantId, b.TenantId);
    }

    [Fact]
    public async Task Duplicate_email_is_a_conflict()
    {
        var email = NewEmail();
        Assert.Equal(HttpStatusCode.OK, (await Register("One", email)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Register("Two", email)).StatusCode);
    }

    [Fact]
    public async Task Concurrent_duplicate_signups_never_return_500()
    {
        var email = NewEmail();
        var results = await Task.WhenAll(Enumerable.Range(0, 5).Select(i => Register($"Race {i}", email)));
        var codes = results.Select(r => r.StatusCode).ToList();
        Assert.Single(codes, c => c == HttpStatusCode.OK);
        Assert.All(codes.Where(c => c != HttpStatusCode.OK), c => Assert.Equal(HttpStatusCode.Conflict, c));
    }

    [Theory]
    [InlineData("", "valid@example.com", "Passw0rd!")]
    [InlineData("Shop", "not-an-email", "Passw0rd!")]
    [InlineData("Shop", "valid@example.com", "short")]
    public async Task Register_validates_input(string tenant, string email, string password)
    {
        var res = await Register(tenant, email, password);
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Register_rejects_overlong_tenant_name_with_400_not_500()
    {
        var res = await Register(new string('x', 201), NewEmail());
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Login_works_with_correct_password_and_is_case_insensitive_on_email()
    {
        var email = NewEmail();
        await Register("Login Co", email);

        var ok = await _client.PostAsJsonAsync("/auth/login", new { email = "  " + email.ToUpperInvariant(), password = "Passw0rd!" });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);

        var bad = await _client.PostAsJsonAsync("/auth/login", new { email, password = "wrong-password" });
        Assert.Equal(HttpStatusCode.Unauthorized, bad.StatusCode);

        var unknown = await _client.PostAsJsonAsync("/auth/login", new { email = NewEmail(), password = "Passw0rd!" });
        Assert.Equal(HttpStatusCode.Unauthorized, unknown.StatusCode);
    }

    [Fact]
    public async Task Me_returns_the_claims_of_the_token()
    {
        var email = NewEmail();
        var auth = await (await Register("Me Co", email)).Content.ReadFromJsonAsync<AuthResponse>();

        var req = new HttpRequestMessage(HttpMethod.Get, "/auth/me");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", auth!.Token);
        var res = await _client.SendAsync(req);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);

        var me = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(string.IsNullOrEmpty(me.GetProperty("userId").GetString()));
        Assert.Equal(email, me.GetProperty("email").GetString());
        Assert.Equal(auth.TenantId.ToString(), me.GetProperty("tenantId").GetString());
        Assert.Equal("Owner", me.GetProperty("role").GetString());
    }

    [Fact]
    public async Task Me_requires_a_valid_token()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.GetAsync("/auth/me")).StatusCode);

        var req = new HttpRequestMessage(HttpMethod.Get, "/auth/me");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", "not.a.token");
        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.SendAsync(req)).StatusCode);
    }
}
