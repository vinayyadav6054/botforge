using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using Bots.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Bots.Api;

/// <summary>New leads waiting for their alerts. Saving a lead only enqueues; the visitor never waits for email or webhooks.</summary>
public class LeadAlertQueue
{
    private readonly Channel<Guid> _queue = System.Threading.Channels.Channel.CreateBounded<Guid>(new BoundedChannelOptions(1000) { FullMode = BoundedChannelFullMode.DropOldest });

    public void Enqueue(Guid leadId) => _queue.Writer.TryWrite(leadId);
    public IAsyncEnumerable<Guid> ReadAllAsync(CancellationToken ct) => _queue.Reader.ReadAllAsync(ct);
}

/// <summary>Sends the email alert (through the identity service, which knows the owner's address) and the webhook.</summary>
public class LeadAlertService(LeadAlertQueue queue, IServiceScopeFactory scopes, ILogger<LeadAlertService> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var leadId in queue.ReadAllAsync(stoppingToken))
        {
            try
            {
                using var scope = scopes.CreateScope();
                await scope.ServiceProvider.GetRequiredService<LeadAlertSender>().SendAsync(leadId, stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogError(ex, "Lead alerts failed for lead {Lead}: {Reason}", leadId, ex.Message);
            }
        }
    }
}

public record AlertResult(bool Ok, int? Status, string? Error);

public class LeadAlertSender(AppDbContext db, IdentityAlerts identity, WebhookSender webhooks, ILogger<LeadAlertSender> log)
{
    public async Task SendAsync(Guid leadId, CancellationToken ct)
    {
        var lead = await db.Leads.IgnoreQueryFilters().FirstOrDefaultAsync(l => l.Id == leadId, ct);
        if (lead is null) return;
        var bot = await db.Bots.IgnoreQueryFilters().FirstOrDefaultAsync(b => b.Id == lead.BotId, ct);
        if (bot is null) return;

        if (bot.AlertEmailEnabled)
        {
            var r = await identity.SendAsync(bot, lead, ct);
            if (!r.Ok) log.LogWarning("Lead alert email failed for bot {Bot}: {Reason}", bot.Id, r.Error);
        }
        if (bot.WebhookUrl is not null && bot.WebhookSecret is not null)
        {
            var r = await webhooks.SendAsync(bot.WebhookUrl, bot.WebhookSecret, LeadWebhook.Body(bot, lead), retries: true, ct);
            if (!r.Ok) log.LogWarning("Lead webhook failed for bot {Bot}: {Reason}", bot.Id, r.Error);
        }
    }

    /// <summary>A sample lead, so the owner can check the email or the webhook from the dashboard.</summary>
    public static Lead Sample(Bot bot) => new()
    {
        Id = Guid.Empty, TenantId = bot.TenantId, BotId = bot.Id, Name = "Test Lead", Phone = "+919800000000",
        Email = "test@example.com", Course = "Test enquiry", Channel = "web", CreatedAt = DateTime.UtcNow,
        Transcript = """[{"role":"user","text":"This is a test from BotForge."},{"role":"assistant","text":"Your lead alerts are working."}]""",
    };
}

public static class LeadWebhook
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static List<TranscriptTurn> Turns(Lead lead)
    {
        try
        {
            return (JsonSerializer.Deserialize<List<TranscriptTurn>>(lead.Transcript, Json) ?? [])
                .Where(t => !string.IsNullOrWhiteSpace(t.Text)).ToList();
        }
        catch (JsonException) { return []; }
    }

    /// <summary>Flat field names, so Google Sheets (Apps Script), Zapier and Make can map them without code.</summary>
    public static string Body(Bot bot, Lead lead) => JsonSerializer.Serialize(new
    {
        @event = lead.Id == Guid.Empty ? "lead.test" : "lead.created",
        leadId = lead.Id, botId = bot.Id, botName = bot.Name,
        name = lead.Name, phone = lead.Phone, email = lead.Email, course = lead.Course,
        channel = lead.Channel, pageUrl = lead.PageUrl, status = lead.Status,
        createdAt = lead.CreatedAt,
        transcript = string.Join("\n", Turns(lead).Select(t => $"{(t.Role == "user" ? "Visitor" : "Bot")}: {t.Text}")),
    }, Json);
}


/// <summary>Calls the identity service's internal lead-alert endpoint.</summary>
public class IdentityAlerts(HttpClient http, IConfiguration config)
{
    public async Task<AlertResult> SendAsync(Bot bot, Lead lead, CancellationToken ct)
    {
        var url = $"{(config["Services:IdentityUrl"] ?? "http://localhost:5120").TrimEnd('/')}/internal/tenants/{bot.TenantId}/lead-alert";
        using var msg = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = JsonContent.Create(new
            {
                to = bot.AlertEmail, botId = bot.Id, botName = bot.Name, name = lead.Name, phone = lead.Phone,
                email = lead.Email, course = lead.Course, channel = lead.Channel, pageUrl = lead.PageUrl,
                transcript = LeadWebhook.Turns(lead),
            })
        };
        msg.Headers.Add("X-Internal-Key", config["Internal:ApiKey"] ?? "");
        try
        {
            using var res = await http.SendAsync(msg, ct);
            return res.IsSuccessStatusCode ? new(true, (int)res.StatusCode, null)
                : new(false, (int)res.StatusCode, res.StatusCode == HttpStatusCode.BadGateway ? "The email provider refused the email." : $"Identity service answered {(int)res.StatusCode}.");
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            return new(false, null, "The email service is not reachable.");
        }
    }
}

