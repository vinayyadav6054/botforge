using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Bots.Api.Data;
using Microsoft.Extensions.Options;

namespace Bots.Api.Billing;

public class RazorpayOptions
{
    public string? KeyId { get; set; }
    public string? KeySecret { get; set; }
    public string? WebhookSecret { get; set; }
    /// <summary>Razorpay plan ids (plan_...) per BotForge plan id: starter, business, pro.</summary>
    public Dictionary<string, string> Plans { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    public bool Enabled => !string.IsNullOrWhiteSpace(KeyId) && !string.IsNullOrWhiteSpace(KeySecret);

    public string? PlanIdFor(string plan) =>
        Plans.TryGetValue(plan, out var id) && !string.IsNullOrWhiteSpace(id) ? id : null;
}

public record CheckoutLink(string SubscriptionId, string Url);

public interface IRazorpayClient
{
    Task<CheckoutLink> CreateSubscriptionAsync(string razorpayPlanId, Guid tenantId, string plan, CancellationToken ct = default);
    Task CancelSubscriptionAsync(string subscriptionId, bool atCycleEnd, CancellationToken ct = default);
}

/// <summary>Razorpay Subscriptions REST API. The owner pays on Razorpay's hosted page (short_url).</summary>
public class RazorpayClient(HttpClient http, IOptions<RazorpayOptions> options) : IRazorpayClient
{
    private void Authorize(HttpRequestMessage msg)
    {
        var o = options.Value;
        var raw = Encoding.UTF8.GetBytes($"{o.KeyId}:{o.KeySecret}");
        msg.Headers.Authorization = new AuthenticationHeaderValue("Basic", Convert.ToBase64String(raw));
    }

    public async Task<CheckoutLink> CreateSubscriptionAsync(string razorpayPlanId, Guid tenantId, string plan, CancellationToken ct = default)
    {
        using var msg = new HttpRequestMessage(HttpMethod.Post, "https://api.razorpay.com/v1/subscriptions")
        {
            Content = JsonContent.Create(new
            {
                plan_id = razorpayPlanId,
                total_count = 120,            // monthly for up to 10 years, until cancelled
                customer_notify = 1,
                notes = new { tenant_id = tenantId.ToString(), plan }
            })
        };
        Authorize(msg);
        using var res = await http.SendAsync(msg, ct);
        var body = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
            throw new HttpRequestException($"Razorpay returned {(int)res.StatusCode}: {Truncate(body, 300)}");
        using var json = JsonDocument.Parse(body);
        return new CheckoutLink(json.RootElement.GetProperty("id").GetString()!,
                                json.RootElement.GetProperty("short_url").GetString()!);
    }

    public async Task CancelSubscriptionAsync(string subscriptionId, bool atCycleEnd, CancellationToken ct = default)
    {
        using var msg = new HttpRequestMessage(HttpMethod.Post,
            $"https://api.razorpay.com/v1/subscriptions/{Uri.EscapeDataString(subscriptionId)}/cancel")
        {
            Content = JsonContent.Create(new { cancel_at_cycle_end = atCycleEnd ? 1 : 0 })
        };
        Authorize(msg);
        using var res = await http.SendAsync(msg, ct);
        if (!res.IsSuccessStatusCode)
            throw new HttpRequestException($"Razorpay cancel returned {(int)res.StatusCode}");
    }

    private static string Truncate(string s, int n) => s.Length <= n ? s : s[..n];
}

/// <summary>What a Razorpay webhook means for a subscription row.</summary>
public record WebhookChange(Guid TenantId, string SubscriptionId, string Status, string? Plan, DateTime? PeriodEnd);

public static class RazorpayWebhook
{
    /// <summary>X-Razorpay-Signature is the hex HMAC-SHA256 of the raw body with the webhook secret.</summary>
    public static bool IsValidSignature(string body, string? signature, string? secret)
    {
        if (string.IsNullOrEmpty(secret) || string.IsNullOrEmpty(signature)) return false;
        var expected = HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(body));
        byte[] provided;
        try { provided = Convert.FromHexString(signature.Trim()); }
        catch (FormatException) { return false; }
        return CryptographicOperations.FixedTimeEquals(expected, provided);
    }

    /// <summary>Null for events that do not change the plan (or payloads we cannot attribute to a business).</summary>
    public static WebhookChange? Parse(string body)
    {
        using var json = JsonDocument.Parse(body);
        var root = json.RootElement;
        var evt = root.TryGetProperty("event", out var e) ? e.GetString() : null;
        var status = evt switch
        {
            "subscription.activated" or "subscription.charged" or "subscription.resumed" => SubscriptionStatus.Active,
            "subscription.halted" => SubscriptionStatus.Halted,
            "subscription.cancelled" or "subscription.completed" => SubscriptionStatus.Cancelled,
            _ => null
        };
        if (status is null) return null;

        if (!root.TryGetProperty("payload", out var payload) ||
            !payload.TryGetProperty("subscription", out var sub) ||
            !sub.TryGetProperty("entity", out var entity)) return null;

        var id = entity.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
        if (string.IsNullOrEmpty(id)) return null;

        string? tenant = null, plan = null;
        if (entity.TryGetProperty("notes", out var notes) && notes.ValueKind == JsonValueKind.Object)
        {
            tenant = notes.TryGetProperty("tenant_id", out var t) ? t.GetString() : null;
            plan = notes.TryGetProperty("plan", out var p) ? p.GetString() : null;
        }
        if (!Guid.TryParse(tenant, out var tenantId)) return null;

        DateTime? end = entity.TryGetProperty("current_end", out var ce) && ce.ValueKind == JsonValueKind.Number
            ? DateTimeOffset.FromUnixTimeSeconds(ce.GetInt64()).UtcDateTime
            : null;
        return new WebhookChange(tenantId, id, status, Plans.FindPaid(plan)?.Id, end);
    }

    /// <summary>Applies a change; returns the id of an older Razorpay subscription that should now be cancelled.</summary>
    public static string? Apply(Subscription s, WebhookChange c, DateTime now)
    {
        string? replaced = null;
        if (s.ProviderSubscriptionId != c.SubscriptionId)
        {
            // only a newly activated subscription may replace the current one (upgrade/downgrade);
            // late events about an old subscription must not touch the plan
            if (c.Status != SubscriptionStatus.Active) return null;
            if (s.Provider == "razorpay" && !string.IsNullOrEmpty(s.ProviderSubscriptionId)) replaced = s.ProviderSubscriptionId;
            s.ProviderSubscriptionId = c.SubscriptionId;
            s.Provider = "razorpay";
        }
        s.Status = c.Status;
        if (c.Plan is not null) s.Plan = c.Plan;
        if (c.PeriodEnd is { } end && (s.CurrentPeriodEnd is null || end > s.CurrentPeriodEnd || c.Status == SubscriptionStatus.Active))
            s.CurrentPeriodEnd = end;
        s.UpdatedAt = now;
        return replaced;
    }
}
