using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Bots.Api.Billing;
using Bots.Api.Data;
using Bots.Api.Messaging;
using Bots.Api.Storage;
using Bots.Api.Tenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Bots.Api;

public record CheckoutRequest(string? Plan);
public record SetPlanRequest(string? Plan, int? Months, int? TrialDays);

public static class KeyCheck
{
    public static bool Matches(string? provided, string? expected) =>
        !string.IsNullOrEmpty(expected) && provided is not null &&
        CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(provided), Encoding.UTF8.GetBytes(expected));

    public static bool HasInternalKey(HttpRequest r, IConfiguration c) =>
        Matches(r.Headers["X-Internal-Key"].ToString(), c["Internal:ApiKey"]);

    /// <summary>The platform owner's key for the admin page (Admin:ApiKey); admin routes are off without it.</summary>
    public static bool HasAdminKey(HttpRequest r, IConfiguration c) =>
        Matches(r.Headers["X-Admin-Key"].ToString(), c["Admin:ApiKey"]);
}

public static class AccountEndpoints
{
    public static object PlanDto(Plan p) => new
    {
        id = p.Id, name = p.Name, bots = p.Bots, documents = p.Documents,
        answersPerMonth = p.AnswersPerMonth, removeBranding = p.RemoveBranding, priceInr = p.PriceInr,
        websitePages = p.WebsitePages, messagingApps = p.MessagingApps
    };

