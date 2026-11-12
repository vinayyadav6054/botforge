using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Bots.Api;

namespace Bots.Tests.Integration;

[Trait("Level", "Integration")]
[Collection(BotsApiCollection.Name)]
public class SuggestedQuestionsEndpointsTests(BotsApiFactory factory)
{
    [Fact]
    public async Task New_bots_have_no_questions_and_an_update_without_them_keeps_them()
    {
        var owner = factory.ClientFor(Guid.NewGuid());
        var bot = (await (await owner.PostAsJsonAsync("/bots", new { name = "Plain" })).Content.ReadFromJsonAsync<BotDto>())!;
        Assert.Empty(bot.SuggestedQuestions);

        var set = await owner.PutAsJsonAsync($"/bots/{bot.Id}",
            new { name = "Plain", suggestedQuestions = new[] { " Fees? ", "", "fees?", "Timings?" } });
        Assert.Equal(HttpStatusCode.OK, set.StatusCode);
        Assert.Equal(new[] { "Fees?", "Timings?" }, (await set.Content.ReadFromJsonAsync<BotDto>())!.SuggestedQuestions);

        var rename = await owner.PutAsJsonAsync($"/bots/{bot.Id}", new { name = "Renamed" });
        Assert.Equal(new[] { "Fees?", "Timings?" }, (await rename.Content.ReadFromJsonAsync<BotDto>())!.SuggestedQuestions);

        var clear = await owner.PutAsJsonAsync($"/bots/{bot.Id}", new { name = "Renamed", suggestedQuestions = Array.Empty<string>() });
        Assert.Empty((await clear.Content.ReadFromJsonAsync<BotDto>())!.SuggestedQuestions);
    }

    [Fact]
    public async Task Questions_can_be_set_on_create_and_too_many_are_rejected()
    {
        var owner = factory.ClientFor(Guid.NewGuid());
        var created = await owner.PostAsJsonAsync("/bots", new { name = "Admissions", suggestedQuestions = new[] { "Fees?" } });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var bot = (await created.Content.ReadFromJsonAsync<BotDto>())!;
        Assert.Equal(new[] { "Fees?" }, bot.SuggestedQuestions);

        var tooMany = await owner.PutAsJsonAsync($"/bots/{bot.Id}",
            new { name = "Admissions", suggestedQuestions = new[] { "a", "b", "c", "d", "e" } });
        Assert.Equal(HttpStatusCode.BadRequest, tooMany.StatusCode);
    }

    [Fact]
    public async Task Internal_lookup_returns_the_questions()
    {
        var owner = factory.ClientFor(Guid.NewGuid());
        var created = await owner.PostAsJsonAsync("/bots", new { name = "Admissions", suggestedQuestions = new[] { "Fees?", "Batches?" } });
        var bot = (await created.Content.ReadFromJsonAsync<BotDto>())!;

        var msg = new HttpRequestMessage(HttpMethod.Get, $"/internal/bots/{bot.PublicKey}");
        msg.Headers.Add("X-Internal-Key", BotsApiFactory.InternalKey);
        var body = await (await factory.CreateClient().SendAsync(msg)).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(new[] { "Fees?", "Batches?" },
            body.GetProperty("suggestedQuestions").EnumerateArray().Select(q => q.GetString()).ToArray());
    }
}
