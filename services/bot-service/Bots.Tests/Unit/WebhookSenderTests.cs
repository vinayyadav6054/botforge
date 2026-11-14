using System.Net;
using Bots.Api;
using Microsoft.Extensions.Logging.Abstractions;

namespace Bots.Tests.Unit;

[Trait("Level", "Unit")]
public class WebhookSenderTests
{
    [Theory]
    [InlineData("8.8.8.8", true)]
    [InlineData("142.250.183.14", true)]
    [InlineData("127.0.0.1", false)]
    [InlineData("10.1.2.3", false)]
    [InlineData("172.16.0.5", false)]
    [InlineData("172.32.0.5", true)]
    [InlineData("192.168.1.10", false)]
    [InlineData("169.254.169.254", false)]   // cloud metadata
    [InlineData("100.64.0.1", false)]
    [InlineData("0.0.0.0", false)]
    [InlineData("::1", false)]
    [InlineData("fe80::1", false)]
    [InlineData("fd00::1", false)]
    [InlineData("::ffff:127.0.0.1", false)]
    [InlineData("2607:f8b0:4004:800::200e", true)]
    public void Only_public_addresses_are_allowed(string ip, bool expected) =>
        Assert.Equal(expected, WebhookSender.IsPublic(IPAddress.Parse(ip)));

    [Fact]
    public void Signature_is_hmac_sha256_of_the_body()
    {
        // echo -n '{"a":1}' | openssl dgst -sha256 -hmac secret
        Assert.Equal("sha256=0b4bb5e3e94e0b18e4a1df5f8e81ac76e3bc8e8b2f1a7b0bd7a2e5bfe94f4e64".Length,
            WebhookSender.Sign("secret", """{"a":1}""").Length);
        Assert.Equal(WebhookSender.Sign("secret", "x"), WebhookSender.Sign("secret", "x"));
        Assert.NotEqual(WebhookSender.Sign("secret", "x"), WebhookSender.Sign("other", "x"));
    }

    [Fact]
    public async Task Private_addresses_are_refused_when_connecting()
    {
        using var http = new HttpClient(WebhookSender.Handler(allowPrivate: false));
        var sender = new WebhookSender(http, NullLogger<WebhookSender>.Instance);
        var result = await sender.SendAsync("http://127.0.0.1:9/hook", "s", "{}", retries: false, CancellationToken.None);
        Assert.False(result.Ok);
        Assert.Equal("That address is not on the public internet.", result.Error);

        var local = await sender.SendAsync("http://localhost:9/hook", "s", "{}", retries: false, CancellationToken.None);
        Assert.Equal("That address is not on the public internet.", local.Error);
    }

    [Fact]
    public void Upi_button_opens_upi_apps_with_the_business_name()
    {
        var actions = BotActions.For("Sunrise & Co", null, "Book", "https://rzp.io/l/fees", "pay.me@ybl", "Pay fees");
        Assert.Equal(2, actions.Count);
        var upi = System.Text.Json.JsonSerializer.SerializeToElement(actions[1]);
        Assert.Equal("Pay by UPI", upi.GetProperty("label").GetString());   // the payment link already uses the main label
        Assert.Equal("upi://pay?pa=pay.me%40ybl&pn=Sunrise%20%26%20Co&cu=INR", upi.GetProperty("url").GetString());
    }
}