    public static void MapAccountEndpoints(this WebApplication app)
    {
        var account = app.MapGroup("/account")
            .RequireAuthorization()
            .AddEndpointFilter(async (ctx, next) =>
            {
                var tenant = ctx.HttpContext.RequestServices.GetRequiredService<ITenantContext>();
                return tenant.TenantId == Guid.Empty ? Results.Forbid() : await next(ctx);
            });

        // plan, limits and this month's usage for the dashboard
        account.MapGet("/", async (ITenantContext tenant, SubscriptionService subs, AppDbContext db,
            IOptions<RazorpayOptions> razorpay) =>
        {
            var s = await subs.GetOrCreateAsync(tenant.TenantId);
            var plan = Plans.Effective(s, subs.Now);
            var o = razorpay.Value;
            return Results.Ok(new
            {
                plan = PlanDto(plan),
                subscription = new { plan = s.Plan, status = s.Status, trialEndsAt = s.TrialEndsAt, currentPeriodEnd = s.CurrentPeriodEnd, provider = s.Provider },
                usage = new
                {
                    period = Plans.Period(subs.Now),
                    answers = await subs.AnswersThisMonthAsync(tenant.TenantId),
                    bots = await db.Bots.CountAsync(),
                    documents = await db.Documents.CountAsync()
                },
                plans = Plans.Paid.Select(PlanDto),
                onlinePayment = Plans.Paid.Where(p => o.Enabled && o.PlanIdFor(p.Id) is not null).Select(p => p.Id)
            });
        });

        // start a Razorpay subscription; the dashboard sends the owner to the returned payment page
        account.MapPost("/checkout", async (CheckoutRequest req, ITenantContext tenant, SubscriptionService subs,
            IOptions<RazorpayOptions> razorpay, IRazorpayClient client, ILogger<Program> log) =>
        {
            var plan = Plans.FindPaid(req.Plan);
            if (plan is null) return Results.BadRequest(new { error = "Choose starter, business or pro." });
            var planId = razorpay.Value.Enabled ? razorpay.Value.PlanIdFor(plan.Id) : null;
            if (planId is null)
                return Results.Json(new { error = "Online payment is not set up yet. Please contact us to upgrade." }, statusCode: 503);

            await subs.GetOrCreateAsync(tenant.TenantId);
            try
            {
                var link = await client.CreateSubscriptionAsync(planId, tenant.TenantId, plan.Id);
                return Results.Ok(new { url = link.Url, subscriptionId = link.SubscriptionId });
            }
            catch (HttpRequestException ex)
            {
                log.LogError(ex, "Razorpay checkout failed");
                return Results.Json(new { error = "The payment service is not reachable. Please try again." }, statusCode: 502);
            }
        });

        // stop renewing; the plan keeps working until the paid period ends
        account.MapPost("/cancel", async (ITenantContext tenant, SubscriptionService subs, AppDbContext db,
            IRazorpayClient client, ILogger<Program> log) =>
        {
            var s = await subs.GetOrCreateAsync(tenant.TenantId);
            if (s.Status != SubscriptionStatus.Active) return Results.BadRequest(new { error = "There is no active subscription to cancel." });
            if (s.Provider == "razorpay" && s.ProviderSubscriptionId is { } id)
            {
                try { await client.CancelSubscriptionAsync(id, atCycleEnd: true); }
                catch (HttpRequestException ex)
                {
                    log.LogError(ex, "Razorpay cancel failed");
                    return Results.Json(new { error = "The payment service is not reachable. Please try again." }, statusCode: 502);
                }
            }
            s.Status = SubscriptionStatus.Cancelled;
            s.UpdatedAt = subs.Now;
            await db.SaveChangesAsync();
            return Results.Ok(new { status = s.Status, currentPeriodEnd = s.CurrentPeriodEnd });
        });

        // everything this service stores about the business, as one JSON file (data portability)
        account.MapGet("/export", async (ITenantContext tenant, AppDbContext db, SubscriptionService subs) =>
        {
            var s = await subs.GetOrCreateAsync(tenant.TenantId);
            var bots = await db.Bots.OrderBy(b => b.CreatedAt).ToListAsync();
            var docs = await db.Documents.OrderBy(d => d.CreatedAt).ToListAsync();
            var leads = await db.Leads.OrderBy(l => l.CreatedAt).ToListAsync();
            var conversations = await db.Conversations.Include(c => c.Messages).OrderBy(c => c.StartedAt).ToListAsync();
            var export = new
            {
                exportedAt = subs.Now,
                subscription = new { s.Plan, s.Status, s.TrialEndsAt, s.CurrentPeriodEnd },
                bots = bots.Select(b => new
                {
                    bot = BotDto.From(b),
                    documents = docs.Where(d => d.BotId == b.Id).Select(DocumentDto.From),
                    leads = leads.Where(l => l.BotId == b.Id).Select(LeadDto.From),
                    conversations = conversations.Where(c => c.BotId == b.Id).Select(c => new
                    {
                        c.Id, c.StartedAt, c.LastMessageAt, c.PageUrl,
                        messages = c.Messages.OrderBy(m => m.CreatedAt).Select(m => new { m.Role, m.Text, m.Answered, m.CreatedAt })
                    })
                })
            };
            var bytes = JsonSerializer.SerializeToUtf8Bytes(export, new JsonSerializerOptions(JsonSerializerDefaults.Web) { WriteIndented = true });
            return Results.File(bytes, "application/json", $"botforge-export-{subs.Now:yyyy-MM-dd}.json");
        });

        // ---------- Razorpay calls this; the signature proves it (no login) ----------
        app.MapPost("/billing/razorpay/webhook", async (HttpRequest request, AppDbContext db, SubscriptionService subs,
            IOptions<RazorpayOptions> razorpay, IRazorpayClient client, ILogger<Program> log) =>
        {
            using var reader = new StreamReader(request.Body, Encoding.UTF8);
            var body = await reader.ReadToEndAsync();
            if (!RazorpayWebhook.IsValidSignature(body, request.Headers["X-Razorpay-Signature"], razorpay.Value.WebhookSecret))
                return Results.Unauthorized();

            WebhookChange? change;
            try { change = RazorpayWebhook.Parse(body); }
            catch (JsonException) { return Results.BadRequest(); }
            if (change is null) return Results.Ok();   // events we do not need

            var s = await subs.GetOrCreateAsync(change.TenantId);
            var replaced = RazorpayWebhook.Apply(s, change, subs.Now);
            await db.SaveChangesAsync();
            log.LogInformation("Razorpay {Status} for tenant {Tenant}, plan {Plan}", s.Status, s.TenantId, s.Plan);

            if (replaced is not null)
            {
                // the owner switched plans: stop charging for the old subscription
                try { await client.CancelSubscriptionAsync(replaced, atCycleEnd: false); }
                catch (HttpRequestException ex) { log.LogWarning(ex, "Could not cancel replaced subscription {Id}", replaced); }
            }
            return Results.Ok();
        });

        // ---------- admin: the platform owner sets plans after manual payments (UPI, bank transfer) ----------
        var admin = app.MapGroup("/admin").AddEndpointFilter(async (ctx, next) =>
            KeyCheck.HasAdminKey(ctx.HttpContext.Request, ctx.HttpContext.RequestServices.GetRequiredService<IConfiguration>())
                ? await next(ctx) : Results.Unauthorized());

        admin.MapGet("/subscriptions", async (AppDbContext db, SubscriptionService subs) =>
        {
            var period = Plans.Period(subs.Now);
            var list = await db.Subscriptions.ToListAsync();
            var usage = await db.Usage.Where(u => u.Period == period).ToDictionaryAsync(u => u.TenantId, u => u.Answers);
            var bots = await db.Bots.IgnoreQueryFilters().GroupBy(b => b.TenantId)
                .Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count);
            return Results.Ok(list.Select(s => new
            {
                tenantId = s.TenantId, plan = s.Plan, status = s.Status, effectivePlan = Plans.Effective(s, subs.Now).Id,
                trialEndsAt = s.TrialEndsAt, currentPeriodEnd = s.CurrentPeriodEnd, provider = s.Provider,
                answersThisMonth = usage.GetValueOrDefault(s.TenantId), bots = bots.GetValueOrDefault(s.TenantId)
            }));
        });

