using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Bots.Api;
using Bots.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Bots.Tests.Integration;

[Trait("Level", "Integration")]
[Collection(BotsApiCollection.Name)]
public class ChannelsEndpointsTests(BotsApiFactory factory)
{
    private const string TelegramToken = "123456789:AAH-abcdefghijklmnopqrstuvwxyz012345";

    private async Task<(HttpClient Owner, BotDto Bot, Guid Tenant)> NewBot()
    {
        var tenant = Guid.NewGuid();
        var owner = factory.ClientFor(tenant);
        var bot = (await (await owner.PostAsJsonAsync("/bots", new { name = "Channel Bot" })).Content.ReadFromJsonAsync<BotDto>())!;
        return (owner, bot, tenant);
    }

    private Task<HttpResponseMessage> Internal(HttpMethod method, string path, object? body = null)
    {
        var msg = new HttpRequestMessage(method, path);
        if (body is not null) msg.Content = JsonContent.Create(body);
        msg.Headers.Add("X-Internal-Key", BotsApiFactory.InternalKey);
        return factory.CreateClient().SendAsync(msg);
    }

    [Fact]
    public async Task Telegram_is_checked_connected_and_disconnected()
    {
        var (owner, bot, _) = await NewBot();
        Assert.Equal(HttpStatusCode.BadRequest,
            (await owner.PostAsJsonAsync($"/bots/{bot.Id}/channels", new { kind = "telegram", token = "not-a-token" })).StatusCode);

        var res = await owner.PostAsJsonAsync($"/bots/{bot.Id}/channels", new { kind = "telegram", token = TelegramToken });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var channel = (await res.Content.ReadFromJsonAsync<ChannelDto>())!;
        Assert.Equal("@sunrise_bot", channel.DisplayName);
        Assert.Equal($"https://bots.test/api/channels/telegram/{channel.Id}", channel.WebhookUrl);
        Assert.Null(channel.VerifyToken);   // Telegram uses the secret header instead

        var hook = factory.Platform.Calls.Last(c => c.Url.Contains("/setWebhook"));
        Assert.Contains(channel.WebhookUrl, hook.Body);
        Assert.Contains("secret_token", hook.Body);

        // secrets: never in the dashboard API, encrypted in the database, readable by the chat service
        Assert.DoesNotContain(TelegramToken, await owner.GetStringAsync($"/bots/{bot.Id}/channels"));
        using (var scope = factory.Services.CreateScope())
        {
            var stored = await scope.ServiceProvider.GetRequiredService<AppDbContext>().Channels.IgnoreQueryFilters().SingleAsync(c => c.Id == channel.Id);
            Assert.DoesNotContain(TelegramToken, stored.SecretsCipher);
        }
        var inside = await (await Internal(HttpMethod.Get, $"/internal/channels/{channel.Id}")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(TelegramToken, inside.GetProperty("secrets").GetProperty("token").GetString());
        Assert.Equal(bot.PublicKey, inside.GetProperty("botPublicKey").GetString());
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().GetAsync($"/internal/channels/{channel.Id}")).StatusCode);

