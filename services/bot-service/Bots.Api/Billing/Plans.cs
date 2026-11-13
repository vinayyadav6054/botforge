using Bots.Api.Data;

namespace Bots.Api.Billing;

/// <summary>What a plan allows. Keep in sync with the prices on the website (apps/dashboard/lib/site.ts).</summary>
public record Plan(string Id, string Name, int Bots, int Documents, int AnswersPerMonth, bool RemoveBranding, int PriceInr);

public static class Plans
{
    public static readonly Plan Trial = new("trial", "Free trial", 3, 20, 300, false, 0);
    public static readonly Plan Starter = new("starter", "Starter", 1, 10, 500, false, 499);
    public static readonly Plan Business = new("business", "Business", 3, 50, 3000, true, 1499);
    public static readonly Plan Pro = new("pro", "Pro", 10, 200, 15000, true, 3999);
    /// <summary>Trial over or subscription ended: data stays, but the bots stop answering.</summary>
    public static readonly Plan Expired = new("expired", "No active plan", 0, 0, 0, false, 0);

    public static readonly IReadOnlyList<Plan> Paid = [Starter, Business, Pro];

    public const int TrialDays = 14;
    /// <summary>Extra days after a missed renewal while the payment provider retries.</summary>
    public static readonly TimeSpan Grace = TimeSpan.FromDays(3);

    public static Plan? FindPaid(string? id) =>
        Paid.FirstOrDefault(p => string.Equals(p.Id, id, StringComparison.OrdinalIgnoreCase));

    /// <summary>The plan whose limits apply right now.</summary>
    public static Plan Effective(Subscription s, DateTime now)
    {
        if (s.Status == SubscriptionStatus.Trialing)
            return now < s.TrialEndsAt ? Trial : Expired;

        var paid = FindPaid(s.Plan);
        if (paid is null || s.CurrentPeriodEnd is not { } end) return Expired;
        var until = s.Status == SubscriptionStatus.Active ? end + Grace : end;
        return now < until ? paid : Expired;
    }

    /// <summary>Usage is counted per calendar month (UTC), e.g. "2026-11".</summary>
    public static string Period(DateTime now) => now.ToString("yyyy-MM");
}

public static class SubscriptionStatus
{
    public const string Trialing = "trialing";
    public const string Active = "active";
    /// <summary>Renewal payments failed; the plan runs until the paid period ends.</summary>
    public const string Halted = "halted";
    /// <summary>Cancelled by the owner; the plan runs until the paid period ends.</summary>
    public const string Cancelled = "cancelled";
}
