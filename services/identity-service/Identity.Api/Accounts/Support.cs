using System.Collections.Concurrent;

namespace Identity.Api.Accounts;

public record SupportRequest(string? Topic, string? Message);

public static class SupportRules
{
    public static readonly IReadOnlySet<string> Topics = new HashSet<string>
    {
        "Help setting up", "Billing and payment", "WhatsApp or other apps", "Something is not working", "Feature idea", "Other",
    };

    private const int PerHour = 5;
    private static readonly ConcurrentDictionary<Guid, Queue<DateTimeOffset>> Recent = new();

    /// <summary>At most 5 messages an hour per person, so the form cannot be used to flood the support inbox.</summary>
    public static bool TryTake(Guid userId, DateTimeOffset now)
    {
        var q = Recent.GetOrAdd(userId, _ => new Queue<DateTimeOffset>());
        lock (q)
        {
            while (q.Count > 0 && now - q.Peek() > TimeSpan.FromHours(1)) q.Dequeue();
            if (q.Count >= PerHour) return false;
            q.Enqueue(now);
            return true;
        }
    }
}
