using System.Net;
using System.Text.Json;
using Identity.Api.Email;
using Microsoft.Extensions.Options;

namespace Identity.Tests.Unit;

[Trait("Level", "Unit")]
public class BrevoEmailSenderTests
{
    private class Capture(HttpStatusCode status) : HttpMessageHandler
    {
        public HttpRequestMessage? Request;
        public string Body = "";

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Request = request;
            Body = await request.Content!.ReadAsStringAsync(ct);
            return new HttpResponseMessage(status) { Content = new StringContent("{\"message\":\"sender not verified\"}") };
        }
    }

    private static BrevoEmailSender Sender(Capture handler) => new(new HttpClient(handler),
        Options.Create(new EmailOptions { From = "BotForge <hello@example.com>", Brevo = new BrevoOptions { ApiKey = "xkeysib-test" } }));

    [Fact]
    public async Task Posts_the_email_to_brevo_with_the_api_key()
    {
        var handler = new Capture(HttpStatusCode.Created);
        await Sender(handler).SendAsync(new EmailMessage("owner@example.com", "Hi", "text body", "<p>html</p>"));

        Assert.Equal("https://api.brevo.com/v3/smtp/email", handler.Request!.RequestUri!.ToString());
        Assert.Equal("xkeysib-test", handler.Request.Headers.GetValues("api-key").Single());
        var json = JsonDocument.Parse(handler.Body).RootElement;
        Assert.Equal("hello@example.com", json.GetProperty("sender").GetProperty("email").GetString());
        Assert.Equal("BotForge", json.GetProperty("sender").GetProperty("name").GetString());
        Assert.Equal("owner@example.com", json.GetProperty("to")[0].GetProperty("email").GetString());
        Assert.Equal("Hi", json.GetProperty("subject").GetString());
        Assert.Equal("<p>html</p>", json.GetProperty("htmlContent").GetString());
        Assert.Equal("text body", json.GetProperty("textContent").GetString());
    }

    [Fact]
    public async Task A_refused_email_throws_with_the_reason()
    {
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            Sender(new Capture(HttpStatusCode.BadRequest)).SendAsync(new EmailMessage("a@example.com", "s", "t", "h")));
        Assert.Contains("sender not verified", ex.Message);
    }
}
