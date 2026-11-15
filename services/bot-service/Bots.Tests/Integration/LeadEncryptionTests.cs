using System.Net;
using System.Net.Http.Json;
using Bots.Api;
using Bots.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;

namespace Bots.Tests.Integration;

[Trait("Level", "Integration")]
[Collection(BotsApiCollection.Name)]
public class LeadEncryptionTests(BotsApiFactory factory)
{
    private async Task<(HttpClient Owner, BotDto Bot)> BotWithLeads()
    {
        var owner = factory.ClientFor(Guid.NewGuid());
        var bot = (await (await owner.PostAsJsonAsync("/bots", new { name = "Private Bot" })).Content.ReadFromJsonAsync<BotDto>())!;
        await owner.PutAsJsonAsync($"/bots/{bot.Id}", new { name = bot.Name, leadCaptureEnabled = true });
        return (owner, bot);
    }

    private async Task<HttpStatusCode> Submit(BotDto bot, string phone, string name = "Meena Iyer")
    {
        var msg = new HttpRequestMessage(HttpMethod.Post, $"/internal/bots/{bot.PublicKey}/leads")
        {
            Content = JsonContent.Create(new { name, phone, email = "meena@example.com", transcript = new[] { new { role = "user", text = "My number is " + phone } } })
        };
        msg.Headers.Add("X-Internal-Key", BotsApiFactory.InternalKey);
        return (await factory.CreateClient().SendAsync(msg)).StatusCode;
    }

    private async Task<(string Name, string Phone, string? Email, string Transcript, string? Hash)> Raw(Guid botId)
    {
        await using var conn = new NpgsqlConnection(factory.ConnectionString);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand("select name, phone, email, transcript, phone_hash from bots.leads where bot_id = @b", conn);
        cmd.Parameters.AddWithValue("b", botId);
        await using var r = await cmd.ExecuteReaderAsync();
        Assert.True(await r.ReadAsync());
        return (r.GetString(0), r.GetString(1), r.IsDBNull(2) ? null : r.GetString(2), r.GetString(3), r.IsDBNull(4) ? null : r.GetString(4));
    }

    [Fact]
    public async Task Personal_details_are_encrypted_in_the_database_but_readable_by_the_owner()
    {
        var (owner, bot) = await BotWithLeads();
        Assert.Equal(HttpStatusCode.Created, await Submit(bot, "9820055501"));

        var raw = await Raw(bot.Id);
        Assert.StartsWith("enc1:", raw.Name);
        Assert.StartsWith("enc1:", raw.Phone);
        Assert.StartsWith("enc1:", raw.Email);
        Assert.StartsWith("enc1:", raw.Transcript);
        Assert.DoesNotContain("9820055501", raw.Phone + raw.Transcript + raw.Hash);
        Assert.Matches("^[0-9a-f]{64}$", raw.Hash!);

        var lead = (await owner.GetFromJsonAsync<List<LeadDto>>($"/bots/{bot.Id}/leads"))!.Single();
        Assert.Equal(("Meena Iyer", "9820055501", "meena@example.com"), (lead.Name, lead.Phone, lead.Email));
        Assert.Contains("My number is 9820055501", lead.Transcript);
    }

    [Fact]
    public async Task Repeat_submissions_are_still_recognised()
    {
        var (owner, bot) = await BotWithLeads();
        Assert.Equal(HttpStatusCode.Created, await Submit(bot, "9820055502"));
        Assert.Equal(HttpStatusCode.OK, await Submit(bot, "98200 55502"));   // same number, other spacing
        Assert.Single((await owner.GetFromJsonAsync<List<LeadDto>>($"/bots/{bot.Id}/leads"))!);
    }

    [Fact]
    public async Task Older_plain_text_leads_are_encrypted_at_startup()
    {
        var (owner, bot) = await BotWithLeads();
        await using (var conn = new NpgsqlConnection(factory.ConnectionString))
        {
            await conn.OpenAsync();
            await using var cmd = new NpgsqlCommand("""
                insert into bots.leads (id, tenant_id, bot_id, name, phone, email, transcript, status, channel, consent_at, created_at)
                select gen_random_uuid(), tenant_id, id, 'Old Lead', '9820055503', null, '[]', 'New', 'web', now(), now() from bots.bots where id = @b
                """, conn);
            cmd.Parameters.AddWithValue("b", bot.Id);
            await cmd.ExecuteNonQueryAsync();
        }
        Assert.Equal("Old Lead", (await owner.GetFromJsonAsync<List<LeadDto>>($"/bots/{bot.Id}/leads"))!.Single().Name);   // readable before

        var backfill = new LeadEncryptionBackfill(factory.Services.GetRequiredService<IServiceScopeFactory>(), NullLogger<LeadEncryptionBackfill>.Instance);
        await backfill.StartAsync(CancellationToken.None);
        await (backfill.ExecuteTask ?? Task.CompletedTask);

        var raw = await Raw(bot.Id);
        Assert.StartsWith("enc1:", raw.Phone);
        Assert.Equal(Pii.Lookup("9820055503"), raw.Hash);
        Assert.Equal("Old Lead", (await owner.GetFromJsonAsync<List<LeadDto>>($"/bots/{bot.Id}/leads"))!.Single().Name);
    }
}
