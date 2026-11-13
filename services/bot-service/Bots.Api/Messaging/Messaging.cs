using System.Text.Json;
using RabbitMQ.Client;

namespace Bots.Api.Messaging;

public record DocumentUploaded(
    Guid DocumentId, Guid TenantId, Guid BotId,
    string StorageKey, string FileName, string ContentType, DateTime UploadedAt,
    string Kind = "file", string? SourceUrl = null, string? SourceSecret = null, int MaxPages = 0)
{
    public static DocumentUploaded From(Data.BotDocument d) =>
        new(d.Id, d.TenantId, d.BotId, d.StorageKey, d.FileName, d.ContentType, DateTime.UtcNow,
            d.Kind, d.SourceUrl, d.SourceSecret, d.MaxPages);
}

public record QaUpserted(Guid QaId, Guid TenantId, Guid BotId, string Question, string Answer);
public record QaDeleted(Guid QaId, Guid TenantId, Guid BotId);

public record DocumentDeleted(Guid DocumentId, Guid TenantId, Guid BotId);

public record BotDeleted(Guid BotId, Guid TenantId);

public class RabbitMqOptions
{
    /// <summary>Full AMQP URL, e.g. amqps://user:pass@host/vhost (CloudAMQP). Overrides Host/Port/User/Password.</summary>
    public string? Url { get; set; }
    public string Host { get; set; } = "localhost";
    public int Port { get; set; } = 5672;
    public string User { get; set; } = "";
    public string Password { get; set; } = "";
    public string Exchange { get; set; } = "botforge.events";
    public string StatusQueue { get; set; } = "bots.document-status";

    public ConnectionFactory CreateFactory() =>
        string.IsNullOrWhiteSpace(Url)
            ? new ConnectionFactory { HostName = Host, Port = Port, UserName = User, Password = Password }
            : new ConnectionFactory { Uri = new Uri(Url) };   // amqps:// switches TLS on
}

public interface IEventPublisher
{
    Task PublishAsync<T>(string routingKey, T message, CancellationToken ct = default);
}

public sealed class RabbitMqPublisher(Microsoft.Extensions.Options.IOptions<RabbitMqOptions> options)
    : IEventPublisher, IAsyncDisposable
{
    private readonly RabbitMqOptions _o = options.Value;
    private readonly SemaphoreSlim _lock = new(1, 1);
    private IConnection? _connection;

    private async Task<IConnection> GetConnectionAsync(CancellationToken ct)
    {
        if (_connection is { IsOpen: true }) return _connection;
        await _lock.WaitAsync(ct);
        try
        {
            if (_connection is { IsOpen: true }) return _connection;
            var factory = _o.CreateFactory();
            _connection = await factory.CreateConnectionAsync(ct);
            return _connection;
        }
        finally { _lock.Release(); }
    }

    public async Task PublishAsync<T>(string routingKey, T message, CancellationToken ct = default)
    {
        var connection = await GetConnectionAsync(ct);
        await using var channel = await connection.CreateChannelAsync(cancellationToken: ct);
        await channel.ExchangeDeclareAsync(_o.Exchange, ExchangeType.Topic, durable: true, cancellationToken: ct);

        var body = JsonSerializer.SerializeToUtf8Bytes(message, JsonSerializerOptions.Web);
        var props = new BasicProperties
        {
            ContentType = "application/json",
            DeliveryMode = DeliveryModes.Persistent
        };

        await channel.BasicPublishAsync(_o.Exchange, routingKey, false, props, body, ct);
    }

    public async ValueTask DisposeAsync()
    {
        if (_connection is not null) await _connection.DisposeAsync();
    }
}