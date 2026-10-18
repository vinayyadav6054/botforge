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