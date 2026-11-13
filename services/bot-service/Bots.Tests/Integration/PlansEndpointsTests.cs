using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Bots.Api;
using Bots.Api.Billing;
using Bots.Api.Data;
using Bots.Api.Messaging;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Bots.Tests.Integration;

[Trait("Level", "Integration")]
[Collection(BotsApiCollection.Name)]
public class PlansEndpointsTests(BotsApiFactory factory)
{
    private async Task<BotDto> CreateBot(HttpClient owner, string name = "Plan Bot")
    {
        var res = await owner.PostAsJsonAsync("/bots", new { name });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        return (await res.Content.ReadFromJsonAsync<BotDto>())!;
    }

    private async Task<JsonElement> Account(HttpClient owner) =>
        await owner.GetFromJsonAsync<JsonElement>("/account");

    private Task<HttpResponseMessage> Internal(HttpMethod method, string path, object? body = null)
    {
        var msg = new HttpRequestMessage(method, path);
        if (body is not null) msg.Content = JsonContent.Create(body);
        msg.Headers.Add("X-Internal-Key", BotsApiFactory.InternalKey);
        return factory.CreateClient().SendAsync(msg);
    }

    private Task<HttpResponseMessage> Admin(HttpMethod method, string path, object? body = null, string key = BotsApiFactory.AdminKey)
    {
        var msg = new HttpRequestMessage(method, path);
        if (body is not null) msg.Content = JsonContent.Create(body);
        msg.Headers.Add("X-Admin-Key", key);
        return factory.CreateClient().SendAsync(msg);
    }

    private async Task Db(Func<AppDbContext, Task> action)
    {
        using var scope = factory.Services.CreateScope();
        await action(scope.ServiceProvider.GetRequiredService<AppDbContext>());
    }

    private async Task<(bool Allowed, string? Reason)> ConsumeAnswer(string publicKey)
    {
        var res = await Internal(HttpMethod.Post, $"/internal/bots/{publicKey}/answers");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var json = await res.Content.ReadFromJsonAsync<JsonElement>();
        return (json.GetProperty("allowed").GetBoolean(),
                json.GetProperty("reason").ValueKind == JsonValueKind.Null ? null : json.GetProperty("reason").GetString());
    }

    [Fact]
    public async Task A_new_business_starts_a_free_trial()
    {
        var owner = factory.ClientFor(Guid.NewGuid());
        var account = await Account(owner);
        Assert.Equal("trial", account.GetProperty("plan").GetProperty("id").GetString());
        Assert.Equal("trialing", account.GetProperty("subscription").GetProperty("status").GetString());
        var trialEnds = account.GetProperty("subscription").GetProperty("trialEndsAt").GetDateTime();
        Assert.InRange(trialEnds, DateTime.UtcNow.AddDays(13.9), DateTime.UtcNow.AddDays(14.1));
        Assert.Equal(0, account.GetProperty("usage").GetProperty("answers").GetInt32());
        Assert.Equal(3, account.GetProperty("plans").GetArrayLength());
    }

