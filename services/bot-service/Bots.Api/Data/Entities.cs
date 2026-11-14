using Bots.Api;

namespace Bots.Api.Data;

public class Bot
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public string Name { get; set; } = default!;
    public string WelcomeMessage { get; set; } = "Hi! How can I help you today?";
    public string PublicKey { get; set; } = default!;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // lead capture: after N answers the widget invites the visitor to leave their details
    public bool LeadCaptureEnabled { get; set; }
    public string LeadPrompt { get; set; } = LeadRules.DefaultPrompt;
    public int LeadAfterMessages { get; set; } = LeadRules.DefaultAfterMessages;

    // shown as tappable buttons under the welcome message in the widget
    public List<string> SuggestedQuestions { get; set; } = new();

    // lead form: which fields and when it opens ("after" N answers, "start" of the chat, or only the "button")
    public bool LeadAskEmail { get; set; }
    public bool LeadAskCourse { get; set; } = true;
    public string LeadCourseLabel { get; set; } = "Course / interest";
    public string LeadTiming { get; set; } = "after";

    // personality and rules (added to the AI's instructions, below the grounding rules)
    public string Tone { get; set; } = "friendly";
    public string AnswerLength { get; set; } = "medium";
    public string TopicsToAvoid { get; set; } = "";
    public string CustomInstructions { get; set; } = "";
    /// <summary>Show "Source: Fees.pdf, page 2" under answers.</summary>
    public bool ShowSources { get; set; } = true;

    // widget look; WidgetColor null = the snippet's data-color or the default
    public string? WidgetColor { get; set; }
    public string WidgetPosition { get; set; } = "right";
    /// <summary>Small logo as a data: URL (resized in the dashboard), shown as the bot's avatar.</summary>
    public string? AvatarDataUrl { get; set; }

    // opening hours: outside them the widget shows OfflineMessage (the AI still answers)
    public bool HoursEnabled { get; set; }
    public string HoursStart { get; set; } = "09:00";
    public string HoursEnd { get; set; } = "18:00";
    /// <summary>ISO weekdays, 1 = Monday ... 7 = Sunday.</summary>
    public List<int> HoursDays { get; set; } = [1, 2, 3, 4, 5, 6];
    public string TimeZone { get; set; } = "Asia/Kolkata";
    public string OfflineMessage { get; set; } = "We're closed right now. Ask me anything, or leave your number and we'll call you back.";

    /// <summary>"auto" = reply in the visitor's language; or a language code (hi, mr, ta, ...) to always use.</summary>
    public string ReplyLanguage { get; set; } = "auto";
    /// <summary>Microphone and read-aloud buttons in the website chat.</summary>
    public bool VoiceEnabled { get; set; } = true;

    // lead alerts: an email for every new lead (to the owner, or AlertEmail), and an optional signed webhook
    public bool AlertEmailEnabled { get; set; } = true;
    public string? AlertEmail { get; set; }
    public string? WebhookUrl { get; set; }
    /// <summary>Signs webhook bodies (HMAC-SHA256), so the receiver can check they came from Kahiye.</summary>
    public string? WebhookSecret { get; set; }

    // action buttons in the chat, also given to the AI so it can share them when a visitor asks
    public string? BookingUrl { get; set; }
    public string BookingLabel { get; set; } = "Book a visit";
    public string? PaymentUrl { get; set; }
    public string? UpiId { get; set; }
    public string PaymentLabel { get; set; } = "Pay fees";
}

/// <summary>An answer written by the owner; the bot prefers it when a visitor asks a matching question.</summary>
public class QaEntry
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid BotId { get; set; }
    public string Question { get; set; } = default!;
    public string Answer { get; set; } = default!;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public class BotDocument
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid BotId { get; set; }
    public string FileName { get; set; } = default!;
    public string ContentType { get; set; } = default!;
    public long SizeBytes { get; set; }
    public string StorageKey { get; set; } = default!;
    public string Status { get; set; } = "Uploaded";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public int? ChunkCount { get; set; }
    public string? Error { get; set; }

    /// <summary>"file" (uploaded) or an online source: "website", "google", "notion", "youtube".</summary>
    public string Kind { get; set; } = "file";
    public string? SourceUrl { get; set; }
    /// <summary>Access token for the source (Notion integration). Never returned by the API.</summary>
    public string? SourceSecret { get; set; }
    public int MaxPages { get; set; }
    /// <summary>Fetch online sources again every N days (0 = only when the owner clicks Sync).</summary>
    public int SyncIntervalDays { get; set; }
    public DateTime? LastSyncedAt { get; set; }
}

public class Lead
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public Guid BotId { get; set; }
    public string Name { get; set; } = default!;
    public string Phone { get; set; } = default!;      // normalised: digits with optional leading +
    public string? Email { get; set; }
    public string? Course { get; set; }
    public string? PageUrl { get; set; }
    public string Transcript { get; set; } = "[]";      // JSON array of {role, text}, the chat that led here
    public string Status { get; set; } = LeadStatus.New;
    /// <summary>Where the enquiry came from: "web" or a messaging app.</summary>
    public string Channel { get; set; } = "web";
    public DateTime ConsentAt { get; set; } = DateTime.UtcNow;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public static class LeadStatus
{
    public const string New = "New";
    public const string Contacted = "Contacted";
    public const string Converted = "Converted";
    public const string Junk = "Junk";

    public static readonly IReadOnlySet<string> All =
        new HashSet<string>(StringComparer.Ordinal) { New, Contacted, Converted, Junk };
}

/// <summary>One row per business: which plan it is on. Created on first use with a free trial.</summary>
public class Subscription
{
    public Guid TenantId { get; set; }
    public string Plan { get; set; } = "trial";
    public string Status { get; set; } = "trialing";
    public DateTime TrialEndsAt { get; set; }
    public DateTime? CurrentPeriodEnd { get; set; }
    /// <summary>"razorpay" or "manual" (set by the admin after a UPI/bank payment).</summary>
    public string? Provider { get; set; }
    public string? ProviderSubscriptionId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>Answers given per business per calendar month.</summary>
public class UsageCounter
{
    public Guid TenantId { get; set; }
    public string Period { get; set; } = default!;
    public int Answers { get; set; }
}

/// <summary>A website visitor's chat session with one bot.</summary>
public class Conversation
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid BotId { get; set; }
    public string? PageUrl { get; set; }
    public DateTime StartedAt { get; set; } = DateTime.UtcNow;
    public DateTime LastMessageAt { get; set; } = DateTime.UtcNow;
    public int MessageCount { get; set; }
    /// <summary>Questions the documents could not answer.</summary>
    public int UnansweredCount { get; set; }
    /// <summary>"web" (the widget) or a messaging app: whatsapp, instagram, messenger, telegram.</summary>
    public string Channel { get; set; } = "web";
    /// <summary>Messaging apps: the customer's name and number/handle.</summary>
    public string? ContactName { get; set; }
    public string? ContactId { get; set; }
    /// <summary>A person from the business is replying until then; the bot stays quiet (see Handover).</summary>
    public DateTime? HumanUntil { get; set; }
    public List<ConversationMessage> Messages { get; set; } = new();
}

public class ConversationMessage
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ConversationId { get; set; }
    public Guid TenantId { get; set; }
    public string Role { get; set; } = default!;   // "user" | "assistant" | "agent" (a person from the business)
    public string Text { get; set; } = default!;
    /// <summary>For questions: false when nothing in the documents matched.</summary>
    public bool Answered { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