/// <summary>
/// POSTs signed JSON to an owner's address. Only public internet addresses are reached (checked when connecting, so a
/// DNS answer cannot point it at the server's own network), unless Webhooks:AllowPrivate is set for local testing.
/// </summary>
public class WebhookSender(HttpClient http, ILogger<WebhookSender> log)
{
    public static readonly TimeSpan[] RetryDelays = [TimeSpan.FromSeconds(3), TimeSpan.FromSeconds(15)];
    public static Func<TimeSpan, CancellationToken, Task> Delay = Task.Delay;   // replaced in tests

    public static string Sign(string secret, string body) =>
        "sha256=" + Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(body))).ToLowerInvariant();

    public async Task<AlertResult> SendAsync(string url, string secret, string body, bool retries, CancellationToken ct)
    {
        AlertResult last = new(false, null, "Not sent.");
        var attempts = retries ? RetryDelays.Length + 1 : 1;
        for (var i = 0; i < attempts; i++)
        {
            if (i > 0) await Delay(RetryDelays[i - 1], ct);
            last = await TryOnceAsync(url, secret, body, ct);
            // 4xx means the receiver rejected it on purpose: trying again will not help
            if (last.Ok || last.Status is >= 400 and < 500) return last;
            log.LogInformation("Webhook attempt {Attempt} failed: {Reason}", i + 1, last.Error);
        }
        return last;
    }

    private async Task<AlertResult> TryOnceAsync(string url, string secret, string body, CancellationToken ct)
    {
        using var msg = new HttpRequestMessage(HttpMethod.Post, url) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        msg.Headers.Add("X-BotForge-Signature", Sign(secret, body));
        msg.Headers.Add("X-BotForge-Event", body.Contains("\"event\":\"lead.test\"") ? "lead.test" : "lead.created");
        msg.Headers.UserAgent.ParseAdd("BotForge-Webhook/1.0");
        try
        {
            using var res = await http.SendAsync(msg, ct);
            var code = (int)res.StatusCode;
            // Google Apps Script answers a POST with a redirect to the result page: the row is already written
            return res.IsSuccessStatusCode || code is 302 or 303 ? new(true, code, null) : new(false, code, $"The address answered {code}.");
        }
        catch (HttpRequestException ex) when (ex.InnerException is BlockedAddressException)
        {
            return new(false, null, "That address is not on the public internet.");
        }
        catch (HttpRequestException)
        {
            return new(false, null, "Could not connect to that address.");
        }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested)
        {
            return new(false, null, "The address did not answer within 10 seconds.");
        }
    }

    public static bool IsPublic(IPAddress ip)
    {
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        if (IPAddress.IsLoopback(ip) || ip.Equals(IPAddress.Any) || ip.Equals(IPAddress.IPv6Any)) return false;
        if (ip.AddressFamily == AddressFamily.InterNetwork)
        {
            var b = ip.GetAddressBytes();
            return !(b[0] == 10 || b[0] == 0 || b[0] >= 224
                     || (b[0] == 172 && b[1] is >= 16 and <= 31)
                     || (b[0] == 192 && b[1] == 168)
                     || (b[0] == 169 && b[1] == 254)          // link-local, cloud metadata
                     || (b[0] == 100 && b[1] is >= 64 and <= 127)); // carrier-grade NAT
        }
        return !(ip.IsIPv6LinkLocal || ip.IsIPv6SiteLocal || ip.IsIPv6Multicast || ip.IsIPv6UniqueLocal);
    }

    /// <summary>The handler for the webhook HttpClient: refuses private addresses at connect time.</summary>
    public static SocketsHttpHandler Handler(bool allowPrivate) => new()
    {
        AllowAutoRedirect = false,
        ConnectTimeout = TimeSpan.FromSeconds(5),
        ConnectCallback = async (context, ct) =>
        {
            var addresses = await Dns.GetHostAddressesAsync(context.DnsEndPoint.Host, ct);
            var target = addresses.FirstOrDefault(a => allowPrivate || IsPublic(a)) ?? throw new BlockedAddressException();
            var socket = new Socket(target.AddressFamily, SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
            try
            {
                await socket.ConnectAsync(new IPEndPoint(target, context.DnsEndPoint.Port), ct);
                return new NetworkStream(socket, ownsSocket: true);
            }
            catch
            {
                socket.Dispose();
                throw;
            }
        },
    };
}

public class BlockedAddressException() : Exception("Address not allowed");

public record TestAlertRequest(string? Kind);

/// <summary>The chat's action buttons (booking, payment), in the order the widget shows them.</summary>
public static class BotActions
{
    public static List<object> For(string botName, string? bookingUrl, string bookingLabel, string? paymentUrl, string? upiId, string paymentLabel)
    {
        var list = new List<object>();
        if (bookingUrl is not null) list.Add(new { kind = "booking", label = bookingLabel, url = bookingUrl });
        if (paymentUrl is not null) list.Add(new { kind = "payment", label = paymentLabel, url = paymentUrl });
        if (upiId is not null)
            list.Add(new
            {
                kind = "upi", label = paymentUrl is null ? paymentLabel : "Pay by UPI", upiId,
                // opens any UPI app on a phone (GPay, PhonePe, Paytm, BHIM); the amount is typed in the app
                url = $"upi://pay?pa={Uri.EscapeDataString(upiId)}&pn={Uri.EscapeDataString(botName)}&cu=INR",
            });
        return list;
    }
}