    [Fact]
    public async Task The_plan_limits_the_number_of_bots()
    {
        var owner = factory.ClientFor(Guid.NewGuid());
        for (var i = 0; i < Plans.Trial.Bots; i++) await CreateBot(owner, $"Bot {i}");

        var res = await owner.PostAsJsonAsync("/bots", new { name = "One too many" });
        Assert.Equal(HttpStatusCode.PaymentRequired, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("plan_limit", body.GetProperty("code").GetString());
        Assert.Contains("Upgrade", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task After_the_trial_bots_stop_answering_and_nothing_new_can_be_added()
    {
        var tenant = Guid.NewGuid();
        var owner = factory.ClientFor(tenant);
        var bot = await CreateBot(owner);
        await Db(async db =>
        {
            var s = await db.Subscriptions.SingleAsync(x => x.TenantId == tenant);
            s.TrialEndsAt = DateTime.UtcNow.AddMinutes(-1);
            await db.SaveChangesAsync();
        });

        Assert.Equal("expired", (await Account(owner)).GetProperty("plan").GetProperty("id").GetString());
        Assert.Equal(HttpStatusCode.PaymentRequired, (await owner.PostAsJsonAsync("/bots", new { name = "x" })).StatusCode);
        Assert.Equal((false, "inactive"), await ConsumeAnswer(bot.PublicKey));

        var lookup = await (await Internal(HttpMethod.Get, $"/internal/bots/{bot.PublicKey}")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(lookup.GetProperty("active").GetBoolean());

        // the owner still sees everything that was collected
        Assert.Equal(HttpStatusCode.OK, (await owner.GetAsync($"/bots/{bot.Id}/leads")).StatusCode);
    }

    [Fact]
    public async Task Answers_are_counted_until_the_monthly_limit()
    {
        var tenant = Guid.NewGuid();
        var owner = factory.ClientFor(tenant);
        var bot = await CreateBot(owner);

        Assert.Equal((true, null), await ConsumeAnswer(bot.PublicKey));
        Assert.Equal(1, (await Account(owner)).GetProperty("usage").GetProperty("answers").GetInt32());

        await Db(async db =>
        {
            var u = await db.Usage.SingleAsync(x => x.TenantId == tenant);
            u.Answers = Plans.Trial.AnswersPerMonth - 1;
            await db.SaveChangesAsync();
        });
        Assert.Equal((true, null), await ConsumeAnswer(bot.PublicKey));
        Assert.Equal((false, "limit"), await ConsumeAnswer(bot.PublicKey));
        Assert.Equal(Plans.Trial.AnswersPerMonth, (await Account(owner)).GetProperty("usage").GetProperty("answers").GetInt32());
    }

    [Fact]
    public async Task A_failed_answer_is_given_back()
    {
        var tenant = Guid.NewGuid();
        var owner = factory.ClientFor(tenant);
        var bot = await CreateBot(owner);
        await ConsumeAnswer(bot.PublicKey);
        Assert.Equal(HttpStatusCode.NoContent, (await Internal(HttpMethod.Post, $"/internal/bots/{bot.PublicKey}/answers/refund")).StatusCode);
        Assert.Equal(0, (await Account(owner)).GetProperty("usage").GetProperty("answers").GetInt32());
        // never below zero
        await Internal(HttpMethod.Post, $"/internal/bots/{bot.PublicKey}/answers/refund");
        Assert.Equal(0, (await Account(owner)).GetProperty("usage").GetProperty("answers").GetInt32());
    }

    [Fact]
    public async Task Concurrent_answers_never_exceed_the_limit()
    {
        var tenant = Guid.NewGuid();
        var bot = await CreateBot(factory.ClientFor(tenant));
        await Db(async db =>
        {
            db.Usage.Add(new UsageCounter { TenantId = tenant, Period = Plans.Period(DateTime.UtcNow), Answers = Plans.Trial.AnswersPerMonth - 5 });
            await db.SaveChangesAsync();
        });

        var results = await Task.WhenAll(Enumerable.Range(0, 20).Select(_ => ConsumeAnswer(bot.PublicKey)));
        Assert.Equal(5, results.Count(r => r.Allowed));
    }

    [Fact]
    public async Task Admin_routes_need_the_admin_key()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().GetAsync("/admin/subscriptions")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Admin(HttpMethod.Get, "/admin/subscriptions", key: "wrong")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Admin(HttpMethod.Get, "/admin/subscriptions")).StatusCode);
        // a dashboard login is not enough
        var owner = factory.ClientFor(Guid.NewGuid());
        Assert.Equal(HttpStatusCode.Unauthorized, (await owner.GetAsync("/admin/subscriptions")).StatusCode);
    }

    [Fact]
    public async Task Admin_sets_a_paid_plan_after_a_manual_payment()
    {
        var tenant = Guid.NewGuid();
        var owner = factory.ClientFor(tenant);
        var bot = await CreateBot(owner);

        var res = await Admin(HttpMethod.Put, $"/admin/subscriptions/{tenant}", new { plan = "business", months = 1 });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);

        var account = await Account(owner);
        Assert.Equal("business", account.GetProperty("plan").GetProperty("id").GetString());
        var end = account.GetProperty("subscription").GetProperty("currentPeriodEnd").GetDateTime();
        Assert.InRange(end, DateTime.UtcNow.AddDays(27), DateTime.UtcNow.AddDays(32));

        // Business removes the "Powered by" badge
        var lookup = await (await Internal(HttpMethod.Get, $"/internal/bots/{bot.PublicKey}")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(lookup.GetProperty("showBranding").GetBoolean());

        // paying again extends from the current end date
        await Admin(HttpMethod.Put, $"/admin/subscriptions/{tenant}", new { plan = "business", months = 1 });
        var extended = (await Account(owner)).GetProperty("subscription").GetProperty("currentPeriodEnd").GetDateTime();
        Assert.InRange(extended, end.AddDays(27), end.AddDays(32));

        Assert.Equal(HttpStatusCode.BadRequest,
            (await Admin(HttpMethod.Put, $"/admin/subscriptions/{tenant}", new { plan = "gold", months = 1 })).StatusCode);
    }

    [Fact]
    public async Task Trial_bots_show_the_badge()
    {
        var bot = await CreateBot(factory.ClientFor(Guid.NewGuid()));
        var lookup = await (await Internal(HttpMethod.Get, $"/internal/bots/{bot.PublicKey}")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(lookup.GetProperty("showBranding").GetBoolean());
        Assert.True(lookup.GetProperty("active").GetBoolean());
    }

    [Fact]
    public async Task Checkout_explains_when_online_payment_is_not_set_up()
    {
        var owner = factory.ClientFor(Guid.NewGuid());
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync("/account/checkout", new { plan = "gold" })).StatusCode);
        var res = await owner.PostAsJsonAsync("/account/checkout", new { plan = "starter" });
        Assert.Equal(HttpStatusCode.ServiceUnavailable, res.StatusCode);
        Assert.Contains("contact", (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());
    }

    private static string Sign(string body) =>
        Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(BotsApiFactory.WebhookSecret), Encoding.UTF8.GetBytes(body))).ToLowerInvariant();

    private static string WebhookBody(string evt, string subscriptionId, Guid tenant, string plan, DateTime end) =>
        JsonSerializer.Serialize(new
        {
            @event = evt,
            payload = new
            {
                subscription = new
                {
                    entity = new
                    {
                        id = subscriptionId, status = "active",
                        current_end = new DateTimeOffset(end).ToUnixTimeSeconds(),
                        notes = new { tenant_id = tenant.ToString(), plan }
                    }
                }
            }
        });

    private Task<HttpResponseMessage> PostWebhook(string body, string? signature)
    {
        var msg = new HttpRequestMessage(HttpMethod.Post, "/billing/razorpay/webhook") { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        if (signature is not null) msg.Headers.Add("X-Razorpay-Signature", signature);
        return factory.CreateClient().SendAsync(msg);
    }

    [Fact]
    public async Task Razorpay_webhooks_activate_the_paid_plan()
    {
        var tenant = Guid.NewGuid();
        var owner = factory.ClientFor(tenant);
        var end = DateTime.UtcNow.AddDays(30);
        var body = WebhookBody("subscription.charged", "sub_TEST1", tenant, "pro", end);

        Assert.Equal(HttpStatusCode.Unauthorized, (await PostWebhook(body, null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await PostWebhook(body, Sign(body + " "))).StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await PostWebhook(body, Sign(body))).StatusCode);
        var account = await Account(owner);
        Assert.Equal("pro", account.GetProperty("plan").GetProperty("id").GetString());
        Assert.Equal("razorpay", account.GetProperty("subscription").GetProperty("provider").GetString());

        // cancelled: keeps working until the paid period ends
        var cancelled = WebhookBody("subscription.cancelled", "sub_TEST1", tenant, "pro", end);
        Assert.Equal(HttpStatusCode.OK, (await PostWebhook(cancelled, Sign(cancelled))).StatusCode);
        account = await Account(owner);
        Assert.Equal("cancelled", account.GetProperty("subscription").GetProperty("status").GetString());
        Assert.Equal("pro", account.GetProperty("plan").GetProperty("id").GetString());

        // a late event about some other, older subscription does not change anything
        var stale = WebhookBody("subscription.halted", "sub_OLD", tenant, "starter", end);
        await PostWebhook(stale, Sign(stale));
        Assert.Equal("cancelled", (await Account(owner)).GetProperty("subscription").GetProperty("status").GetString());
    }

    [Fact]
    public async Task Deleting_an_account_removes_all_its_data()
    {
        var tenant = Guid.NewGuid();
        var owner = factory.ClientFor(tenant);
        var bot = await CreateBot(owner);
        await Account(owner);

        Assert.Equal(HttpStatusCode.Unauthorized,
            (await factory.CreateClient().DeleteAsync($"/internal/tenants/{tenant}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await Internal(HttpMethod.Delete, $"/internal/tenants/{tenant}")).StatusCode);

        Assert.Empty((await owner.GetFromJsonAsync<List<BotDto>>("/bots"))!);
        Assert.Contains(factory.Publisher.Of<BotDeleted>("bot.deleted"), e => e.BotId == bot.Id);
        await Db(async db => Assert.False(await db.Subscriptions.AnyAsync(s => s.TenantId == tenant)));
    }

    [Fact]
    public async Task Export_contains_bots_and_their_data()
    {
        var owner = factory.ClientFor(Guid.NewGuid());
        await CreateBot(owner, "Export Bot");
        var res = await owner.GetAsync("/account/export");
        Assert.Equal("application/json", res.Content.Headers.ContentType?.MediaType);
        var json = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Export Bot", json.GetProperty("bots")[0].GetProperty("bot").GetProperty("name").GetString());
    }
}
