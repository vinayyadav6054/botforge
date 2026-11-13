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
    public List<ConversationMessage> Messages { get; set; } = new();
}

public class ConversationMessage
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ConversationId { get; set; }
    public Guid TenantId { get; set; }
    public string Role { get; set; } = default!;   // "user" | "assistant"
    public string Text { get; set; } = default!;
    /// <summary>For questions: false when nothing in the documents matched.</summary>
    public bool Answered { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
