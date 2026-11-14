using System.Text.RegularExpressions;
using Bots.Api.Data;

namespace Bots.Api;

/// <summary>PUT /bots/{id}: every field is optional; null means "leave unchanged".</summary>
public class UpdateBotRequest
{
    public string? Name { get; set; }
    public string? WelcomeMessage { get; set; }
    public List<string>? SuggestedQuestions { get; set; }

    public bool? LeadCaptureEnabled { get; set; }
    public string? LeadPrompt { get; set; }
    public int? LeadAfterMessages { get; set; }
    public bool? LeadAskEmail { get; set; }
    public bool? LeadAskCourse { get; set; }
    public string? LeadCourseLabel { get; set; }
    public string? LeadTiming { get; set; }

    public string? Tone { get; set; }
    public string? AnswerLength { get; set; }
    public string? TopicsToAvoid { get; set; }
    public string? CustomInstructions { get; set; }
    public bool? ShowSources { get; set; }

    /// <summary>"" clears it.</summary>
    public string? WidgetColor { get; set; }
    public string? WidgetPosition { get; set; }
    /// <summary>"" removes the logo.</summary>
    public string? AvatarDataUrl { get; set; }

    public bool? HoursEnabled { get; set; }
    public string? HoursStart { get; set; }
    public string? HoursEnd { get; set; }
    public List<int>? HoursDays { get; set; }
    public string? TimeZone { get; set; }
    public string? OfflineMessage { get; set; }
    public string? ReplyLanguage { get; set; }
    public bool? VoiceEnabled { get; set; }

    public bool? AlertEmailEnabled { get; set; }
    /// <summary>"" = the owner's address.</summary>
    public string? AlertEmail { get; set; }
    /// <summary>"" turns the webhook off.</summary>
    public string? WebhookUrl { get; set; }
    /// <summary>"" clears these.</summary>
    public string? BookingUrl { get; set; }
    public string? BookingLabel { get; set; }
    public string? PaymentUrl { get; set; }
    public string? UpiId { get; set; }
    public string? PaymentLabel { get; set; }
}

public record BotDto(Guid Id, string Name, string WelcomeMessage, string PublicKey, DateTime CreatedAt,
    bool LeadCaptureEnabled, string LeadPrompt, int LeadAfterMessages, List<string> SuggestedQuestions,
    bool LeadAskEmail, bool LeadAskCourse, string LeadCourseLabel, string LeadTiming,
    string Tone, string AnswerLength, string TopicsToAvoid, string CustomInstructions, bool ShowSources,
    string? WidgetColor, string WidgetPosition, string? AvatarDataUrl,
    bool HoursEnabled, string HoursStart, string HoursEnd, List<int> HoursDays, string TimeZone, string OfflineMessage,
    string ReplyLanguage, bool VoiceEnabled,
    bool AlertEmailEnabled, string? AlertEmail, string? WebhookUrl, string? WebhookSecret,
    string? BookingUrl, string BookingLabel, string? PaymentUrl, string? UpiId, string PaymentLabel)
{
    public static BotDto From(Bot b) => new(b.Id, b.Name, b.WelcomeMessage, b.PublicKey, b.CreatedAt,
        b.LeadCaptureEnabled, b.LeadPrompt, b.LeadAfterMessages, b.SuggestedQuestions,
        b.LeadAskEmail, b.LeadAskCourse, b.LeadCourseLabel, b.LeadTiming,
        b.Tone, b.AnswerLength, b.TopicsToAvoid, b.CustomInstructions, b.ShowSources,
        b.WidgetColor, b.WidgetPosition, b.AvatarDataUrl,
        b.HoursEnabled, b.HoursStart, b.HoursEnd, b.HoursDays, b.TimeZone, b.OfflineMessage, b.ReplyLanguage, b.VoiceEnabled,
        b.AlertEmailEnabled, b.AlertEmail, b.WebhookUrl, b.WebhookSecret,
        b.BookingUrl, b.BookingLabel, b.PaymentUrl, b.UpiId, b.PaymentLabel);
}

