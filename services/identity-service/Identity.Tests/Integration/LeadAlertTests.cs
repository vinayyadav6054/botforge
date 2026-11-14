using System.Net;
using System.Net.Http.Json;

namespace Identity.Tests.Integration;

[Trait("Level", "Integration")]
[Collection(IdentityApiCollection.Name)]
public class LeadAlertTests(IdentityApiFactory factory)
{
    private readonly HttpClient _client = factory.CreateClient();

    private record AuthResponse(string Token, Guid TenantId, string TenantSlug, string Email, string Role);

    private async Task<(string Email, Guid TenantId)> Register()
    {
        var email = $"alert-{Guid.NewGuid():N}@example.com";
        var res = await _client.PostAsJsonAsync("/auth/register-tenant", new { tenantName = "Alert Academy", email, password = "Passw0rd!" });
        var auth = (await res.Content.ReadFromJsonAsync<AuthResponse>())!;
        return (email, auth.TenantId);
    }

    private static object Alert(string? to = null) => new
    {
        to, botId = Guid.Parse("11111111-2222-3333-4444-555555555555"), botName = "Alert Bot",
        name = "Rohan <b>", phone = "+919811122233", email = (string?)null, course = "JEE", channel = "whatsapp",
        pageUrl = (string?)null,
        transcript = new[] { new { role = "user", text = "Fees?" }, new { role = "assistant", text = "Rs 68,000 a year." } },
    };

    private Task<HttpResponseMessage> Post(Guid tenantId, object body, string? key = IdentityApiFactory.InternalKey)
    {
        var msg = new HttpRequestMessage(HttpMethod.Post, $"/internal/tenants/{tenantId}/lead-alert") { Content = JsonContent.Create(body) };
        if (key is not null) msg.Headers.Add("X-Internal-Key", key);
        return _client.SendAsync(msg);
    }

    [Fact]
    public async Task Owner_gets_the_lead_with_call_and_whatsapp_links()
    {
        var (owner, tenantId) = await Register();
        var res = await Post(tenantId, Alert());
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);

        var mail = factory.Emails.To(owner).Single(m => m.Subject.StartsWith("New lead"));
        Assert.Equal("New lead: Rohan <b> · +919811122233 (Alert Bot)", mail.Subject);
        Assert.Contains("tel:+919811122233", mail.Html);
        Assert.Contains("https://wa.me/919811122233", mail.Html);
        Assert.Contains("Rohan &lt;b&gt;", mail.Html);            // visitor text is escaped
        Assert.DoesNotContain("Rohan <b>", mail.Html);
        Assert.Contains("Rs 68,000 a year.", mail.Text);
        Assert.Contains("Came from: WhatsApp", mail.Text);
        Assert.Contains("https://dash.example/bots/11111111-2222-3333-4444-555555555555#leads", mail.Text);
    }

    [Fact]
    public async Task Indian_numbers_without_country_code_get_a_working_whatsapp_link()
    {
        var (owner, tenantId) = await Register();
        var body = new
        {
            to = (string?)null, botId = Guid.NewGuid(), botName = "Local Bot", name = "Meena", phone = "9820012345",
            email = (string?)null, course = (string?)null, channel = "web", pageUrl = (string?)null, transcript = Array.Empty<object>(),
        };
        Assert.Equal(HttpStatusCode.OK, (await Post(tenantId, body)).StatusCode);
        var mail = factory.Emails.To(owner).Single(m => m.Subject.StartsWith("New lead"));
        Assert.Contains("https://wa.me/919820012345", mail.Html);
        Assert.Contains("tel:9820012345", mail.Html);
    }

    [Fact]
    public async Task Alerts_can_go_to_another_address()
    {
        var (_, tenantId) = await Register();
        Assert.Equal(HttpStatusCode.OK, (await Post(tenantId, Alert("Desk@Example.com"))).StatusCode);
        Assert.Single(factory.Emails.To("desk@example.com"));
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(tenantId, Alert("not-an-email"))).StatusCode);
    }

    [Fact]
    public async Task Needs_the_internal_key_and_a_known_business()
    {
        var (_, tenantId) = await Register();
        Assert.Equal(HttpStatusCode.Unauthorized, (await Post(tenantId, Alert(), key: null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Post(tenantId, Alert(), key: "wrong")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Post(Guid.NewGuid(), Alert())).StatusCode);
    }

    [Fact]
    public async Task A_failing_email_provider_is_reported()
    {
        var (_, tenantId) = await Register();
        factory.Emails.Fail = true;
        try
        {
            Assert.Equal(HttpStatusCode.BadGateway, (await Post(tenantId, Alert())).StatusCode);
        }
        finally
        {
            factory.Emails.Fail = false;
        }
    }
}
