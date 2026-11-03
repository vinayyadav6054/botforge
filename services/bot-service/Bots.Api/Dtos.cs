using Bots.Api.Data;

namespace Bots.Api;

public record CreateBotRequest(string? Name, string? WelcomeMessage);

public record BotDto(Guid Id, string Name, string WelcomeMessage, string PublicKey, DateTime CreatedAt)
{
    public static BotDto From(Bot b) => new(b.Id, b.Name, b.WelcomeMessage, b.PublicKey, b.CreatedAt);
}

public record DocumentDto(Guid Id, Guid BotId, string FileName, string ContentType, long SizeBytes,
    string Status, int? ChunkCount, string? Error, DateTime CreatedAt)
{
    public static DocumentDto From(BotDocument d) =>
        new(d.Id, d.BotId, d.FileName, d.ContentType, d.SizeBytes, d.Status, d.ChunkCount, d.Error, d.CreatedAt);
}

public static class BotRules
{
    public const int MaxNameLength = 200;
    public const int MaxWelcomeLength = 500;

    public static string? Validate(string? name, string? welcomeMessage)
    {
        var n = (name ?? "").Trim();
        if (n.Length == 0) return "Name is required.";
        if (n.Length > MaxNameLength) return $"Name must be at most {MaxNameLength} characters.";
        if ((welcomeMessage ?? "").Trim().Length > MaxWelcomeLength)
            return $"Welcome message must be at most {MaxWelcomeLength} characters.";
        return null;
    }
}

public static class DocumentRules
{
    public const long MaxFileBytes = 10 * 1024 * 1024;
    public const int MaxFileNameLength = 300;

    public static readonly IReadOnlySet<string> AllowedExtensions =
        new HashSet<string>(StringComparer.OrdinalIgnoreCase) { ".pdf", ".txt", ".md", ".docx" };

    // keep only the last path segment (browsers on Windows may send "C:\fakepath\x.pdf")
    // and shorten long names while keeping the extension
    public static string SafeFileName(string fileName)
    {
        var name = fileName.Replace('\\', '/');
        name = name[(name.LastIndexOf('/') + 1)..].Trim();
        if (name.Length == 0) name = "document";
        if (name.Length <= MaxFileNameLength) return name;
        var ext = Path.GetExtension(name);
        return name[..(MaxFileNameLength - ext.Length)] + ext;
    }

    public static string Truncate(string value, int max) => value.Length <= max ? value : value[..max];
}
