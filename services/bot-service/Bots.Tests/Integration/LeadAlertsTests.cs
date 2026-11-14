using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Bots.Api;

namespace Bots.Tests.Integration;

[Trait("Level", "Integration")]
[Collection(BotsApiCollection.Name)]
public class LeadAlertsTests(BotsApiFactory factory)
{
    private static object Lead(string phone) => new
    {
        name = "Asha", phone, course = "NEET",
        transcript = new[] { new { role = "user", text = "Fees?" }, new { role = "assistant", text = "Rs 62,000." } }
    };

    private async Task<(HttpClient Owner, BotDto Bot)> Bot(object? settings = null)
    {
        var owner = factory.ClientFor(Guid.NewGuid());
        var bot = (await (await owner.PostAsJsonAsync("/bots", new { name = "Alert Bot" })).Content.ReadFromJsonAsync<BotDto>())!;
        var body = JsonSerializer.SerializeToElement(settings ?? new { });
        var merged = new Dictionary<string, object?> { ["name"] = bot.Name, ["leadCaptureEnabled"] = true };
        foreach (var p in body.EnumerateObject()) merged[p.Name] = p.Value;
        var put = await owner.PutAsJsonAsync($"/bots/{bot.Id}", merged);
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        return (owner, (await put.Content.ReadFromJsonAsync<BotDto>())!);
    }

    private async Task Submit(BotDto bot, string phone)
    {
        var msg = new HttpRequestMessage(HttpMethod.Post, $"/internal/bots/{bot.PublicKey}/leads") { Content = JsonContent.Create(Lead(phone)) };
        msg.Headers.Add("X-Internal-Key", BotsApiFactory.InternalKey);
        Assert.Equal(HttpStatusCode.Created, (await factory.CreateClient().SendAsync(msg)).StatusCode);
    }

    private async Task<List<(string Url, Dictionary<string, string> Headers, string Body)>> WaitFor(string urlPart, string bodyPart, int count = 1)
    {
        for (var i = 0; i < 100; i++)
        {
            var calls = factory.Outbound.To(urlPart).Where(c => c.Body.Contains(bodyPart)).ToList();
            if (calls.Count >= count) return calls;
            await Task.Delay(50);
        }
        throw new Xunit.Sdk.XunitException($"no call to {urlPart} containing {bodyPart}; saw: " +
            string.Join(" | ", factory.Outbound.Calls.Select(c => c.Url + " " + c.Body[..Math.Min(c.Body.Length, 160)])));
    }

    [Fact]
    public async Task New_bots_email_the_owner_about_each_lead()
    {
        var (_, bot) = await Bot();
        Assert.True(bot.AlertEmailEnabled);
        Assert.Null(bot.WebhookUrl);
        await Submit(bot, "9811100001");

        var call = (await WaitFor($"/lead-alert", "9811100001")).Single();
        Assert.Equal($"http://localhost:5120/internal/tenants/{(await TenantOf(bot))}/lead-alert", call.Url);
        Assert.Equal(BotsApiFactory.InternalKey, call.Headers["X-Internal-Key"]);
        var json = JsonDocument.Parse(call.Body).RootElement;
        Assert.Equal("Alert Bot", json.GetProperty("botName").GetString());
        Assert.Equal("NEET", json.GetProperty("course").GetString());
        Assert.Equal(JsonValueKind.Null, json.GetProperty("to").ValueKind);
        Assert.Equal(2, json.GetProperty("transcript").GetArrayLength());
    }

    private async Task<Guid> TenantOf(BotDto bot)
    {
        var msg = new HttpRequestMessage(HttpMethod.Get, $"/internal/bots/{bot.PublicKey}");
        msg.Headers.Add("X-Internal-Key", BotsApiFactory.InternalKey);
        var info = await (await factory.CreateClient().SendAsync(msg)).Content.ReadFromJsonAsync<JsonElement>();
        return info.GetProperty("tenantId").GetGuid();
    }

    [Fact]
    public async Task Webhook_gets_a_signed_flat_json_and_email_can_be_turned_off()
    {
        var (_, bot) = await Bot(new { alertEmailEnabled = false, webhookUrl = "https://hooks.example/lead-a" });
        Assert.False(bot.AlertEmailEnabled);
        Assert.Matches("^[0-9a-f]{48}$", bot.WebhookSecret!);
        await Submit(bot, "9811100002");

        var call = (await WaitFor("hooks.example/lead-a", "9811100002")).Single();
        Assert.Equal(WebhookSender.Sign(bot.WebhookSecret!, call.Body), call.Headers["X-BotForge-Signature"]);
        Assert.Equal("lead.created", call.Headers["X-BotForge-Event"]);
        var json = JsonDocument.Parse(call.Body).RootElement;
        Assert.Equal("lead.created", json.GetProperty("event").GetString());
        Assert.Equal("Asha", json.GetProperty("name").GetString());
        Assert.Equal("Visitor: Fees?\nBot: Rs 62,000.", json.GetProperty("transcript").GetString());
        Assert.DoesNotContain(factory.Outbound.Calls, c => c.Url.Contains("/lead-alert") && c.Body.Contains("9811100002"));
    }

