using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Bots.Api;
using Bots.Api.Messaging;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using RabbitMQ.Client;

namespace Bots.Tests.Integration;

[Trait("Level", "Integration")]
[Collection(BotsApiCollection.Name)]
public class DocumentStatusTests(BotsApiFactory factory)
{
    private async Task<(HttpClient Client, Guid Tenant, BotDto Bot, DocumentDto Doc)> UploadedDocument()
    {
        var tenant = Guid.NewGuid();
        var client = factory.ClientFor(tenant);
        var bot = (await (await client.PostAsJsonAsync("/bots", new { name = "Status Bot" })).Content.ReadFromJsonAsync<BotDto>())!;
        var file = new ByteArrayContent(Encoding.UTF8.GetBytes("hello"));
        var doc = (await (await client.PostAsync($"/bots/{bot.Id}/documents",
            new MultipartFormDataContent { { file, "file", "a.txt" } })).Content.ReadFromJsonAsync<DocumentDto>())!;
        return (client, tenant, bot, doc);
    }

    private DocumentStatusConsumer Consumer() => new(
        factory.Services.GetRequiredService<IServiceScopeFactory>(),
        factory.Services.GetRequiredService<IOptions<RabbitMqOptions>>(),
        NullLogger<DocumentStatusConsumer>.Instance);

    private static byte[] Json(object o) => JsonSerializer.SerializeToUtf8Bytes(o, JsonSerializerOptions.Web);

    private static async Task<DocumentDto> Get(HttpClient c, BotDto bot, DocumentDto doc) =>
        (await c.GetFromJsonAsync<DocumentDto>($"/bots/{bot.Id}/documents/{doc.Id}"))!;

    [Fact]
    public async Task Processed_event_marks_document_ready()
    {
        var (client, tenant, bot, doc) = await UploadedDocument();
        await Consumer().HandleAsync("document.processed",
            Json(new { documentId = doc.Id, tenantId = tenant, botId = bot.Id, chunkCount = 7 }), default);

        var updated = await Get(client, bot, doc);
        Assert.Equal("Ready", updated.Status);
        Assert.Equal(7, updated.ChunkCount);
        Assert.Null(updated.Error);
    }

    [Fact]
    public async Task Failed_event_marks_document_failed_with_reason()
    {
        var (client, tenant, bot, doc) = await UploadedDocument();
        await Consumer().HandleAsync("document.failed",
            Json(new { documentId = doc.Id, tenantId = tenant, botId = bot.Id, error = "No text could be extracted" }), default);

        var updated = await Get(client, bot, doc);
        Assert.Equal("Failed", updated.Status);
        Assert.Equal("No text could be extracted", updated.Error);
    }

    /// <summary>Regression: reprocess used to publish first and save "Uploaded" afterwards, so an instant
    /// "failed" answer from the worker was overwritten and the document stayed "Uploaded" forever.</summary>
    [Fact]
    public async Task Reprocess_does_not_overwrite_an_instant_worker_answer()
    {
        var (client, tenant, bot, doc) = await UploadedDocument();
        // first attempt failed, the owner clicks "Retry"
        await Consumer().HandleAsync("document.failed",
            Json(new { documentId = doc.Id, tenantId = tenant, botId = bot.Id, error = "first failure" }), default);

        factory.Publisher.OnPublish = (key, msg) => key == "document.uploaded" && msg is DocumentUploaded u && u.DocumentId == doc.Id
            ? Consumer().HandleAsync("document.failed",
                Json(new { documentId = doc.Id, tenantId = tenant, botId = bot.Id, error = "No text again" }), default)
            : Task.CompletedTask;
        try
        {
            var res = await client.PostAsync($"/bots/{bot.Id}/documents/{doc.Id}/reprocess", null);
            Assert.Equal(System.Net.HttpStatusCode.Accepted, res.StatusCode);
        }
        finally
        {
            factory.Publisher.OnPublish = null;
        }

        var current = await Get(client, bot, doc);
        Assert.Equal("Failed", current.Status);
        Assert.Equal("No text again", current.Error);
    }

    [Fact]
    public async Task Event_with_wrong_tenant_is_ignored()
    {
        var (client, _, bot, doc) = await UploadedDocument();
        await Consumer().HandleAsync("document.processed",
            Json(new { documentId = doc.Id, tenantId = Guid.NewGuid(), botId = bot.Id, chunkCount = 1 }), default);

        Assert.Equal("Uploaded", (await Get(client, bot, doc)).Status);
    }

    [Fact]
    public async Task Malformed_events_do_not_throw()
    {
        await Consumer().HandleAsync("document.processed", Json(new { documentId = Guid.Empty }), default);
        await Consumer().HandleAsync("document.processed",
            Json(new { documentId = Guid.NewGuid(), tenantId = Guid.NewGuid() }), default);
    }

