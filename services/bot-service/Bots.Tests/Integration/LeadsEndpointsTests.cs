using System.Net;
using System.Net.Http.Json;
using Bots.Api;

namespace Bots.Tests.Integration;

[Trait("Level", "Integration")]
[Collection(BotsApiCollection.Name)]
public class LeadsEndpointsTests(BotsApiFactory factory)
{
    private static object Lead(string phone = "9820012345", string name = "Asha") => new
    {
        name, phone, course = "JEE", pageUrl = "https://inst.example/fees?utm=x",
        transcript = new[] { new { role = "user", text = "What are the fees?" } }
    };

    private async Task<(HttpClient Owner, BotDto Bot)> BotWithLeadCapture(bool enabled = true)
    {
        var owner = factory.ClientFor(Guid.NewGuid());
        var created = await owner.PostAsJsonAsync("/bots", new { name = "Admissions Bot" });
        var bot = (await created.Content.ReadFromJsonAsync<BotDto>())!;
        var put = await owner.PutAsJsonAsync($"/bots/{bot.Id}", new
        {
            name = bot.Name, leadCaptureEnabled = enabled, leadPrompt = "Want a call back?", leadAfterMessages = 1
        });
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        return (owner, (await put.Content.ReadFromJsonAsync<BotDto>())!);
    }

    private Task<HttpResponseMessage> SubmitAsync(string publicKey, object lead, string? key = BotsApiFactory.InternalKey)
    {
        var msg = new HttpRequestMessage(HttpMethod.Post, $"/internal/bots/{publicKey}/leads") { Content = JsonContent.Create(lead) };
        if (key is not null) msg.Headers.Add("X-Internal-Key", key);
        return factory.CreateClient().SendAsync(msg);
    }

    [Fact]
    public async Task New_bots_have_lead_capture_off_with_defaults()
    {
        var owner = factory.ClientFor(Guid.NewGuid());
        var bot = (await (await owner.PostAsJsonAsync("/bots", new { name = "Plain" })).Content.ReadFromJsonAsync<BotDto>())!;
        Assert.False(bot.LeadCaptureEnabled);
        Assert.Equal(LeadRules.DefaultPrompt, bot.LeadPrompt);
        Assert.Equal(2, bot.LeadAfterMessages);

        // an update that leaves the lead fields out does not change them
        var put = await owner.PutAsJsonAsync($"/bots/{bot.Id}", new { name = "Renamed" });
        var updated = (await put.Content.ReadFromJsonAsync<BotDto>())!;
        Assert.False(updated.LeadCaptureEnabled);
        Assert.Equal(2, updated.LeadAfterMessages);
    }

    [Fact]
    public async Task Invalid_settings_are_rejected()
    {
        var (owner, bot) = await BotWithLeadCapture();
        var res = await owner.PutAsJsonAsync($"/bots/{bot.Id}", new { name = bot.Name, leadAfterMessages = 99 });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Internal_lookup_returns_lead_settings()
    {
        var (_, bot) = await BotWithLeadCapture();
        var msg = new HttpRequestMessage(HttpMethod.Get, $"/internal/bots/{bot.PublicKey}");
        msg.Headers.Add("X-Internal-Key", BotsApiFactory.InternalKey);
        var body = await (await factory.CreateClient().SendAsync(msg)).Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        var lead = body.GetProperty("leadCapture");
        Assert.True(lead.GetProperty("enabled").GetBoolean());
        Assert.Equal("Want a call back?", lead.GetProperty("prompt").GetString());
        Assert.Equal(1, lead.GetProperty("afterMessages").GetInt32());
    }

    [Fact]
    public async Task Submitting_requires_the_internal_key()
    {
        var (_, bot) = await BotWithLeadCapture();
        Assert.Equal(HttpStatusCode.Unauthorized, (await SubmitAsync(bot.PublicKey, Lead(), key: null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await SubmitAsync(bot.PublicKey, Lead(), key: "guess")).StatusCode);
    }

    [Fact]
    public async Task Lead_is_saved_and_listed_for_the_owner()
    {
        var (owner, bot) = await BotWithLeadCapture();
        var res = await SubmitAsync(bot.PublicKey, Lead(phone: "+91 98200 11111"));
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);

        var leads = (await owner.GetFromJsonAsync<List<LeadDto>>($"/bots/{bot.Id}/leads"))!;
        var lead = Assert.Single(leads);
        Assert.Equal("Asha", lead.Name);
        Assert.Equal("+919820011111", lead.Phone);
        Assert.Equal("JEE", lead.Course);
        Assert.Equal("https://inst.example/fees", lead.PageUrl);
        Assert.Equal("New", lead.Status);
        Assert.Contains("What are the fees?", lead.Transcript);
    }

    [Fact]
    public async Task Same_phone_within_a_day_is_not_saved_twice()
    {
        var (owner, bot) = await BotWithLeadCapture();
        Assert.Equal(HttpStatusCode.Created, (await SubmitAsync(bot.PublicKey, Lead(phone: "9820022222"))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await SubmitAsync(bot.PublicKey, Lead(phone: "98200 22222"))).StatusCode);
        Assert.Single((await owner.GetFromJsonAsync<List<LeadDto>>($"/bots/{bot.Id}/leads"))!);
    }

    [Fact]
    public async Task Disabled_bot_and_unknown_bot_do_not_accept_leads()
    {
        var (_, off) = await BotWithLeadCapture(enabled: false);
        Assert.Equal(HttpStatusCode.Conflict, (await SubmitAsync(off.PublicKey, Lead())).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await SubmitAsync("bk_00000000000000000000000000000000", Lead())).StatusCode);
    }