    [Fact]
    public async Task Server_errors_are_retried_but_rejections_are_not()
    {
        WebhookSender.Delay = (_, _) => Task.CompletedTask;
        var (_, bot) = await Bot(new { alertEmailEnabled = false, webhookUrl = "https://hooks.example/flaky" });
        var (_, rejecting) = await Bot(new { alertEmailEnabled = false, webhookUrl = "https://hooks.example/rejects" });
        factory.Outbound.Status = u => u.AbsolutePath switch
        {
            "/flaky" => HttpStatusCode.ServiceUnavailable,
            "/rejects" => HttpStatusCode.Gone,
            _ => HttpStatusCode.OK,
        };
        try
        {
            await Submit(bot, "9811100003");
            await Submit(rejecting, "9811100004");
            await WaitFor("hooks.example/flaky", "9811100003", count: 3);   // first try + 2 retries
            await WaitFor("hooks.example/rejects", "9811100004");
            await Task.Delay(300);
            Assert.Single(factory.Outbound.To("hooks.example/rejects"), c => c.Body.Contains("9811100004"));
        }
        finally
        {
            factory.Outbound.Status = null;
            WebhookSender.Delay = Task.Delay;
        }
    }

    [Fact]
    public async Task Owner_can_send_test_alerts()
    {
        var (owner, bot) = await Bot(new { alertEmail = "Desk@Inst.example" });
        Assert.Equal("desk@inst.example", bot.AlertEmail);

        var noHook = await owner.PostAsJsonAsync($"/bots/{bot.Id}/alerts/test", new { kind = "webhook" });
        Assert.Equal(HttpStatusCode.BadRequest, noHook.StatusCode);

        var email = await (await owner.PostAsJsonAsync($"/bots/{bot.Id}/alerts/test", new { kind = "email" })).Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(email.GetProperty("ok").GetBoolean());
        Assert.Contains(factory.Outbound.To("/lead-alert"), c => c.Body.Contains("desk@inst.example") && c.Body.Contains("Test Lead"));

        await owner.PutAsJsonAsync($"/bots/{bot.Id}", new { name = bot.Name, webhookUrl = "https://hooks.example/test-b" });
        factory.Outbound.Status = u => u.AbsolutePath == "/test-b" ? HttpStatusCode.Forbidden : HttpStatusCode.OK;
        try
        {
            var hook = await (await owner.PostAsJsonAsync($"/bots/{bot.Id}/alerts/test", new { kind = "webhook" })).Content.ReadFromJsonAsync<JsonElement>();
            Assert.False(hook.GetProperty("ok").GetBoolean());
            Assert.Equal(403, hook.GetProperty("status").GetInt32());
            Assert.Contains("lead.test", factory.Outbound.To("hooks.example/test-b").Last().Body);
        }
        finally
        {
            factory.Outbound.Status = null;
        }
    }

    [Fact]
    public async Task Alert_and_action_settings_are_validated()
    {
        var (owner, bot) = await Bot();
        foreach (var bad in new object[]
                 {
                     new { name = "x", alertEmail = "nope" }, new { name = "x", webhookUrl = "ftp://x.example" },
                     new { name = "x", webhookUrl = "javascript:alert(1)" }, new { name = "x", bookingUrl = "not a url" },
                     new { name = "x", upiId = "abc" }, new { name = "x", bookingLabel = "" },
                     new { name = "x", paymentLabel = new string('a', 41) },
                 })
            Assert.Equal(HttpStatusCode.BadRequest, (await owner.PutAsJsonAsync($"/bots/{bot.Id}", bad)).StatusCode);
    }

    [Fact]
    public async Task Booking_and_payment_buttons_reach_the_chat()
    {
        var (owner, bot) = await Bot(new
        {
            bookingUrl = "https://calendly.com/sunrise/demo", bookingLabel = "Book a free demo class",
            upiId = "sunrise@okaxis", paymentLabel = "Pay admission fee"
        });
        var msg = new HttpRequestMessage(HttpMethod.Get, $"/internal/bots/{bot.PublicKey}");
        msg.Headers.Add("X-Internal-Key", BotsApiFactory.InternalKey);
        var info = await (await factory.CreateClient().SendAsync(msg)).Content.ReadFromJsonAsync<JsonElement>();
        var actions = info.GetProperty("actions").EnumerateArray().ToList();
        Assert.Equal(2, actions.Count);
        Assert.Equal(("booking", "Book a free demo class", "https://calendly.com/sunrise/demo"),
            (actions[0].GetProperty("kind").GetString(), actions[0].GetProperty("label").GetString(), actions[0].GetProperty("url").GetString()));
        Assert.Equal("upi", actions[1].GetProperty("kind").GetString());
        Assert.Equal("Pay admission fee", actions[1].GetProperty("label").GetString());
        Assert.Equal("upi://pay?pa=sunrise%40okaxis&pn=Alert%20Bot&cu=INR", actions[1].GetProperty("url").GetString());

        // clearing a link removes its button
        await owner.PutAsJsonAsync($"/bots/{bot.Id}", new { name = bot.Name, bookingUrl = "", upiId = "" });
        var after = await (await factory.CreateClient().SendAsync(Clone(msg))).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Empty(after.GetProperty("actions").EnumerateArray());
    }

    private static HttpRequestMessage Clone(HttpRequestMessage m)
    {
        var c = new HttpRequestMessage(m.Method, m.RequestUri);
        foreach (var h in m.Headers) c.Headers.Add(h.Key, h.Value);
        return c;
    }
}