public static partial class BotSettingsRules
{
    public static readonly IReadOnlySet<string> Tones = new HashSet<string> { "friendly", "professional", "casual", "enthusiastic" };
    public static readonly IReadOnlySet<string> Lengths = new HashSet<string> { "short", "medium", "detailed" };
    public static readonly IReadOnlySet<string> Timings = new HashSet<string> { "after", "start", "button" };
    public static readonly IReadOnlySet<string> Languages =
        new HashSet<string> { "auto", "en", "hi", "mr", "ta", "te", "bn", "gu", "kn", "ml", "pa", "ur" };
    public const int MaxAvatarChars = 70_000;   // ~50 KB image; the dashboard resizes logos to 160 px

    [GeneratedRegex("^#[0-9a-fA-F]{6}$")] private static partial Regex Color();
    [GeneratedRegex("^([01][0-9]|2[0-3]):[0-5][0-9]$")] private static partial Regex Time();
    [GeneratedRegex(@"^[A-Za-z_]+(/[A-Za-z0-9_+\-]+){0,2}$")] private static partial Regex Zone();
    [GeneratedRegex("^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$")] private static partial Regex Avatar();
    [GeneratedRegex(@"^[^@\s]+@[^@\s]+\.[^@\s]+$")] private static partial Regex Email();
    [GeneratedRegex(@"^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,63}$")] private static partial Regex Upi();

    /// <summary>An absolute http(s) address of at most 500 characters.</summary>
    public static bool IsWebUrl(string url) =>
        url.Length <= 500 && Uri.TryCreate(url, UriKind.Absolute, out var u) && (u.Scheme == Uri.UriSchemeHttps || u.Scheme == Uri.UriSchemeHttp)
        && !string.IsNullOrEmpty(u.Host);

    public static string? Validate(UpdateBotRequest r)
    {
        if (r.LeadCourseLabel is { } label && (label.Trim().Length is 0 or > 60)) return "The interest field label must be 1-60 characters.";
        if (r.LeadTiming is { } t && !Timings.Contains(t)) return "Lead form timing must be after, start or button.";
        if (r.Tone is { } tone && !Tones.Contains(tone)) return "Tone must be friendly, professional, casual or enthusiastic.";
        if (r.AnswerLength is { } len && !Lengths.Contains(len)) return "Answer length must be short, medium or detailed.";
        if (r.TopicsToAvoid?.Trim().Length > 500) return "Topics to avoid must be at most 500 characters.";
        if (r.CustomInstructions?.Trim().Length > 1000) return "Custom instructions must be at most 1000 characters.";
        if (!string.IsNullOrEmpty(r.WidgetColor) && !Color().IsMatch(r.WidgetColor)) return "Colour must look like #1d4ed8.";
        if (r.WidgetPosition is { } pos && pos is not ("right" or "left")) return "Position must be right or left.";
        if (!string.IsNullOrEmpty(r.AvatarDataUrl) && (r.AvatarDataUrl.Length > MaxAvatarChars || !Avatar().IsMatch(r.AvatarDataUrl)))
            return "The logo must be a PNG, JPEG or WebP image under 50 KB.";
        if (r.HoursStart is { } hs && !Time().IsMatch(hs)) return "Opening time must look like 09:00.";
        if (r.HoursEnd is { } he && !Time().IsMatch(he)) return "Closing time must look like 18:00.";
        if (r.HoursDays is { } days && (days.Count > 7 || days.Any(d => d is < 1 or > 7))) return "Days must be numbers 1 (Monday) to 7 (Sunday).";
        if (r.TimeZone is { } zone && (zone.Length > 60 || !Zone().IsMatch(zone))) return "Time zone must look like Asia/Kolkata.";
        if (r.OfflineMessage?.Trim().Length > 300) return "The closed message must be at most 300 characters.";
        if (r.ReplyLanguage is { } lang && !Languages.Contains(lang)) return "Unknown reply language.";
        if (!string.IsNullOrWhiteSpace(r.AlertEmail) && (r.AlertEmail.Trim().Length > 200 || !Email().IsMatch(r.AlertEmail.Trim())))
            return "The alert email address does not look right.";
        if (!string.IsNullOrWhiteSpace(r.WebhookUrl) && !IsWebUrl(r.WebhookUrl.Trim())) return "The webhook must be a web address starting with https://.";
        if (!string.IsNullOrWhiteSpace(r.BookingUrl) && !IsWebUrl(r.BookingUrl.Trim())) return "The booking link must be a web address starting with https://.";
        if (!string.IsNullOrWhiteSpace(r.PaymentUrl) && !IsWebUrl(r.PaymentUrl.Trim())) return "The payment link must be a web address starting with https://.";
        if (!string.IsNullOrWhiteSpace(r.UpiId) && !Upi().IsMatch(r.UpiId.Trim())) return "The UPI ID must look like yourname@okaxis.";
        if (r.BookingLabel is { } bl && (bl.Trim().Length is 0 or > 40)) return "The booking button text must be 1-40 characters.";
        if (r.PaymentLabel is { } pl && (pl.Trim().Length is 0 or > 40)) return "The payment button text must be 1-40 characters.";
        return null;
    }

