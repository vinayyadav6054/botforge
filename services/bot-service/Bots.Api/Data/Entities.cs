namespace Bots.Api.Data;

public class Bot
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public string Name { get; set; } = default!;
    public string WelcomeMessage { get; set; } = "Hi! How can I help you today?";
    public string PublicKey { get; set; } = default!;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
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
}