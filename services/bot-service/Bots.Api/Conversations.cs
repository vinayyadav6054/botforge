using Bots.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Bots.Api;

/// <summary>One question and its answer, sent by the chat service after it answered a visitor.</summary>
public record RecordTurnRequest(Guid? ConversationId, string? Question, string? Answer, bool Answered = true, string? PageUrl = null);

public record ConversationSummaryDto(Guid Id, DateTime StartedAt, DateTime LastMessageAt, int MessageCount,
    int UnansweredCount, string? FirstQuestion, string? PageUrl);

public record ConversationMessageDto(string Role, string Text, bool Answered, DateTime CreatedAt);

public record ConversationDto(Guid Id, DateTime StartedAt, DateTime LastMessageAt, string? PageUrl,
    List<ConversationMessageDto> Messages);

public static class ConversationRules
{
    public const int MaxQuestionChars = 1000;
    public const int MaxAnswerChars = 4000;
    /// <summary>Stops one endless session (or a script) from filling the database.</summary>
    public const int MaxMessagesPerConversation = 200;

    public static string? Validate(RecordTurnRequest req)
    {
        if (req.ConversationId is null || req.ConversationId == Guid.Empty) return "conversationId is required.";
        if (string.IsNullOrWhiteSpace(req.Question)) return "question is required.";
        if (req.Answer is null) return "answer is required.";
        return null;
    }
}

/// <summary>Deletes visitor conversations after the retention period (Retention:ConversationDays, default 180).</summary>
public class ConversationCleanup(IServiceScopeFactory scopes, IConfiguration config, TimeProvider clock,
    ILogger<ConversationCleanup> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var days = config.GetValue("Retention:ConversationDays", 180);
        if (days <= 0) return;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = scopes.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var cutoff = clock.GetUtcNow().UtcDateTime.AddDays(-days);
                var removed = await db.Conversations.IgnoreQueryFilters()
                    .Where(c => c.LastMessageAt < cutoff).ExecuteDeleteAsync(stoppingToken);
                if (removed > 0) log.LogInformation("Deleted {Count} conversations older than {Days} days", removed, days);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogWarning(ex, "Conversation cleanup failed; retrying later");
            }
            await Task.Delay(TimeSpan.FromHours(6), stoppingToken);
        }
    }
}