    /// <summary>Full round trip through the real RabbitMQ broker, on a private exchange and queue.</summary>
    [Fact]
    public async Task Status_event_published_to_RabbitMQ_updates_the_document()
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var exchange = $"botforge.test.{suffix}";
        var queue = $"bots.test-status.{suffix}";

        await using var app = factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("RabbitMq:ConsumeStatusEvents", "true");
            b.UseSetting("RabbitMq:Exchange", exchange);
            b.UseSetting("RabbitMq:StatusQueue", queue);
        });
        var tenant = Guid.NewGuid();
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new("Bearer", BotsApiFactory.Token(tenant));
        var bot = (await (await client.PostAsJsonAsync("/bots", new { name = "Rabbit Bot" })).Content.ReadFromJsonAsync<BotDto>())!;
        var doc = (await (await client.PostAsync($"/bots/{bot.Id}/documents", new MultipartFormDataContent
            { { new ByteArrayContent("hi"u8.ToArray()), "file", "a.txt" } })).Content.ReadFromJsonAsync<DocumentDto>())!;

        var o = app.Services.GetRequiredService<IOptions<RabbitMqOptions>>().Value;
        var connFactory = new ConnectionFactory { HostName = o.Host, Port = o.Port, UserName = o.User, Password = o.Password };
        await using var conn = await connFactory.CreateConnectionAsync();
        await using var channel = await conn.CreateChannelAsync();
        try
        {
            await channel.ExchangeDeclareAsync(exchange, ExchangeType.Topic, durable: true);

            // the hosted consumer declares its queue asynchronously after start-up
            var deadline = DateTime.UtcNow.AddSeconds(20);
            DocumentDto current = doc;
            var published = false;
            while (DateTime.UtcNow < deadline)
            {
                if (!published)
                {
                    try
                    {
                        await using var probe = await conn.CreateChannelAsync();
                        await probe.QueueDeclarePassiveAsync(queue);
                        await channel.BasicPublishAsync(exchange, "document.processed",
                            Json(new { documentId = doc.Id, tenantId = tenant, botId = bot.Id, chunkCount = 3 }));
                        published = true;
                    }
                    catch (RabbitMQ.Client.Exceptions.OperationInterruptedException) { /* queue not there yet */ }
                }
                current = (await client.GetFromJsonAsync<DocumentDto>($"/bots/{bot.Id}/documents/{doc.Id}"))!;
                if (current.Status == "Ready") break;
                await Task.Delay(300);
            }

            Assert.True(published, "status queue was never declared by the consumer");
            Assert.Equal("Ready", current.Status);
            Assert.Equal(3, current.ChunkCount);
        }
        finally
        {
            await channel.QueueDeleteAsync(queue);
            await channel.ExchangeDeleteAsync(exchange);
        }
    }

    /// <summary>The real publisher really reaches the broker with the expected JSON contract.</summary>
    [Fact]
    public async Task RabbitMqPublisher_sends_camelCase_json_to_the_exchange()
    {
        var options = factory.Services.GetRequiredService<IOptions<RabbitMqOptions>>().Value;
        var exchange = $"botforge.test.{Guid.NewGuid():N}";
        var testOptions = new RabbitMqOptions
        {
            Host = options.Host, Port = options.Port, User = options.User, Password = options.Password, Exchange = exchange
        };
        await using var publisher = new RabbitMqPublisher(Options.Create(testOptions));

        var connFactory = new ConnectionFactory { HostName = options.Host, Port = options.Port, UserName = options.User, Password = options.Password };
        await using var conn = await connFactory.CreateConnectionAsync();
        await using var channel = await conn.CreateChannelAsync();
        await channel.ExchangeDeclareAsync(exchange, ExchangeType.Topic, durable: true);
        var q = (await channel.QueueDeclareAsync(exclusive: true, autoDelete: true)).QueueName;
        await channel.QueueBindAsync(q, exchange, "document.uploaded");
        try
        {
            var id = Guid.NewGuid();
            await publisher.PublishAsync("document.uploaded",
                new DocumentUploaded(id, Guid.NewGuid(), Guid.NewGuid(), "t/b/d.txt", "d.txt", "text/plain", DateTime.UtcNow));

            BasicGetResult? msg = null;
            for (var i = 0; i < 30 && msg is null; i++)
            {
                msg = await channel.BasicGetAsync(q, autoAck: true);
                if (msg is null) await Task.Delay(100);
            }
            Assert.NotNull(msg);
            var json = JsonDocument.Parse(msg.Body.ToArray()).RootElement;
            Assert.Equal(id.ToString(), json.GetProperty("documentId").GetString());
            Assert.Equal("t/b/d.txt", json.GetProperty("storageKey").GetString());
            Assert.Equal(DeliveryModes.Persistent, msg.BasicProperties.DeliveryMode);
        }
        finally
        {
            await channel.ExchangeDeleteAsync(exchange);
        }
    }
}
