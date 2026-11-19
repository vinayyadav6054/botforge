using System.Security.Cryptography;
using System.Text;
using Bots.Api.Billing;
using Bots.Api.Data;

namespace Bots.Tests.Unit;

[Trait("Level", "Unit")]
public class PlansTests
{
    private static readonly DateTime Now = new(2026, 11, 13, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void Trial_runs_until_its_end_date()
    {
        var s = new Subscription { Status = SubscriptionStatus.Trialing, TrialEndsAt = Now.AddDays(1) };
        Assert.Equal(Plans.Trial, Plans.Effective(s, Now));
        Assert.Equal(Plans.Expired, Plans.Effective(s, Now.AddDays(2)));
    }

    [Fact]
    public void Active_plan_gets_grace_days_after_a_missed_renewal()
    {
        var s = new Subscription { Status = SubscriptionStatus.Active, Plan = "pro", CurrentPeriodEnd = Now };
        Assert.Equal(Plans.Pro, Plans.Effective(s, Now.AddDays(2)));
        Assert.Equal(Plans.Expired, Plans.Effective(s, Now.AddDays(4)));
    }

    [Theory]
    [InlineData(SubscriptionStatus.Cancelled)]
    [InlineData(SubscriptionStatus.Halted)]
    public void Cancelled_or_halted_plans_end_with_the_paid_period(string status)
    {
        var s = new Subscription { Status = status, Plan = "starter", CurrentPeriodEnd = Now.AddDays(5) };
        Assert.Equal(Plans.Starter, Plans.Effective(s, Now));
        Assert.Equal(Plans.Expired, Plans.Effective(s, Now.AddDays(5).AddMinutes(1)));
    }

    [Fact]
    public void Unknown_plan_ids_never_unlock_anything()
    {
        var s = new Subscription { Status = SubscriptionStatus.Active, Plan = "platinum", CurrentPeriodEnd = Now.AddDays(30) };
        Assert.Equal(Plans.Expired, Plans.Effective(s, Now));
    }

    [Fact]
    public void Paid_plans_match_the_website_prices()
    {
        Assert.Equal([999, 2499, 5999], Plans.Paid.Select(p => p.PriceInr));
        Assert.Equal([599, 1499, 3599], Plans.Paid.Select(p => p.FoundingPriceInr));
        // founding price is 40% off, rounded to end in 99
        Assert.All(Plans.Paid, p => Assert.InRange(p.FoundingPriceInr, p.PriceInr * 0.6 - 5, p.PriceInr * 0.6 + 5));
        Assert.All(Plans.Paid, p => Assert.True(p.AnswersPerMonth > 0 && p.Bots > 0));
        Assert.False(Plans.Starter.RemoveBranding);
        Assert.True(Plans.Business.RemoveBranding);
    }

    [Fact]
    public void Webhook_signature_is_checked()
    {
        const string body = """{"event":"subscription.charged"}""";
        var sig = Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes("secret"), Encoding.UTF8.GetBytes(body)));
        Assert.True(RazorpayWebhook.IsValidSignature(body, sig.ToLowerInvariant(), "secret"));
        Assert.False(RazorpayWebhook.IsValidSignature(body, sig, "other"));
        Assert.False(RazorpayWebhook.IsValidSignature(body, "not-hex", "secret"));
        Assert.False(RazorpayWebhook.IsValidSignature(body, sig, null));   // no secret configured: reject everything
    }

    [Fact]
    public void Webhook_events_without_a_known_business_are_ignored()
    {
        Assert.Null(RazorpayWebhook.Parse("""{"event":"payment.captured","payload":{}}"""));
        Assert.Null(RazorpayWebhook.Parse("""{"event":"subscription.charged","payload":{"subscription":{"entity":{"id":"sub_1","notes":{}}}}}"""));
    }

    [Fact]
    public void A_new_subscription_replaces_the_old_one_and_reports_it_for_cancelling()
    {
        var tenant = Guid.NewGuid();
        var s = new Subscription { TenantId = tenant, Status = SubscriptionStatus.Active, Plan = "starter", Provider = "razorpay", ProviderSubscriptionId = "sub_old", CurrentPeriodEnd = Now };
        var replaced = RazorpayWebhook.Apply(s, new WebhookChange(tenant, "sub_new", SubscriptionStatus.Active, "business", Now.AddDays(30)), Now);
        Assert.Equal("sub_old", replaced);
        Assert.Equal("business", s.Plan);
        Assert.Equal("sub_new", s.ProviderSubscriptionId);
    }
}