        // the same Telegram bot cannot be connected twice
        var (other, otherBot, _) = await NewBot();
        Assert.Equal(HttpStatusCode.Conflict,
            (await other.PostAsJsonAsync($"/bots/{otherBot.Id}/channels", new { kind = "telegram", token = TelegramToken })).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await owner.DeleteAsync($"/bots/{bot.Id}/channels/{channel.Id}")).StatusCode);
        Assert.Contains(factory.Platform.Calls, c => c.Url.Contains("/deleteWebhook"));
    }

    [Fact]
    public async Task WhatsApp_shows_the_number_and_the_webhook_details_for_Meta()
    {
        var (owner, bot, _) = await NewBot();
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync($"/bots/{bot.Id}/channels",
            new { kind = "whatsapp", phoneNumberId = "123", accessToken = "x" })).StatusCode);

        var phoneId = Random.Shared.NextInt64(100000000, 999999999).ToString();
        var res = await owner.PostAsJsonAsync($"/bots/{bot.Id}/channels", new
        {
            kind = "whatsapp", phoneNumberId = phoneId, accessToken = "EAAG" + new string('x', 40), appSecret = "app-secret-123"
        });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var channel = (await res.Content.ReadFromJsonAsync<ChannelDto>())!;
        Assert.Equal("+91 98200 12345", channel.DisplayName);
        Assert.Equal(40, channel.VerifyToken!.Length);
        Assert.Equal($"https://bots.test/api/channels/whatsapp/{channel.Id}", channel.WebhookUrl);
    }

    [Fact]
    public async Task Instagram_needs_a_linked_professional_account()
    {
        var (owner, bot, _) = await NewBot();
        var res = await owner.PostAsJsonAsync($"/bots/{bot.Id}/channels", new { kind = "instagram", pageToken = "EAAP" + new string('y', 40), appSecret = "s" });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains("Instagram professional account", await res.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Rejected_credentials_are_explained()
    {
        var (owner, bot, _) = await NewBot();
        factory.Platform.Override = r => r.RequestUri!.ToString().Contains("/getMe")
            ? new HttpResponseMessage(HttpStatusCode.Unauthorized) : null;
        try
        {
            var res = await owner.PostAsJsonAsync($"/bots/{bot.Id}/channels", new { kind = "telegram", token = "987654321:AAH-zyxwvutsrqponmlkjihgfedcba543210" });
            Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
            Assert.Contains("rejected", await res.Content.ReadAsStringAsync());
        }
        finally { factory.Platform.Override = null; }
    }

    [Fact]
    public async Task Messaging_apps_need_an_active_plan_that_includes_them()
    {
        var (owner, bot, tenant) = await NewBot();
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var s = await db.Subscriptions.SingleAsync(x => x.TenantId == tenant);
            s.Status = "active"; s.Plan = "starter"; s.CurrentPeriodEnd = DateTime.UtcNow.AddDays(20);
            await db.SaveChangesAsync();
        }
        var res = await owner.PostAsJsonAsync($"/bots/{bot.Id}/channels", new { kind = "telegram", token = TelegramToken });
        Assert.Equal(HttpStatusCode.PaymentRequired, res.StatusCode);
        Assert.Contains("Business and Pro", await res.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Channel_conversations_keep_the_contact_and_give_recent_turns_in_order()
    {
        var (owner, bot, _) = await NewBot();
        var conversation = Guid.NewGuid();
        foreach (var (q, a) in new[] { ("Fees?", "₹68,000."), ("Hostel?", "Yes.") })
        {
            await Internal(HttpMethod.Post, $"/internal/bots/{bot.PublicKey}/conversations", new
            {
                conversationId = conversation, question = q, answer = a, channel = "whatsapp", contactName = "Rohan", contactId = "919820012345"
            });
        }
        var summary = (await owner.GetFromJsonAsync<List<ConversationSummaryDto>>($"/bots/{bot.Id}/conversations"))!.Single();
        Assert.Equal(("whatsapp", "Rohan", "919820012345"), (summary.Channel, summary.ContactName, summary.ContactId));

        var turns = await (await Internal(HttpMethod.Get, $"/internal/conversations/{conversation}/turns?take=10")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(["Fees?", "₹68,000.", "Hostel?", "Yes."], turns.EnumerateArray().Select(t => t.GetProperty("text").GetString()));
    }

    [Fact]
    public async Task Leads_remember_their_channel()
    {
        var (owner, bot, _) = await NewBot();
        await owner.PutAsJsonAsync($"/bots/{bot.Id}", new { name = bot.Name, leadCaptureEnabled = true });
        await Internal(HttpMethod.Post, $"/internal/bots/{bot.PublicKey}/leads", new { name = "Rohan", phone = "+919820012345", channel = "whatsapp" });
        var lead = (await owner.GetFromJsonAsync<List<LeadDto>>($"/bots/{bot.Id}/leads"))!.Single();
        Assert.Equal("whatsapp", lead.Channel);
    }

    [Fact]
    public async Task Reply_language_and_voice_are_settings()
    {
        var (owner, bot, _) = await NewBot();
        Assert.Equal(("auto", true), (bot.ReplyLanguage, bot.VoiceEnabled));
        var res = await owner.PutAsJsonAsync($"/bots/{bot.Id}", new { name = bot.Name, replyLanguage = "hi", voiceEnabled = false });
        var saved = (await res.Content.ReadFromJsonAsync<BotDto>())!;
        Assert.Equal(("hi", false), (saved.ReplyLanguage, saved.VoiceEnabled));
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PutAsJsonAsync($"/bots/{bot.Id}", new { name = bot.Name, replyLanguage = "xx" })).StatusCode);

        var lookup = await (await Internal(HttpMethod.Get, $"/internal/bots/{bot.PublicKey}")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("hi", lookup.GetProperty("style").GetProperty("replyLanguage").GetString());
        Assert.False(lookup.GetProperty("voiceEnabled").GetBoolean());
    }
}
