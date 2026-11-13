using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Bots.Api;

namespace Bots.Tests.Integration;

[Trait("Level", "Integration")]
[Collection(BotsApiCollection.Name)]
public class ConversationsEndpointsTests(BotsApiFactory factory)
{
    private async Task<(HttpClient Owner, BotDto Bot)> NewBot(string name = "Chat Log Bot")
    {
        var owner = factory.ClientFor(Guid.NewGuid());
        var res = await owner.PostAsJsonAsync("/bots", new { name });
        return (owner, (await res.Content.ReadFromJsonAsync<BotDto>())!);
    }

    private Task<HttpResponseMessage> Record(string publicKey, object turn, string? key = BotsApiFactory.InternalKey)
    {
        var msg = new HttpRequestMessage(HttpMethod.Post, $"/internal/bots/{publicKey}/conversations") { Content = JsonContent.Create(turn) };
        if (key is not null) msg.Headers.Add("X-Internal-Key", key);
        return factory.CreateClient().SendAsync(msg);
    }

    [Fact]
    public async Task Turns_are_stored_per_conversation_and_listed_newest_first()
    {
        var (owner, bot) = await NewBot();
        var first = Guid.NewGuid();
        var second = Guid.NewGuid();

        Assert.Equal(HttpStatusCode.OK, (await Record(bot.PublicKey, new
        {
            conversationId = first, question = "What are the fees?", answer = "₹68,000 per year.", answered = true,
            pageUrl = "https://inst.example/fees?token=secret"
        })).StatusCode);
        await Record(bot.PublicKey, new { conversationId = first, question = "Do you have a hostel?", answer = "I don't have that information.", answered = false });
        await Record(bot.PublicKey, new { conversationId = second, question = "Timings?", answer = "7 to 10 AM.", answered = true });

        var list = (await owner.GetFromJsonAsync<List<ConversationSummaryDto>>($"/bots/{bot.Id}/conversations"))!;
        Assert.Equal([second, first], list.Select(c => c.Id));
        var c1 = list[1];
        Assert.Equal(4, c1.MessageCount);
        Assert.Equal(1, c1.UnansweredCount);
        Assert.Equal("What are the fees?", c1.FirstQuestion);
        Assert.Equal("https://inst.example/fees", c1.PageUrl);   // query string dropped

        var detail = (await owner.GetFromJsonAsync<ConversationDto>($"/bots/{bot.Id}/conversations/{first}"))!;
        Assert.Equal(["user", "assistant", "user", "assistant"], detail.Messages.Select(m => m.Role));
        Assert.Equal("Do you have a hostel?", detail.Messages[2].Text);
        Assert.False(detail.Messages[2].Answered);

        // paging
        var older = (await owner.GetFromJsonAsync<List<ConversationSummaryDto>>(
            $"/bots/{bot.Id}/conversations?take=1&before={Uri.EscapeDataString(list[0].LastMessageAt.ToString("O"))}"))!;
        Assert.Equal([first], older.Select(c => c.Id));
    }

    [Fact]
    public async Task Other_businesses_cannot_read_them()
    {
        var (_, bot) = await NewBot();
        var id = Guid.NewGuid();
        await Record(bot.PublicKey, new { conversationId = id, question = "Private?", answer = "Yes." });

        var stranger = factory.ClientFor(Guid.NewGuid());
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/bots/{bot.Id}/conversations")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/bots/{bot.Id}/conversations/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.DeleteAsync($"/bots/{bot.Id}/conversations/{id}")).StatusCode);
    }

    [Fact]
    public async Task A_conversation_id_cannot_be_reused_for_another_bot()
    {
        var (_, a) = await NewBot("A");
        var (_, b) = await NewBot("B");
        var id = Guid.NewGuid();
        await Record(a.PublicKey, new { conversationId = id, question = "Hi", answer = "Hello" });
        Assert.Equal(HttpStatusCode.Conflict, (await Record(b.PublicKey, new { conversationId = id, question = "Hi", answer = "Hello" })).StatusCode);
    }

    [Fact]
    public async Task Recording_needs_the_internal_key_and_valid_input()
    {
        var (_, bot) = await NewBot();
        var turn = new { conversationId = Guid.NewGuid(), question = "Q", answer = "A" };
        Assert.Equal(HttpStatusCode.Unauthorized, (await Record(bot.PublicKey, turn, key: null)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Record(bot.PublicKey, new { question = "Q", answer = "A" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Record("bk_00000000000000000000000000000000", turn)).StatusCode);
    }

    [Fact]
    public async Task Owner_can_delete_a_conversation_and_it_goes_with_the_bot()
    {
        var (owner, bot) = await NewBot();
        var id = Guid.NewGuid();
        await Record(bot.PublicKey, new { conversationId = id, question = "Delete me", answer = "OK" });

        Assert.Equal(HttpStatusCode.NoContent, (await owner.DeleteAsync($"/bots/{bot.Id}/conversations/{id}")).StatusCode);
        Assert.Empty((await owner.GetFromJsonAsync<List<ConversationSummaryDto>>($"/bots/{bot.Id}/conversations"))!);

        await Record(bot.PublicKey, new { conversationId = Guid.NewGuid(), question = "Again", answer = "OK" });
        Assert.Equal(HttpStatusCode.NoContent, (await owner.DeleteAsync($"/bots/{bot.Id}")).StatusCode);
    }

    [Fact]
    public async Task Monthly_report_numbers_per_business()
    {
        var tenant = Guid.NewGuid();
        var owner = factory.ClientFor(tenant);
        var bot = (await (await owner.PostAsJsonAsync("/bots", new { name = "Report Bot" })).Content.ReadFromJsonAsync<BotDto>())!;
        var id = Guid.NewGuid();
        await Record(bot.PublicKey, new { conversationId = id, question = "Fees?", answer = "₹500", answered = true });
        await Record(bot.PublicKey, new { conversationId = id, question = "Parking?", answer = "Not sure", answered = false });

        var msg = new HttpRequestMessage(HttpMethod.Get, $"/internal/reports/monthly?period={DateTime.UtcNow:yyyy-MM}");
        msg.Headers.Add("X-Internal-Key", BotsApiFactory.InternalKey);
        var rows = await (await factory.CreateClient().SendAsync(msg)).Content.ReadFromJsonAsync<JsonElement>();
        var mine = rows.EnumerateArray().Single(r => r.GetProperty("tenantId").GetGuid() == tenant);
        Assert.Equal(1, mine.GetProperty("bots").GetInt32());
        Assert.Equal(1, mine.GetProperty("conversations").GetInt32());
        Assert.Equal(1, mine.GetProperty("unanswered").GetInt32());
    }
}
