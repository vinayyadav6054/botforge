using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using Bots.Api;
using Bots.Api.Messaging;

namespace Bots.Tests.Integration;

[Trait("Level", "Integration")]
[Collection(BotsApiCollection.Name)]
public class BotsEndpointsTests(BotsApiFactory factory)
{
    private static async Task<BotDto> CreateBot(HttpClient client, string name = "Support Bot", string? welcome = null)
    {
        var res = await client.PostAsJsonAsync("/bots", new { name, welcomeMessage = welcome });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        return (await res.Content.ReadFromJsonAsync<BotDto>())!;
    }

    private static MultipartFormDataContent File(string name, string content, string contentType = "text/plain")
    {
        var file = new ByteArrayContent(Encoding.UTF8.GetBytes(content));
        file.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        return new MultipartFormDataContent { { file, "file", name } };
    }

    [Fact]
    public async Task Requires_a_valid_token()
    {
        var anon = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.GetAsync("/bots")).StatusCode);

        var wrongKey = factory.ClientWithToken(BotsApiFactory.Token(Guid.NewGuid(), key: "another-signing-key-that-is-long-enough-123"));
        Assert.Equal(HttpStatusCode.Unauthorized, (await wrongKey.GetAsync("/bots")).StatusCode);

        var expired = factory.ClientWithToken(BotsApiFactory.Token(Guid.NewGuid(), expires: DateTime.UtcNow.AddMinutes(-5)));
        Assert.Equal(HttpStatusCode.Unauthorized, (await expired.GetAsync("/bots")).StatusCode);
    }

    [Fact]
    public async Task Token_without_tenant_is_forbidden()
    {
        var client = factory.ClientWithToken(BotsApiFactory.Token(tenantId: null));
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/bots")).StatusCode);
    }

    [Fact]
    public async Task Create_list_get_update_bot()
    {
        var client = factory.ClientFor(Guid.NewGuid());
        var bot = await CreateBot(client, "  Bakery Bot ");
        Assert.Equal("Bakery Bot", bot.Name);
        Assert.Matches("^bk_[0-9a-f]{32}$", bot.PublicKey);
        Assert.Equal("Hi! How can I help you today?", bot.WelcomeMessage);

        var list = await client.GetFromJsonAsync<List<BotDto>>("/bots");
        Assert.Equal(bot.Id, Assert.Single(list!).Id);

        var got = await client.GetFromJsonAsync<BotDto>($"/bots/{bot.Id}");
        Assert.Equal(bot.PublicKey, got!.PublicKey);

        var put = await client.PutAsJsonAsync($"/bots/{bot.Id}", new { name = "Renamed", welcomeMessage = "Welcome!" });
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        var updated = await put.Content.ReadFromJsonAsync<BotDto>();
        Assert.Equal("Renamed", updated!.Name);
        Assert.Equal("Welcome!", updated.WelcomeMessage);
        Assert.Equal(bot.PublicKey, updated.PublicKey);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Create_requires_a_name(string name)
    {
        var res = await factory.ClientFor(Guid.NewGuid()).PostAsJsonAsync("/bots", new { name });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Overlong_values_are_400_not_500()
    {
        var client = factory.ClientFor(Guid.NewGuid());
        Assert.Equal(HttpStatusCode.BadRequest,
            (await client.PostAsJsonAsync("/bots", new { name = new string('x', 201) })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await client.PostAsJsonAsync("/bots", new { name = "ok", welcomeMessage = new string('x', 501) })).StatusCode);
    }

    [Fact]
    public async Task Tenants_cannot_see_or_change_each_others_bots()
    {
        var alice = factory.ClientFor(Guid.NewGuid());
        var bob = factory.ClientFor(Guid.NewGuid());
        var aliceBot = await CreateBot(alice, "Alice Bot");
        var upload = await alice.PostAsync($"/bots/{aliceBot.Id}/documents", File("a.txt", "alice secret"));
        var aliceDoc = (await upload.Content.ReadFromJsonAsync<DocumentDto>())!;

        Assert.Empty((await bob.GetFromJsonAsync<List<BotDto>>("/bots"))!);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.GetAsync($"/bots/{aliceBot.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.GetAsync($"/bots/{aliceBot.Id}/documents")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.GetAsync($"/bots/{aliceBot.Id}/documents/{aliceDoc.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await bob.PutAsJsonAsync($"/bots/{aliceBot.Id}", new { name = "hijacked" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await bob.PostAsync($"/bots/{aliceBot.Id}/documents", File("b.txt", "bob"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await bob.PostAsync($"/bots/{aliceBot.Id}/documents/{aliceDoc.Id}/reprocess", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.DeleteAsync($"/bots/{aliceBot.Id}/documents/{aliceDoc.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.DeleteAsync($"/bots/{aliceBot.Id}")).StatusCode);

        // still intact for the owner
        var stillThere = await alice.GetFromJsonAsync<BotDto>($"/bots/{aliceBot.Id}");
        Assert.Equal("Alice Bot", stillThere!.Name);
        Assert.Single((await alice.GetFromJsonAsync<List<DocumentDto>>($"/bots/{aliceBot.Id}/documents"))!);
    }

    [Fact]
    public async Task Upload_stores_file_and_publishes_event()
    {
        var tenant = Guid.NewGuid();
        var client = factory.ClientFor(tenant);
        var bot = await CreateBot(client);

        var res = await client.PostAsync($"/bots/{bot.Id}/documents", File(@"C:\fakepath\FAQ.TXT", "We open at 9."));
        Assert.Equal(HttpStatusCode.Accepted, res.StatusCode);
        var doc = (await res.Content.ReadFromJsonAsync<DocumentDto>())!;
        Assert.Equal("FAQ.TXT", doc.FileName);
        Assert.Equal("Uploaded", doc.Status);
        Assert.Equal(13, doc.SizeBytes);

        var evt = Assert.Single(factory.Publisher.Of<DocumentUploaded>("document.uploaded"), e => e.DocumentId == doc.Id);
        Assert.Equal(tenant, evt.TenantId);
        Assert.Equal(bot.Id, evt.BotId);
        Assert.Equal($"{tenant}/{bot.Id}/{doc.Id}.txt", evt.StorageKey);
        Assert.Equal("We open at 9.", await System.IO.File.ReadAllTextAsync(Path.Combine(factory.StorageRoot, evt.StorageKey)));
    }

    [Theory]
    [InlineData("virus.exe", "MZ")]
    [InlineData("page.html", "<script>")]
    [InlineData("empty.txt", "")]
    public async Task Upload_rejects_bad_files(string name, string content)
    {
        var client = factory.ClientFor(Guid.NewGuid());
        var bot = await CreateBot(client);
        var res = await client.PostAsync($"/bots/{bot.Id}/documents", File(name, content));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Upload_rejects_files_over_10_mb()
    {
        var client = factory.ClientFor(Guid.NewGuid());
        var bot = await CreateBot(client);
        var big = new ByteArrayContent(new byte[DocumentRules.MaxFileBytes + 1]);
        var res = await client.PostAsync($"/bots/{bot.Id}/documents", new MultipartFormDataContent { { big, "file", "big.txt" } });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Upload_without_file_is_400()
    {
        var client = factory.ClientFor(Guid.NewGuid());
        var bot = await CreateBot(client);
        var res = await client.PostAsync($"/bots/{bot.Id}/documents",
            new MultipartFormDataContent { { new StringContent("x"), "notfile" } });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Broker_outage_marks_document_unqueued_and_reprocess_requeues_it()
    {
        var client = factory.ClientFor(Guid.NewGuid());
        var bot = await CreateBot(client);

        DocumentDto doc;
        factory.Publisher.Fail = true;
        try
        {
            var res = await client.PostAsync($"/bots/{bot.Id}/documents", File("a.md", "# Hours"));
            doc = (await res.Content.ReadFromJsonAsync<DocumentDto>())!;
            Assert.Equal("UploadedUnqueued", doc.Status);
        }
        finally
        {
            factory.Publisher.Fail = false;
        }

        var retry = await client.PostAsync($"/bots/{bot.Id}/documents/{doc.Id}/reprocess", null);
        Assert.Equal(HttpStatusCode.Accepted, retry.StatusCode);
        Assert.Equal("Uploaded", (await retry.Content.ReadFromJsonAsync<DocumentDto>())!.Status);
        Assert.Single(factory.Publisher.Of<DocumentUploaded>("document.uploaded"), e => e.DocumentId == doc.Id);
    }

    [Fact]
    public async Task Delete_document_removes_file_and_publishes_event()
    {
        var client = factory.ClientFor(Guid.NewGuid());
        var bot = await CreateBot(client);
        var doc = (await (await client.PostAsync($"/bots/{bot.Id}/documents", File("a.txt", "x"))).Content
            .ReadFromJsonAsync<DocumentDto>())!;
        var key = factory.Publisher.Of<DocumentUploaded>("document.uploaded").Single(e => e.DocumentId == doc.Id).StorageKey;

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/bots/{bot.Id}/documents/{doc.Id}")).StatusCode);
        Assert.False(System.IO.File.Exists(Path.Combine(factory.StorageRoot, key)));
        Assert.Empty((await client.GetFromJsonAsync<List<DocumentDto>>($"/bots/{bot.Id}/documents"))!);
        Assert.Single(factory.Publisher.Of<DocumentDeleted>("document.deleted"), e => e.DocumentId == doc.Id);
        Assert.Equal(HttpStatusCode.NotFound, (await client.DeleteAsync($"/bots/{bot.Id}/documents/{doc.Id}")).StatusCode);
    }

    [Fact]
    public async Task Delete_bot_removes_documents_and_publishes_event()
    {
        var client = factory.ClientFor(Guid.NewGuid());
        var bot = await CreateBot(client);
        await client.PostAsync($"/bots/{bot.Id}/documents", File("a.txt", "x"));
        await client.PostAsync($"/bots/{bot.Id}/documents", File("b.txt", "y"));

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/bots/{bot.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/bots/{bot.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/bots/{bot.Id}/documents")).StatusCode);
        Assert.Single(factory.Publisher.Of<BotDeleted>("bot.deleted"), e => e.BotId == bot.Id);
        Assert.False(Directory.Exists(Path.Combine(factory.StorageRoot, bot.Id.ToString()))
                     && Directory.EnumerateFiles(Path.Combine(factory.StorageRoot, bot.Id.ToString())).Any());
    }

    [Fact]
    public async Task Internal_lookup_requires_the_shared_key()
    {
        var tenant = Guid.NewGuid();
        var bot = await CreateBot(factory.ClientFor(tenant), "Lookup Bot", "Hello visitor");
        var anon = factory.CreateClient();

        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.GetAsync($"/internal/bots/{bot.PublicKey}")).StatusCode);

        var wrong = new HttpRequestMessage(HttpMethod.Get, $"/internal/bots/{bot.PublicKey}");
        wrong.Headers.Add("X-Internal-Key", "guess");
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.SendAsync(wrong)).StatusCode);

        var ok = new HttpRequestMessage(HttpMethod.Get, $"/internal/bots/{bot.PublicKey}");
        ok.Headers.Add("X-Internal-Key", BotsApiFactory.InternalKey);
        var res = await anon.SendAsync(ok);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<Dictionary<string, object>>();
        Assert.Equal(bot.Id.ToString(), body!["botId"].ToString());
        Assert.Equal(tenant.ToString(), body["tenantId"].ToString());
        Assert.Equal("Hello visitor", body["welcomeMessage"].ToString());

        var missing = new HttpRequestMessage(HttpMethod.Get, "/internal/bots/bk_00000000000000000000000000000000");
        missing.Headers.Add("X-Internal-Key", BotsApiFactory.InternalKey);
        Assert.Equal(HttpStatusCode.NotFound, (await anon.SendAsync(missing)).StatusCode);
    }
}