    [Fact]
    public async Task Invalid_lead_is_a_400_with_a_readable_error()
    {
        var (_, bot) = await BotWithLeadCapture();
        var res = await SubmitAsync(bot.PublicKey, Lead(phone: "12"));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<Dictionary<string, string>>();
        Assert.Equal("Please enter a valid phone number.", body!["error"]);
    }

    [Fact]
    public async Task Other_tenants_cannot_see_or_change_leads()
    {
        var (owner, bot) = await BotWithLeadCapture();
        await SubmitAsync(bot.PublicKey, Lead(phone: "9820033333"));
        var lead = (await owner.GetFromJsonAsync<List<LeadDto>>($"/bots/{bot.Id}/leads"))![0];

        var other = factory.ClientFor(Guid.NewGuid());
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync($"/bots/{bot.Id}/leads")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync($"/bots/{bot.Id}/leads/export")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await other.PatchAsJsonAsync($"/bots/{bot.Id}/leads/{lead.Id}", new { status = "Junk" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.DeleteAsync($"/bots/{bot.Id}/leads/{lead.Id}")).StatusCode);
    }

    [Fact]
    public async Task Owner_can_update_status_export_and_delete()
    {
        var (owner, bot) = await BotWithLeadCapture();
        await SubmitAsync(bot.PublicKey, Lead(phone: "9820044444", name: "=HYPERLINK(\"x\")"));
        var lead = (await owner.GetFromJsonAsync<List<LeadDto>>($"/bots/{bot.Id}/leads"))![0];

        var bad = await owner.PatchAsJsonAsync($"/bots/{bot.Id}/leads/{lead.Id}", new { status = "Whatever" });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        var ok = await owner.PatchAsJsonAsync($"/bots/{bot.Id}/leads/{lead.Id}", new { status = "Contacted" });
        Assert.Equal("Contacted", (await ok.Content.ReadFromJsonAsync<LeadDto>())!.Status);

        var export = await owner.GetAsync($"/bots/{bot.Id}/leads/export");
        Assert.Equal(HttpStatusCode.OK, export.StatusCode);
        Assert.Equal("text/csv", export.Content.Headers.ContentType!.MediaType);
        var csv = await export.Content.ReadAsStringAsync();
        Assert.Contains("\"'=HYPERLINK(\"\"x\"\")\"", csv);   // formula neutralised
        Assert.Contains("\"Contacted\"", csv);

        Assert.Equal(HttpStatusCode.NoContent, (await owner.DeleteAsync($"/bots/{bot.Id}/leads/{lead.Id}")).StatusCode);
        Assert.Empty((await owner.GetFromJsonAsync<List<LeadDto>>($"/bots/{bot.Id}/leads"))!);
    }

    [Fact]
    public async Task Deleting_the_bot_deletes_its_leads()
    {
        var (owner, bot) = await BotWithLeadCapture();
        await SubmitAsync(bot.PublicKey, Lead(phone: "9820055555"));
        Assert.Equal(HttpStatusCode.NoContent, (await owner.DeleteAsync($"/bots/{bot.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.GetAsync($"/bots/{bot.Id}/leads")).StatusCode);
    }
}
