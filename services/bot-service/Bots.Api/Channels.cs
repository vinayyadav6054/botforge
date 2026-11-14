using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Bots.Api.Billing;
using Bots.Api.Data;
using Bots.Api.Tenancy;
using Microsoft.EntityFrameworkCore;

namespace Bots.Api;

/// <summary>A messaging app connected to a bot: WhatsApp, Instagram, Facebook Messenger or Telegram.</summary>
public class Channel
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid BotId { get; set; }
    public string Kind { get; set; } = default!;
    /// <summary>What the owner recognises: "+91 98200 12345", "@sunrise_bot", the page name.</summary>
    public string DisplayName { get; set; } = "";
    /// <summary>Phone number id, page id or Telegram bot id.</summary>
    public string ExternalId { get; set; } = "";
    /// <summary>Access tokens and app secret, AES-GCM encrypted (SecretBox).</summary>
    public string SecretsCipher { get; set; } = "";
    /// <summary>Meta webhooks: the owner pastes it in the Meta app; Meta sends it back when verifying.</summary>
    public string VerifyToken { get; set; } = "";
    /// <summary>Telegram sends it in X-Telegram-Bot-Api-Secret-Token with every update.</summary>
    public string WebhookSecret { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastMessageAt { get; set; }
    public string? LastError { get; set; }
}

public record ChannelRequest(string? Kind, string? Token = null, string? PhoneNumberId = null, string? AccessToken = null,
    string? AppSecret = null, string? PageToken = null);

public record ChannelDto(Guid Id, string Kind, string DisplayName, string WebhookUrl, string? VerifyToken,
    DateTime CreatedAt, DateTime? LastMessageAt, string? LastError);

/// <summary>Encrypts channel secrets with a key derived from Jwt:Key (stable, already required).</summary>
public class SecretBox(IConfiguration config)
{
    private byte[] Key => HKDF.DeriveKey(HashAlgorithmName.SHA256, Encoding.UTF8.GetBytes(config["Jwt:Key"]!), 32,
        // "botforge" is the product's former name: it must never change, or every saved connection stops decrypting
        Encoding.UTF8.GetBytes("botforge"), Encoding.UTF8.GetBytes("channel-secrets-v1"));

    public string Seal(Dictionary<string, string> secrets)
    {
        var plain = JsonSerializer.SerializeToUtf8Bytes(secrets);
        var nonce = RandomNumberGenerator.GetBytes(12);
        var tag = new byte[16];
        var cipher = new byte[plain.Length];
        using var aes = new AesGcm(Key, 16);
        aes.Encrypt(nonce, plain, cipher, tag);
        return Convert.ToBase64String([.. nonce, .. tag, .. cipher]);
    }

    public Dictionary<string, string> Open(string sealedText)
    {
        var all = Convert.FromBase64String(sealedText);
        var plain = new byte[all.Length - 28];
        using var aes = new AesGcm(Key, 16);
        aes.Decrypt(all[..12], all[28..], all[12..28], plain);
        return JsonSerializer.Deserialize<Dictionary<string, string>>(plain)!;
    }
}

/// <summary>Checks the owner's credentials with the platform and registers the webhook where that is possible.</summary>
public class ChannelPlatforms(HttpClient http, IConfiguration config, ILogger<ChannelPlatforms> log)
{
    private string Telegram => (config["Channels:TelegramApi"] ?? "https://api.telegram.org").TrimEnd('/');
    private string Graph => (config["Channels:GraphApi"] ?? "https://graph.facebook.com/v21.0").TrimEnd('/');

    public record Setup(string? Error, string DisplayName = "", string ExternalId = "", Dictionary<string, string>? Secrets = null);

