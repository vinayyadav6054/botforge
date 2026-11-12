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
