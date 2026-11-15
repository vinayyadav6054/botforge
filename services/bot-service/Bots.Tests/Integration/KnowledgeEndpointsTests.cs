using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Bots.Api;
using Bots.Api.Data;
using Bots.Api.Messaging;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Bots.Tests.Integration;

[Trait("Level", "Integration")]
[Collection(BotsApiCollection.Name)]
public class KnowledgeEndpointsTests(BotsApiFactory factory)
{
    private async Task<(HttpClient Owner, BotDto Bot)> NewBot(string name = "Knowledge Bot")
    {
        var owner = factory.ClientFor(Guid.NewGuid());
        var res = await owner.PostAsJsonAsync("/bots", new { name });
        return (owner, (await res.Content.ReadFromJsonAsync<BotDto>())!);
    }

    private async Task<JsonElement> Lookup(string publicKey)
    {
        var msg = new HttpRequestMessage(HttpMethod.Get, $"/internal/bots/{publicKey}");
        msg.Headers.Add("X-Internal-Key", BotsApiFactory.InternalKey);
        return await (await factory.CreateClient().SendAsync(msg)).Content.ReadFromJsonAsync<JsonElement>();
    }

    private Task Record(string publicKey, Guid conversation, string question, bool answered)
    {
        var msg = new HttpRequestMessage(HttpMethod.Post, $"/internal/bots/{publicKey}/conversations")
        {
            Content = JsonContent.Create(new { conversationId = conversation, question, answer = "…", answered })
        };
        msg.Headers.Add("X-Internal-Key", BotsApiFactory.InternalKey);
        return factory.CreateClient().SendAsync(msg);
    }

    // ---------- settings ----------

    [Fact]
    public async Task New_bots_have_sensible_defaults()
    {
        var (_, bot) = await NewBot();
        Assert.Equal(("friendly", "medium", true, "right", "after", true, false),
            (bot.Tone, bot.AnswerLength, bot.ShowSources, bot.WidgetPosition, bot.LeadTiming, bot.LeadAskCourse, bot.LeadAskEmail));
        Assert.Equal([1, 2, 3, 4, 5, 6], bot.HoursDays);
        Assert.Equal("Asia/Kolkata", bot.TimeZone);
    }

    [Fact]
    public async Task Personality_lead_form_and_look_are_saved_and_reach_the_chat_service()
    {
        var (owner, bot) = await NewBot();
        const string avatar = "data:image/png;base64,iVBORw0KGgo=";
        var res = await owner.PutAsJsonAsync($"/bots/{bot.Id}", new
        {
            name = bot.Name, tone = "professional", answerLength = "short", topicsToAvoid = "politics",
            customInstructions = "Mention the free demo class.", showSources = false,
            leadTiming = "start", leadAskEmail = true, leadCourseLabel = "Property type",
            widgetColor = "#1D4ED8", widgetPosition = "left", avatarDataUrl = avatar,
            hoursEnabled = true, hoursStart = "10:00", hoursEnd = "19:30", hoursDays = new[] { 6, 1, 1, 2 },
            timeZone = "Asia/Dubai", offlineMessage = "Closed now."
        });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var saved = (await res.Content.ReadFromJsonAsync<BotDto>())!;
        Assert.Equal("#1d4ed8", saved.WidgetColor);
        Assert.Equal([1, 2, 6], saved.HoursDays);

        var lookup = await Lookup(bot.PublicKey);
        Assert.Equal("professional", lookup.GetProperty("style").GetProperty("tone").GetString());
        Assert.Equal("Mention the free demo class.", lookup.GetProperty("style").GetProperty("customInstructions").GetString());
        Assert.False(lookup.GetProperty("showSources").GetBoolean());
        Assert.Equal("left", lookup.GetProperty("appearance").GetProperty("position").GetString());
        Assert.Equal(avatar, lookup.GetProperty("appearance").GetProperty("avatar").GetString());
        Assert.Equal("start", lookup.GetProperty("leadCapture").GetProperty("timing").GetString());
        Assert.Equal("Property type", lookup.GetProperty("leadCapture").GetProperty("courseLabel").GetString());
        Assert.Equal("Asia/Dubai", lookup.GetProperty("hours").GetProperty("timeZone").GetString());

        // empty strings clear the colour and logo; leaving fields out changes nothing
        var cleared = (await (await owner.PutAsJsonAsync($"/bots/{bot.Id}", new { name = bot.Name, widgetColor = "", avatarDataUrl = "" }))
            .Content.ReadFromJsonAsync<BotDto>())!;
        Assert.Null(cleared.WidgetColor);
        Assert.Null(cleared.AvatarDataUrl);
        Assert.Equal("professional", cleared.Tone);
    }

