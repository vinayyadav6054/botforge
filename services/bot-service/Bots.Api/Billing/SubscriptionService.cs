using Bots.Api.Data;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Bots.Api.Billing;

public class SubscriptionService(AppDbContext db, TimeProvider clock)
{
    public DateTime Now => clock.GetUtcNow().UtcDateTime;

    /// <summary>The business's subscription; the first call starts the free trial.</summary>
    public async Task<Subscription> GetOrCreateAsync(Guid tenantId, CancellationToken ct = default)
    {
        var existing = await db.Subscriptions.FirstOrDefaultAsync(s => s.TenantId == tenantId, ct);
        if (existing is not null) return existing;

        var now = Now;
        var created = new Subscription
        {
            TenantId = tenantId,
            Plan = Plans.Trial.Id,
            Status = SubscriptionStatus.Trialing,
            TrialEndsAt = now.AddDays(Plans.TrialDays),
            CreatedAt = now,
            UpdatedAt = now
        };
        db.Subscriptions.Add(created);
        try
        {
            await db.SaveChangesAsync(ct);
            return created;
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            // two first requests at the same time: the other one created it
            db.Entry(created).State = EntityState.Detached;
            return await db.Subscriptions.FirstAsync(s => s.TenantId == tenantId, ct);
        }
    }

    public async Task<Plan> EffectivePlanAsync(Guid tenantId, CancellationToken ct = default) =>
        Plans.Effective(await GetOrCreateAsync(tenantId, ct), Now);

    public async Task<int> AnswersThisMonthAsync(Guid tenantId, CancellationToken ct = default)
    {
        var period = Plans.Period(Now);
        return await db.Usage.Where(u => u.TenantId == tenantId && u.Period == period)
            .Select(u => u.Answers).FirstOrDefaultAsync(ct);
    }

    /// <summary>Counts one answer if the monthly limit allows it (atomic, safe under concurrency).</summary>
    public async Task<bool> TryConsumeAnswerAsync(Guid tenantId, int limit, CancellationToken ct = default)
    {
        if (limit <= 0) return false;
        var period = Plans.Period(Now);
        var rows = await db.Database.SqlQuery<int>($"""
            INSERT INTO bots.usage_counters (tenant_id, period, answers) VALUES ({tenantId}, {period}, 1)
            ON CONFLICT (tenant_id, period) DO UPDATE SET answers = usage_counters.answers + 1
            WHERE usage_counters.answers < {limit}
            RETURNING answers AS "Value"
            """).ToListAsync(ct);
        return rows.Count == 1;
    }

    /// <summary>Gives back an answer that was counted but failed (e.g. the AI provider timed out).</summary>
    public async Task RefundAnswerAsync(Guid tenantId, CancellationToken ct = default)
    {
        var period = Plans.Period(Now);
        await db.Usage.Where(u => u.TenantId == tenantId && u.Period == period && u.Answers > 0)
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.Answers, u => u.Answers - 1), ct);
    }

    /// <summary>Null when allowed, otherwise the message for the owner (HTTP 402).</summary>
    public async Task<string?> CheckBotLimitAsync(Guid tenantId, CancellationToken ct = default)
    {
        var plan = await EffectivePlanAsync(tenantId, ct);
        if (plan.Bots == 0) return InactiveMessage;
        var count = await db.Bots.IgnoreQueryFilters().CountAsync(b => b.TenantId == tenantId, ct);
        return count >= plan.Bots
            ? $"Your {plan.Name} plan includes {plan.Bots} bot{(plan.Bots == 1 ? "" : "s")}. Upgrade your plan to add more."
            : null;
    }

    public async Task<string?> CheckDocumentLimitAsync(Guid tenantId, CancellationToken ct = default)
    {
        var plan = await EffectivePlanAsync(tenantId, ct);
        if (plan.Documents == 0) return InactiveMessage;
        var count = await db.Documents.IgnoreQueryFilters().CountAsync(d => d.TenantId == tenantId, ct);
        return count >= plan.Documents
            ? $"Your {plan.Name} plan includes {plan.Documents} documents. Delete old ones or upgrade your plan."
            : null;
    }

    public const string InactiveMessage = "Your free trial or plan has ended. Choose a plan to continue.";
}
