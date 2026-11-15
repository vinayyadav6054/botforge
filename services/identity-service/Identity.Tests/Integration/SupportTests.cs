using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace Identity.Tests.Integration;

[Trait("Level", "Integration")]
[Collection(IdentityApiCollection.Name)]
public class SupportTests(IdentityApiFactory factory)
{
    private async Task<(HttpClient Client, string Email)> Owner()
    {
        var email = $"help-{Guid.NewGuid():N}@example.com";
        var res = await factory.CreateClient().PostAsJsonAsync("/auth/register-tenant", new { tenantName = "Help <Co>", email, password = "Passw0rd!" });
        var token = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString();
        var c = factory.CreateClient();
        c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return (c, email);
    }

    [Fact]
    public async Task Owners_can_write_to_support_and_the_message_arrives_safely()
    {
        var (c, email) = await Owner();
        var res = await c.PostAsJsonAsync("/support", new { topic = "Billing and payment", message = "I paid by UPI, ref 123456. <script>x</script>" });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var mail = factory.Emails.Sent.Last(m => m.Subject.StartsWith("[Support]"));
        Assert.Equal("[Support] Billing and payment · Help <Co>", mail.Subject);
        Assert.Contains(email, mail.Text);
        Assert.Contains("&lt;script&gt;", mail.Html);
        Assert.DoesNotContain("<script>", mail.Html);
    }

    [Fact]
    public async Task Bad_requests_and_floods_are_refused()
    {
        var (c, _) = await Owner();
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsJsonAsync("/support", new { topic = "Hacking", message = "long enough text here" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsJsonAsync("/support", new { topic = "Other", message = "short" })).StatusCode);
        for (var i = 0; i < 5; i++)
            Assert.Equal(HttpStatusCode.OK, (await c.PostAsJsonAsync("/support", new { topic = "Other", message = $"Message number {i} here" })).StatusCode);
        Assert.Equal((HttpStatusCode)429, (await c.PostAsJsonAsync("/support", new { topic = "Other", message = "one message too many" })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().PostAsJsonAsync("/support", new { topic = "Other", message = "no login at all" })).StatusCode);
    }
}
