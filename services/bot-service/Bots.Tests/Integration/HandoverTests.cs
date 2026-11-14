using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Bots.Api;

namespace Bots.Tests.Integration;

[Trait("Level", "Integration")]
[Collection(BotsApiCollection.Name)]
public class HandoverTests(BotsApiFactory factory)
{
    private async Task<(HttpClient Owner, BotDto Bot)> NewBot()
    {
        var owner = factory.ClientFor(Guid.NewGuid());
        var bot = (await (await owner.PostAsJsonAsync("/bots", new { name = "Handover Bot" })).Content.ReadFromJsonAsync<BotDto>())!;
        return (owner, bot);
    }

    private Task<HttpResponseMessage> Internal(HttpMethod method, string path, object? body = null)
    {
        var msg = new HttpRequestMessage(method, path);
        if (body is not null) msg.Content = JsonContent.Create(body);
        msg.Headers.Add("X-Internal-Key", BotsApiFactory.InternalKey);
        return factory.CreateClient().SendAsync(msg);
    }

    private async Task<Guid> Turn(BotDto bot, Guid? id = null, object? extra = null)
    {
        var conversationId = id ?? Guid.NewGuid();
        var body = new Dictionary<string, object?> { ["conversationId"] = conversationId, ["question"] = "Fees?", ["answer"] = "Rs 500." };
        if (extra is not null)
            foreach (var p in JsonSerializer.SerializeToElement(extra).EnumerateObject()) body[p.Name] = p.Value;
        var res = await Internal(HttpMethod.Post, $"/internal/bots/{bot.PublicKey}/conversations", body);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        return conversationId;
    }

    private async Task<JsonElement> Updates(BotDto bot, Guid conversationId, DateTime? after = null) =>
        await (await Internal(HttpMethod.Get, $"/internal/bots/{bot.PublicKey}/conversations/{conversationId}/updates" +
            (after is null ? "" : $"?after={Uri.EscapeDataString(after.Value.ToString("O"))}"))).Content.ReadFromJsonAsync<JsonElement>();

    [Fact]
    public async Task Owner_takes_over_a_website_chat_replies_and_hands_it_back()
    {
        var (owner, bot) = await NewBot();
        var id = await Turn(bot);
        Assert.False((await Updates(bot, id)).GetProperty("human").GetBoolean());

        var take = await (await owner.PostAsync($"/bots/{bot.Id}/conversations/{id}/takeover", null)).Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(take.GetProperty("human").GetBoolean());

        var reply = await owner.PostAsJsonAsync($"/bots/{bot.Id}/conversations/{id}/reply", new { text = "Hi, this is Priya from the office." });
        Assert.Equal(HttpStatusCode.OK, reply.StatusCode);

        // the widget polls: the owner's message and the human flag
        var updates = await Updates(bot, id);
        Assert.True(updates.GetProperty("human").GetBoolean());
        var messages = updates.GetProperty("messages").EnumerateArray().ToList();
        Assert.Equal("Hi, this is Priya from the office.", Assert.Single(messages).GetProperty("text").GetString());
        var seen = messages[0].GetProperty("createdAt").GetDateTime();
        Assert.Empty((await Updates(bot, id, seen)).GetProperty("messages").EnumerateArray());

        // while a person is replying, the chat service stores only what the visitor wrote
        await Turn(bot, id, new { answer = (string?)null, visitorOnly = true, question = "Thanks! Can I come at 5?" });
        var thread = await owner.GetFromJsonAsync<JsonElement>($"/bots/{bot.Id}/conversations/{id}");
        Assert.True(thread.GetProperty("human").GetBoolean());
        Assert.Equal(["user", "assistant", "agent", "user"],
            thread.GetProperty("messages").EnumerateArray().Select(m => m.GetProperty("role").GetString()).ToArray());
        var list = await owner.GetFromJsonAsync<JsonElement>($"/bots/{bot.Id}/conversations");
        Assert.True(list.EnumerateArray().Single(c => c.GetProperty("id").GetGuid() == id).GetProperty("human").GetBoolean());

        await owner.PostAsync($"/bots/{bot.Id}/conversations/{id}/release", null);
        Assert.False((await Updates(bot, id)).GetProperty("human").GetBoolean());
    }