        admin.MapPut("/subscriptions/{tenantId:guid}", async (Guid tenantId, SetPlanRequest req, AppDbContext db, SubscriptionService subs) =>
        {
            var s = await subs.GetOrCreateAsync(tenantId);
            var now = subs.Now;
            if (req.TrialDays is { } days)
            {
                if (days is < 1 or > 90) return Results.BadRequest(new { error = "trialDays must be 1-90." });
                s.Status = SubscriptionStatus.Trialing;
                s.Plan = Plans.Trial.Id;
                s.TrialEndsAt = now.AddDays(days);
            }
            else
            {
                var plan = Plans.FindPaid(req.Plan);
                var months = req.Months ?? 1;
                if (plan is null || months is < 1 or > 24)
                    return Results.BadRequest(new { error = "Send plan (starter, business, pro) and months (1-24), or trialDays." });
                // paying again before the end extends from the current end date
                var from = s.Status == SubscriptionStatus.Active && s.CurrentPeriodEnd > now ? s.CurrentPeriodEnd.Value : now;
                s.Plan = plan.Id;
                s.Status = SubscriptionStatus.Active;
                s.Provider = "manual";
                s.ProviderSubscriptionId = null;
                s.CurrentPeriodEnd = from.AddMonths(months);
            }
            s.UpdatedAt = now;
            await db.SaveChangesAsync();
            return Results.Ok(new { s.TenantId, s.Plan, s.Status, s.TrialEndsAt, s.CurrentPeriodEnd, effectivePlan = Plans.Effective(s, now).Id });
        });

        // ---------- internal ----------