    private async Task<JsonElement?> GetJson(string url, string? bearer = null)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        if (bearer is not null) req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
        using var res = await http.SendAsync(req);
        if (!res.IsSuccessStatusCode) return null;
        return JsonDocument.Parse(await res.Content.ReadAsStringAsync()).RootElement.Clone();
    }

    public async Task<Setup> CheckAsync(ChannelRequest r)
    {
        try
        {
            switch (r.Kind)
            {
                case "telegram":
                {
                    var token = (r.Token ?? "").Trim();
                    if (!System.Text.RegularExpressions.Regex.IsMatch(token, @"^\d{5,15}:[A-Za-z0-9_-]{30,50}$"))
                        return new("Paste the bot token from @BotFather (it looks like 123456789:AA…).");
                    var me = await GetJson($"{Telegram}/bot{token}/getMe");
                    if (me is not { } m || !m.GetProperty("ok").GetBoolean()) return new("Telegram rejected this token.");
                    var bot = m.GetProperty("result");
                    return new(null, "@" + bot.GetProperty("username").GetString(), bot.GetProperty("id").GetRawText(),
                        new() { ["token"] = token });
                }
                case "whatsapp":
                {
                    var id = (r.PhoneNumberId ?? "").Trim();
                    var token = (r.AccessToken ?? "").Trim();
                    if (!System.Text.RegularExpressions.Regex.IsMatch(id, @"^\d{6,25}$")) return new("Paste the Phone number ID (digits) from WhatsApp → API Setup.");
                    if (token.Length < 20 || string.IsNullOrWhiteSpace(r.AppSecret)) return new("Paste the access token and the app secret.");
                    var phone = await GetJson($"{Graph}/{id}?fields=display_phone_number,verified_name", token);
                    if (phone is not { } p) return new("Meta rejected this phone number ID or access token.");
                    var shown = p.TryGetProperty("display_phone_number", out var n) ? n.GetString() : id;
                    return new(null, shown ?? id, id, new() { ["accessToken"] = token, ["appSecret"] = r.AppSecret!.Trim(), ["phoneNumberId"] = id });
                }
                case "messenger":
                case "instagram":
                {
                    var token = (r.PageToken ?? "").Trim();
                    if (token.Length < 20 || string.IsNullOrWhiteSpace(r.AppSecret)) return new("Paste the Page access token and the app secret.");
                    var page = await GetJson($"{Graph}/me?fields=id,name,instagram_business_account%7Bid,username%7D", token);
                    if (page is not { } pg) return new("Meta rejected this Page access token.");
                    var pageId = pg.GetProperty("id").GetString()!;
                    var secrets = new Dictionary<string, string> { ["pageToken"] = token, ["appSecret"] = r.AppSecret!.Trim(), ["pageId"] = pageId };
                    string display = pg.TryGetProperty("name", out var nm) ? nm.GetString() ?? pageId : pageId;
                    if (r.Kind == "instagram")
                    {
                        if (!pg.TryGetProperty("instagram_business_account", out var ig))
                            return new("This Page has no Instagram professional account linked. Link it in Meta Business Suite first.");
                        secrets["igUserId"] = ig.GetProperty("id").GetString()!;
                        display = "@" + (ig.TryGetProperty("username", out var u) ? u.GetString() : secrets["igUserId"]);
                    }
                    await PostQuietly($"{Graph}/{pageId}/subscribed_apps?subscribed_fields=messages&access_token={Uri.EscapeDataString(token)}");
                    return new(null, display, r.Kind == "instagram" ? secrets["igUserId"] : pageId, secrets);
                }
                default:
                    return new("Kind must be whatsapp, instagram, messenger or telegram.");
            }
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException or KeyNotFoundException)
        {
            log.LogWarning(ex, "Channel check failed for {Kind}", r.Kind);
            return new("The platform could not be reached or answered unexpectedly. Try again.");
        }
    }

    public async Task<bool> SetTelegramWebhookAsync(string token, string url, string secret)
    {
        using var res = await http.PostAsJsonAsync($"{Telegram}/bot{token}/setWebhook",
            new { url, secret_token = secret, allowed_updates = new[] { "message" }, drop_pending_updates = true });
        return res.IsSuccessStatusCode;
    }

    public Task DeleteTelegramWebhookAsync(string token) => PostQuietly($"{Telegram}/bot{token}/deleteWebhook");

    private async Task PostQuietly(string url)
    {
        try { using var _ = await http.PostAsync(url, null); }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException) { log.LogInformation("Optional call failed: {Error}", ex.Message); }
    }
}

public static class ChannelEndpoints
{
    public static readonly IReadOnlySet<string> Kinds = new HashSet<string> { "whatsapp", "instagram", "messenger", "telegram" };

    public static string WebhookUrl(IConfiguration config, Channel c) =>
        $"{(config["Channels:PublicUrl"] ?? "").TrimEnd('/')}/api/channels/{c.Kind}/{c.Id}";

    private static ChannelDto Dto(IConfiguration config, Channel c) =>
        new(c.Id, c.Kind, c.DisplayName, WebhookUrl(config, c), c.Kind == "telegram" ? null : c.VerifyToken,
            c.CreatedAt, c.LastMessageAt, c.LastError);

    private static string RandomToken() => Convert.ToHexString(RandomNumberGenerator.GetBytes(20)).ToLowerInvariant();