    [Fact]
    public async Task Replies_in_a_messaging_app_go_out_through_the_chat_service()
    {
        var (owner, bot) = await NewBot();
        factory.Platform.Override = r => r.RequestUri!.ToString().Contains("/getMe")
            ? new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("""{"ok":true,"result":{"id":424242001,"username":"handover_bot"}}""", Encoding.UTF8, "application/json") }
            : null;
        ChannelDto channel;
        try
        {
            var res = await owner.PostAsJsonAsync($"/bots/{bot.Id}/channels", new { kind = "telegram", token = "424242001:AAH-abcdefghijklmnopqrstuvwxyz012345" });
            Assert.Equal(HttpStatusCode.Created, res.StatusCode);
            channel = (await res.Content.ReadFromJsonAsync<ChannelDto>())!;
        }
        finally
        {
            factory.Platform.Override = null;
        }
        var id = await Turn(bot, extra: new { channel = "telegram", contactName = "Asha", contactId = "5550001" });

        var reply = await owner.PostAsJsonAsync($"/bots/{bot.Id}/conversations/{id}/reply", new { text = "Calling you now." });
        Assert.Equal(HttpStatusCode.OK, reply.StatusCode);
        var call = factory.Outbound.To($"/internal/channels/{channel.Id}/send").Single();
        Assert.Equal("http://localhost:8000/internal/channels/" + channel.Id + "/send", call.Url);
        Assert.Equal(BotsApiFactory.InternalKey, call.Headers["X-Internal-Key"]);
        Assert.Equal(("5550001", "Calling you now."), (JsonDocument.Parse(call.Body).RootElement.GetProperty("to").GetString(),
            JsonDocument.Parse(call.Body).RootElement.GetProperty("text").GetString()));
        Assert.True((await Updates(bot, id)).GetProperty("human").GetBoolean());   // replying takes over

        // the platform refused: the owner sees why and nothing is stored as sent
        factory.Outbound.Status = u => u.AbsolutePath.EndsWith("/send") ? HttpStatusCode.BadGateway : HttpStatusCode.OK;
        try
        {
            var failed = await owner.PostAsJsonAsync($"/bots/{bot.Id}/conversations/{id}/reply", new { text = "Second try" });
            Assert.Equal(HttpStatusCode.BadGateway, failed.StatusCode);
        }
        finally
        {
            factory.Outbound.Status = null;
        }
        var thread = await owner.GetFromJsonAsync<JsonElement>($"/bots/{bot.Id}/conversations/{id}");
        Assert.Single(thread.GetProperty("messages").EnumerateArray(), m => m.GetProperty("role").GetString() == "agent");
        Assert.Equal("Asha", thread.GetProperty("contactName").GetString());
    }

    [Fact]
    public async Task Replies_are_checked_and_other_businesses_cannot_take_over()
    {
        var (owner, bot) = await NewBot();
        var id = await Turn(bot);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync($"/bots/{bot.Id}/conversations/{id}/reply", new { text = " " })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync($"/bots/{bot.Id}/conversations/{id}/reply",
            new { text = new string('a', Handover.MaxReplyChars + 1) })).StatusCode);

        var stranger = factory.ClientFor(Guid.NewGuid());
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.PostAsync($"/bots/{bot.Id}/conversations/{id}/takeover", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.PostAsJsonAsync($"/bots/{bot.Id}/conversations/{id}/reply", new { text = "hi" })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await factory.CreateClient().GetAsync($"/internal/bots/{bot.PublicKey}/conversations/{id}/updates")).StatusCode);
        // an unknown conversation is simply a new visitor
        Assert.False((await Updates(bot, Guid.NewGuid())).GetProperty("human").GetBoolean());
    }

    [Fact]
    public void Takeover_expires_after_the_window()
    {
        var now = DateTime.UtcNow;
        Assert.True(Handover.IsHuman(new Bots.Api.Data.Conversation { HumanUntil = now.AddMinutes(1) }, now));
        Assert.False(Handover.IsHuman(new Bots.Api.Data.Conversation { HumanUntil = now.AddMinutes(-1) }, now));
        Assert.False(Handover.IsHuman(new Bots.Api.Data.Conversation(), now));
    }
}