        // the identity service deletes a whole account: remove everything this service holds for it
        app.MapDelete("/internal/tenants/{tenantId:guid}", async (Guid tenantId, HttpRequest request, IConfiguration config,
            AppDbContext db, IFileStorage storage, IEventPublisher publisher, IRazorpayClient client,
            IOptions<RazorpayOptions> razorpay, ILogger<Program> log) =>
        {
            if (!KeyCheck.HasInternalKey(request, config)) return Results.Unauthorized();

            var sub = await db.Subscriptions.FirstOrDefaultAsync(s => s.TenantId == tenantId);
            if (sub is { Provider: "razorpay", ProviderSubscriptionId: { } subId, Status: SubscriptionStatus.Active } && razorpay.Value.Enabled)
            {
                try { await client.CancelSubscriptionAsync(subId, atCycleEnd: false); }
                catch (HttpRequestException ex) { log.LogWarning(ex, "Could not cancel subscription {Id} of a deleted account", subId); }
            }

            var bots = await db.Bots.IgnoreQueryFilters().Where(b => b.TenantId == tenantId).Select(b => b.Id).ToListAsync();
            var keys = await db.Documents.IgnoreQueryFilters().Where(d => d.TenantId == tenantId).Select(d => d.StorageKey).ToListAsync();
            // documents, leads and conversations cascade with their bot
            await db.Bots.IgnoreQueryFilters().Where(b => b.TenantId == tenantId).ExecuteDeleteAsync();
            await db.Usage.Where(u => u.TenantId == tenantId).ExecuteDeleteAsync();
            await db.Subscriptions.Where(s => s.TenantId == tenantId).ExecuteDeleteAsync();

            foreach (var key in keys) await storage.DeleteAsync(key);
            foreach (var botId in bots)
            {
                try { await publisher.PublishAsync("bot.deleted", new BotDeleted(botId, tenantId)); }
                catch (Exception ex) { log.LogError(ex, "Could not publish bot.deleted for {Bot}", botId); }
            }
            return Results.NoContent();
        });

        // numbers for the monthly report emails (sent by the identity service, which knows the owners' addresses)
        app.MapGet("/internal/reports/monthly", async (string? period, HttpRequest request, IConfiguration config,
            AppDbContext db, SubscriptionService subs) =>
        {
            if (!KeyCheck.HasInternalKey(request, config)) return Results.Unauthorized();
            if (period is null || !DateTime.TryParseExact(period + "-01", "yyyy-MM-dd", null,
                    System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal, out var start))
                return Results.BadRequest(new { error = "period must look like 2026-10." });
            var end = start.AddMonths(1);

            var bots = await db.Bots.IgnoreQueryFilters().GroupBy(b => b.TenantId)
                .Select(g => new { TenantId = g.Key, Count = g.Count() }).ToListAsync();
            var answers = await db.Usage.Where(u => u.Period == period).ToDictionaryAsync(u => u.TenantId, u => u.Answers);
            var conversations = await db.Conversations.IgnoreQueryFilters()
                .Where(c => c.StartedAt >= start && c.StartedAt < end).GroupBy(c => c.TenantId)
                .Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count);
            var unanswered = await db.ConversationMessages.IgnoreQueryFilters()
                .Where(m => m.Role == "user" && !m.Answered && m.CreatedAt >= start && m.CreatedAt < end).GroupBy(m => m.TenantId)
                .Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count);
            var leads = await db.Leads.IgnoreQueryFilters()
                .Where(l => l.CreatedAt >= start && l.CreatedAt < end).GroupBy(l => l.TenantId)
                .Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count);

            var plans = await db.Subscriptions.ToDictionaryAsync(s => s.TenantId);
            return Results.Ok(bots.Select(b => new
            {
                tenantId = b.TenantId,
                bots = b.Count,
                plan = plans.TryGetValue(b.TenantId, out var s) ? Plans.Effective(s, subs.Now).Name : Plans.Trial.Name,
                answers = answers.GetValueOrDefault(b.TenantId),
                conversations = conversations.GetValueOrDefault(b.TenantId),
                unanswered = unanswered.GetValueOrDefault(b.TenantId),
                leads = leads.GetValueOrDefault(b.TenantId)
            }));
        });
    }
}