    public static void MapChannelEndpoints(this RouteGroupBuilder bots, WebApplication app)
    {
        bots.MapGet("/{botId:guid}/channels", async (Guid botId, AppDbContext db, IConfiguration config) =>
        {
            if (!await db.Bots.AnyAsync(b => b.Id == botId)) return Results.NotFound();
            var list = await db.Channels.Where(c => c.BotId == botId).OrderBy(c => c.CreatedAt).ToListAsync();
            return Results.Ok(list.Select(c => Dto(config, c)));
        });

        bots.MapPost("/{botId:guid}/channels", async (Guid botId, ChannelRequest req, AppDbContext db, ITenantContext tenant,
            SubscriptionService subs, ChannelPlatforms platforms, SecretBox box, IConfiguration config) =>
        {
            if (!await db.Bots.AnyAsync(b => b.Id == botId)) return Results.NotFound();
            if (req.Kind is null || !Kinds.Contains(req.Kind)) return Results.BadRequest(new { error = "Kind must be whatsapp, instagram, messenger or telegram." });
            var plan = await subs.EffectivePlanAsync(tenant.TenantId);
            if (!plan.MessagingApps)
                return Results.Json(new { error = "WhatsApp, Instagram, Messenger and Telegram are included in the Business and Pro plans.", code = "plan_limit" },
                    statusCode: StatusCodes.Status402PaymentRequired);
            if (string.IsNullOrWhiteSpace(config["Channels:PublicUrl"]))
                return Results.BadRequest(new { error = "Messaging apps work once Kahiye is online (they need a public address to send messages to)." });

            var setup = await platforms.CheckAsync(req);
            if (setup.Error is not null) return Results.BadRequest(new { error = setup.Error });
            if (await db.Channels.IgnoreQueryFilters().AnyAsync(c => c.Kind == req.Kind && c.ExternalId == setup.ExternalId))
                return Results.Conflict(new { error = "This account is already connected to a bot." });

            var channel = new Channel
            {
                TenantId = tenant.TenantId, BotId = botId, Kind = req.Kind, DisplayName = setup.DisplayName,
                ExternalId = setup.ExternalId, SecretsCipher = box.Seal(setup.Secrets!),
                VerifyToken = RandomToken(), WebhookSecret = RandomToken()
            };
            if (req.Kind == "telegram" &&
                !await platforms.SetTelegramWebhookAsync(setup.Secrets!["token"], WebhookUrl(config, channel), channel.WebhookSecret))
                return Results.BadRequest(new { error = "Telegram did not accept the webhook address. Is Kahiye reachable over https?" });

            db.Channels.Add(channel);
            await db.SaveChangesAsync();
            return Results.Created($"/bots/{botId}/channels/{channel.Id}", Dto(config, channel));
        });

        bots.MapDelete("/{botId:guid}/channels/{channelId:guid}", async (Guid botId, Guid channelId, AppDbContext db,
            ChannelPlatforms platforms, SecretBox box) =>
        {
            var channel = await db.Channels.FirstOrDefaultAsync(c => c.Id == channelId && c.BotId == botId);
            if (channel is null) return Results.NotFound();
            if (channel.Kind == "telegram") await platforms.DeleteTelegramWebhookAsync(box.Open(channel.SecretsCipher)["token"]);
            db.Channels.Remove(channel);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // ---------- internal: the chat service handles the webhooks ----------
        app.MapGet("/internal/channels/{channelId:guid}", async (Guid channelId, HttpRequest request, IConfiguration config,
            AppDbContext db, SecretBox box) =>
        {
            if (!KeyCheck.HasInternalKey(request, config)) return Results.Unauthorized();
            var c = await db.Channels.IgnoreQueryFilters().FirstOrDefaultAsync(x => x.Id == channelId);
            if (c is null) return Results.NotFound();
            var key = await db.Bots.IgnoreQueryFilters().Where(b => b.Id == c.BotId).Select(b => b.PublicKey).FirstAsync();
            return Results.Ok(new
            {
                c.Id, c.Kind, c.BotId, c.TenantId, botPublicKey = key, c.ExternalId, c.VerifyToken, c.WebhookSecret,
                secrets = box.Open(c.SecretsCipher)
            });
        });

        app.MapPost("/internal/channels/{channelId:guid}/status", async (Guid channelId, ChannelStatus req, HttpRequest request,
            IConfiguration config, AppDbContext db) =>
        {
            if (!KeyCheck.HasInternalKey(request, config)) return Results.Unauthorized();
            var c = await db.Channels.IgnoreQueryFilters().FirstOrDefaultAsync(x => x.Id == channelId);
            if (c is null) return Results.NotFound();
            c.LastMessageAt = DateTime.UtcNow;
            c.LastError = string.IsNullOrWhiteSpace(req.Error) ? null : DocumentRules.Truncate(req.Error.Trim(), 300);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // recent turns of a messaging-app conversation, so follow-up questions have context
        app.MapGet("/internal/conversations/{conversationId:guid}/turns", async (Guid conversationId, int? take,
            HttpRequest request, IConfiguration config, AppDbContext db) =>
        {
            if (!KeyCheck.HasInternalKey(request, config)) return Results.Unauthorized();
            var n = Math.Clamp(take ?? 10, 1, 20);
            var turns = await db.ConversationMessages.IgnoreQueryFilters().Where(m => m.ConversationId == conversationId)
                .OrderByDescending(m => m.CreatedAt).ThenBy(m => m.Role == "user" ? 1 : 0).Take(n)
                .Select(m => new { role = m.Role, text = m.Text }).ToListAsync();
            turns.Reverse();
            return Results.Ok(turns);
        });
    }
}

public record ChannelStatus(string? Error);
