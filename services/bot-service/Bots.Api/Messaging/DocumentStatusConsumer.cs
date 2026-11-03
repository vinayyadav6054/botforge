using System.Text.Json;
using Bots.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using RabbitMQ.Client;
using RabbitMQ.Client.Events;

namespace Bots.Api.Messaging;

public record DocumentStatusEvent(Guid DocumentId, Guid TenantId, Guid BotId, int? ChunkCount, string? Error);

public class DocumentStatusConsumer(
    IServiceScopeFactory scopes,
    IOptions<RabbitMqOptions> options,
    ILogger<DocumentStatusConsumer> log) : BackgroundService
{
    private const string Queue = "bots.document-status";

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await RunAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                log.LogError(ex, "Status consumer stopped, retrying in 5 seconds");
                try { await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken); }
                catch (OperationCanceledException) { return; }
            }
        }
    }

    private async Task RunAsync(CancellationToken ct)
    {
        var o = options.Value;
        var factory = new ConnectionFactory
        {
            HostName = o.Host,
            Port = o.Port,
            UserName = o.User,
            Password = o.Password
        };

        await using var connection = await factory.CreateConnectionAsync(ct);
        await using var channel = await connection.CreateChannelAsync(cancellationToken: ct);

        var closed = new TaskCompletionSource();
        connection.ConnectionShutdownAsync += (_, _) =>
        {
            closed.TrySetResult();
            return Task.CompletedTask;
        };

        await channel.ExchangeDeclareAsync(o.Exchange, ExchangeType.Topic, durable: true, cancellationToken: ct);
        await channel.QueueDeclareAsync(Queue, durable: true, exclusive: false, autoDelete: false, cancellationToken: ct);
        await channel.QueueBindAsync(Queue, o.Exchange, "document.processed", cancellationToken: ct);
        await channel.QueueBindAsync(Queue, o.Exchange, "document.failed", cancellationToken: ct);
        await channel.BasicQosAsync(0, 10, false, ct);

        var consumer = new AsyncEventingBasicConsumer(channel);
        consumer.ReceivedAsync += async (_, ea) =>
        {
            try
            {
                await HandleAsync(ea.RoutingKey, ea.Body.ToArray(), ct);
                await channel.BasicAckAsync(ea.DeliveryTag, false, CancellationToken.None);
            }
            catch (Exception ex)
            {
                // retry once (e.g. the database was briefly unavailable), then drop it so the queue never blocks
                log.LogError(ex, "Could not handle {RoutingKey} (redelivered: {Redelivered})", ea.RoutingKey, ea.Redelivered);
                await channel.BasicNackAsync(ea.DeliveryTag, false, requeue: !ea.Redelivered, CancellationToken.None);
            }
        };

        await channel.BasicConsumeAsync(Queue, autoAck: false, consumer: consumer, cancellationToken: ct);
        log.LogInformation("Listening for document status events on {Queue}", Queue);

        await Task.WhenAny(closed.Task, Task.Delay(Timeout.Infinite, ct));
        ct.ThrowIfCancellationRequested();
        throw new InvalidOperationException("RabbitMQ connection was lost");
    }

    private async Task HandleAsync(string routingKey, byte[] body, CancellationToken ct)
    {
        var evt = JsonSerializer.Deserialize<DocumentStatusEvent>(body, JsonSerializerOptions.Web);
        if (evt is null || evt.DocumentId == Guid.Empty || evt.TenantId == Guid.Empty) return;

        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        // no HTTP request here, so no tenant in context: bypass the filter, match the tenant explicitly
        var doc = await db.Documents.IgnoreQueryFilters()
            .FirstOrDefaultAsync(d => d.Id == evt.DocumentId && d.TenantId == evt.TenantId, ct);
        if (doc is null)
        {
            log.LogWarning("Status event for unknown document {DocumentId}", evt.DocumentId);
            return;
        }

        if (routingKey == "document.processed")
        {
            doc.Status = "Ready";
            doc.ChunkCount = evt.ChunkCount;
            doc.Error = null;
        }
        else
        {
            doc.Status = "Failed";
            doc.Error = evt.Error;
        }

        await db.SaveChangesAsync(ct);
        log.LogInformation("Document {DocumentId} is now {Status}", doc.Id, doc.Status);
    }
}