    [Theory]
    [InlineData("tone", "rude")]
    [InlineData("answerLength", "endless")]
    [InlineData("leadTiming", "never")]
    [InlineData("widgetColor", "red")]
    [InlineData("widgetPosition", "top")]
    [InlineData("avatarDataUrl", "javascript:alert(1)")]
    [InlineData("avatarDataUrl", "data:image/svg+xml;base64,PHN2Zz4=")]
    [InlineData("hoursStart", "25:00")]
    [InlineData("timeZone", "Asia/Kolkata; DROP")]
    public async Task Invalid_settings_are_rejected(string field, string value)
    {
        var (owner, bot) = await NewBot();
        var body = new Dictionary<string, object> { ["name"] = bot.Name, [field] = value };
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PutAsJsonAsync($"/bots/{bot.Id}", body)).StatusCode);
    }

    [Fact]
    public async Task Long_instructions_and_bad_days_are_rejected()
    {
        var (owner, bot) = await NewBot();
        Assert.Equal(HttpStatusCode.BadRequest,
            (await owner.PutAsJsonAsync($"/bots/{bot.Id}", new { name = bot.Name, customInstructions = new string('x', 1001) })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await owner.PutAsJsonAsync($"/bots/{bot.Id}", new { name = bot.Name, hoursDays = new[] { 0, 8 } })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await owner.PutAsJsonAsync($"/bots/{bot.Id}", new { name = bot.Name, avatarDataUrl = "data:image/png;base64," + new string('A', 80_000) })).StatusCode);
    }

    // ---------- Q&A ----------

    [Fact]
    public async Task Owner_answers_are_stored_and_sent_to_ingestion()
    {
        var (owner, bot) = await NewBot();
        var created = await owner.PostAsJsonAsync($"/bots/{bot.Id}/qa", new { question = " Is parking free? ", answer = "Yes, after 7 PM." });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var qa = (await created.Content.ReadFromJsonAsync<QaDto>())!;
        Assert.Equal("Is parking free?", qa.Question);
        Assert.Contains(factory.Publisher.Of<QaUpserted>("qa.upserted"), e => e.QaId == qa.Id && e.Answer == "Yes, after 7 PM.");

        var updated = await owner.PutAsJsonAsync($"/bots/{bot.Id}/qa/{qa.Id}", new { question = "Is parking free?", answer = "Yes, all day." });
        Assert.Equal(HttpStatusCode.OK, updated.StatusCode);
        Assert.Contains(factory.Publisher.Of<QaUpserted>("qa.upserted"), e => e.QaId == qa.Id && e.Answer == "Yes, all day.");
        Assert.Single((await owner.GetFromJsonAsync<List<QaDto>>($"/bots/{bot.Id}/qa"))!);

        Assert.Equal(HttpStatusCode.NoContent, (await owner.DeleteAsync($"/bots/{bot.Id}/qa/{qa.Id}")).StatusCode);
        Assert.Contains(factory.Publisher.Of<QaDeleted>("qa.deleted"), e => e.QaId == qa.Id);
    }

    [Fact]
    public async Task Q_and_a_is_validated_and_private()
    {
        var (owner, bot) = await NewBot();
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync($"/bots/{bot.Id}/qa", new { question = "", answer = "x" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync($"/bots/{bot.Id}/qa", new { question = "q", answer = new string('a', 2001) })).StatusCode);
        var stranger = factory.ClientFor(Guid.NewGuid());
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/bots/{bot.Id}/qa")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.PostAsJsonAsync($"/bots/{bot.Id}/qa", new { question = "q", answer = "a" })).StatusCode);
    }

    // ---------- unanswered questions ----------

    [Fact]
    public async Task Unanswered_questions_are_grouped_and_leave_the_list_once_answered()
    {
        var (owner, bot) = await NewBot();
        await Record(bot.PublicKey, Guid.NewGuid(), "Do you have a hostel?", answered: false);
        await Record(bot.PublicKey, Guid.NewGuid(), "do you have a  HOSTEL?", answered: false);
        await Record(bot.PublicKey, Guid.NewGuid(), "Is there parking?", answered: false);
        await Record(bot.PublicKey, Guid.NewGuid(), "What are the fees?", answered: true);

        var list = (await owner.GetFromJsonAsync<List<UnansweredDto>>($"/bots/{bot.Id}/unanswered"))!;
        Assert.Equal(2, list.Count);
        Assert.Equal(2, list[0].Count);
        Assert.Equal("do you have a hostel?", SourceRules.Key(list[0].Question));

        // answering it with a Q&A entry takes it off the list
        await owner.PostAsJsonAsync($"/bots/{bot.Id}/qa", new { question = "Hostel?", answer = "Yes, ₹9,000 a month.", fromQuestion = list[0].Question });
        list = (await owner.GetFromJsonAsync<List<UnansweredDto>>($"/bots/{bot.Id}/unanswered"))!;
        Assert.Equal(["Is there parking?"], list.Select(u => u.Question));

        await owner.PostAsJsonAsync($"/bots/{bot.Id}/unanswered/dismiss", new { question = "is there parking?" });
        Assert.Empty((await owner.GetFromJsonAsync<List<UnansweredDto>>($"/bots/{bot.Id}/unanswered"))!);
    }

    // ---------- online sources ----------

    [Theory]
    [InlineData("website", "https://sunrise.example/")]
    [InlineData("google", "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit")]
    [InlineData("google", "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit#gid=0")]
    [InlineData("youtube", "https://www.youtube.com/watch?v=dQw4w9WgXcQ")]
    [InlineData("youtube", "https://youtu.be/dQw4w9WgXcQ")]
    public async Task Online_sources_are_queued_for_ingestion(string kind, string url)
    {
        var (owner, bot) = await NewBot();
        var res = await owner.PostAsJsonAsync($"/bots/{bot.Id}/sources", new { kind, url });
        Assert.Equal(HttpStatusCode.Accepted, res.StatusCode);
        var doc = (await res.Content.ReadFromJsonAsync<DocumentDto>())!;
        Assert.Equal(kind, doc.Kind);
        Assert.Equal(url, doc.SourceUrl);
        var msg = factory.Publisher.Of<DocumentUploaded>("document.uploaded").Last(m => m.DocumentId == doc.Id);
        Assert.Equal(kind, msg.Kind);
        Assert.Equal(kind == "website" ? 30 : 0, msg.MaxPages);   // trial plan: 30 pages
    }

    [Theory]
    [InlineData("website", "ftp://x.example")]
    [InlineData("website", "not a url")]
    [InlineData("google", "https://evil.example/document/d/123")]
    [InlineData("youtube", "https://vimeo.com/123")]
    [InlineData("notion", "https://www.notion.so/page-123")]   // no token
    [InlineData("dropbox", "https://dropbox.com/x")]
    public async Task Invalid_sources_are_rejected(string kind, string url)
    {
        var (owner, bot) = await NewBot();
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync($"/bots/{bot.Id}/sources", new { kind, url })).StatusCode);
    }

    [Fact]
    public async Task Notion_secrets_are_sent_to_ingestion_but_never_returned()
    {
        var (owner, bot) = await NewBot();
        var res = await owner.PostAsJsonAsync($"/bots/{bot.Id}/sources",
            new { kind = "notion", url = "https://www.notion.so/Fees-0123456789abcdef0123456789abcdef", token = "ntn_secret123" });
        Assert.Equal(HttpStatusCode.Accepted, res.StatusCode);
        Assert.DoesNotContain("ntn_secret123", await res.Content.ReadAsStringAsync());
        Assert.DoesNotContain("ntn_secret123", await owner.GetStringAsync($"/bots/{bot.Id}/documents"));
        Assert.DoesNotContain("ntn_secret123", await owner.GetStringAsync("/account/export"));
        Assert.Contains(factory.Publisher.Of<DocumentUploaded>("document.uploaded"), m => m.SourceSecret == "ntn_secret123");
    }

    [Fact]
    public async Task Sources_are_synced_again_when_their_interval_has_passed()
    {
        var (owner, bot) = await NewBot();
        var doc = (await (await owner.PostAsJsonAsync($"/bots/{bot.Id}/sources", new { kind = "website", url = "https://sync.example/", syncIntervalDays = 7 }))
            .Content.ReadFromJsonAsync<DocumentDto>())!;
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Documents.IgnoreQueryFilters().Where(d => d.Id == doc.Id)
            .ExecuteUpdateAsync(s => s.SetProperty(d => d.Status, "Ready").SetProperty(d => d.LastSyncedAt, DateTime.UtcNow.AddDays(-1)));

        var before = factory.Publisher.Of<DocumentUploaded>("document.uploaded").Count(m => m.DocumentId == doc.Id);
        await SourceSync.RunOnceAsync(scope.ServiceProvider, DateTime.UtcNow);
        Assert.Equal(before, factory.Publisher.Of<DocumentUploaded>("document.uploaded").Count(m => m.DocumentId == doc.Id));   // not due yet

        await SourceSync.RunOnceAsync(scope.ServiceProvider, DateTime.UtcNow.AddDays(7));
        Assert.Equal(before + 1, factory.Publisher.Of<DocumentUploaded>("document.uploaded").Count(m => m.DocumentId == doc.Id));

        // the owner can change or switch off the interval
        var patched = await owner.PatchAsJsonAsync($"/bots/{bot.Id}/sources/{doc.Id}", new { syncIntervalDays = 0 });
        Assert.Equal(0, (await patched.Content.ReadFromJsonAsync<DocumentDto>())!.SyncIntervalDays);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PatchAsJsonAsync($"/bots/{bot.Id}/sources/{doc.Id}", new { syncIntervalDays = 3 })).StatusCode);
    }

    [Fact]
    public async Task Spreadsheets_can_be_uploaded()
    {
        var (owner, bot) = await NewBot();
        var zip = new byte[] { 0x50, 0x4B, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00 };   // an .xlsx is a ZIP file
        foreach (var (name, bytes) in new[] { ("prices.xlsx", zip), ("menu.csv", "a,b\n1,2"u8.ToArray()) })
        {
            using var form = new MultipartFormDataContent { { new ByteArrayContent(bytes), "file", name } };
            Assert.Equal(HttpStatusCode.Accepted, (await owner.PostAsync($"/bots/{bot.Id}/documents", form)).StatusCode);
        }
    }

    [Theory]
    [InlineData("fees.pdf", "not really a pdf")]
    [InlineData("menu.xlsx", "a,b\n1,2")]
    [InlineData("notes.txt", "MZ\u0090 program")]
    [InlineData("notes.md", "binary\u0000data")]
    public async Task Files_whose_content_does_not_match_their_name_are_refused(string name, string content)
    {
        var (owner, bot) = await NewBot();
        using var form = new MultipartFormDataContent { { new ByteArrayContent(System.Text.Encoding.Latin1.GetBytes(content)), "file", name } };
        var res = await owner.PostAsync($"/bots/{bot.Id}/documents", form);
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains("does not look like a real", await res.Content.ReadAsStringAsync());
    }
}
