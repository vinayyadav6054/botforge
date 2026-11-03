using System.Text.Json;
using RabbitMQ.Client;

namespace Bots.Api.Messaging;

public record DocumentUploaded(
    Guid DocumentId, Guid TenantId, Guid BotId,
    string StorageKey, string FileName, string ContentType, DateTime UploadedAt)
{
    public static DocumentUploaded From(Data.BotDocument d) =>
        new(d.Id, d.TenantId, d.BotId, d.StorageKey, d.FileName, d.ContentType, DateTime.UtcNow);
}

public record DocumentDeleted(Guid DocumentId, Guid TenantId, Guid BotId);

public record BotDeleted(Guid BotId, Guid TenantId);

public class RabbitMqOptions
{
    public string Host { get; set; } = "localhost";
    public int Port { get; set; } = 5672;
    public string User { get; set; } = "";
    public string Password { get; set; } = "";
    public string Exchange { get; set; } = "botforge.events";
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
            var factory = new ConnectionFactory
            {
                HostName = _o.Host,
                Port = _o.Port,
                UserName = _o.User,
                Password = _o.Password
            };
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