    public static void Apply(Bot bot, UpdateBotRequest r)
    {
        if (r.LeadAskEmail is { } email) bot.LeadAskEmail = email;
        if (r.LeadAskCourse is { } course) bot.LeadAskCourse = course;
        if (r.LeadCourseLabel is { } label) bot.LeadCourseLabel = label.Trim();
        if (r.LeadTiming is { } timing) bot.LeadTiming = timing;
        if (r.Tone is { } tone) bot.Tone = tone;
        if (r.AnswerLength is { } len) bot.AnswerLength = len;
        if (r.TopicsToAvoid is { } avoid) bot.TopicsToAvoid = avoid.Trim();
        if (r.CustomInstructions is { } custom) bot.CustomInstructions = custom.Trim();
        if (r.ShowSources is { } sources) bot.ShowSources = sources;
        if (r.WidgetColor is { } color) bot.WidgetColor = color.Length == 0 ? null : color.ToLowerInvariant();
        if (r.WidgetPosition is { } pos) bot.WidgetPosition = pos;
        if (r.AvatarDataUrl is { } avatar) bot.AvatarDataUrl = avatar.Length == 0 ? null : avatar;
        if (r.HoursEnabled is { } hours) bot.HoursEnabled = hours;
        if (r.HoursStart is { } hs) bot.HoursStart = hs;
        if (r.HoursEnd is { } he) bot.HoursEnd = he;
        if (r.HoursDays is { } days) bot.HoursDays = days.Distinct().Order().ToList();
        if (r.TimeZone is { } zone) bot.TimeZone = zone;
        if (r.OfflineMessage is { } offline && offline.Trim().Length > 0) bot.OfflineMessage = offline.Trim();
        if (r.ReplyLanguage is { } language) bot.ReplyLanguage = language;
        if (r.VoiceEnabled is { } voice) bot.VoiceEnabled = voice;
        if (r.AlertEmailEnabled is { } alerts) bot.AlertEmailEnabled = alerts;
        if (r.AlertEmail is { } to) bot.AlertEmail = Blank(to)?.ToLowerInvariant();
        if (r.WebhookUrl is { } hook)
        {
            bot.WebhookUrl = Blank(hook);
            // a secret the first time a webhook is set; it stays when the address changes
            if (bot.WebhookUrl is not null && bot.WebhookSecret is null)
                bot.WebhookSecret = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(24)).ToLowerInvariant();
        }
        if (r.BookingUrl is { } booking) bot.BookingUrl = Blank(booking);
        if (r.BookingLabel is { } bl) bot.BookingLabel = bl.Trim();
        if (r.PaymentUrl is { } pay) bot.PaymentUrl = Blank(pay);
        if (r.UpiId is { } upi) bot.UpiId = Blank(upi);
        if (r.PaymentLabel is { } pl) bot.PaymentLabel = pl.Trim();
    }

    private static string? Blank(string s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
