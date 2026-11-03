using Identity.Api.Auth;

namespace Identity.Tests.Unit;

[Trait("Level", "Unit")]
public class TenantRulesTests
{
    [Theory]
    [InlineData("owner@bakery.com")]
    [InlineData("a.b+tag@sub.example.co.uk")]
    public void Accepts_valid_emails(string email) => Assert.True(TenantRules.IsValidEmail(email));

    [Theory]
    [InlineData("")]
    [InlineData("no-at-sign")]
    [InlineData("user@localhost")]
    [InlineData("Display Name <user@example.com>")]
    [InlineData("two@@example.com")]
    public void Rejects_invalid_emails(string email) => Assert.False(TenantRules.IsValidEmail(email));

    [Fact]
    public void Rejects_overlong_email() =>
        Assert.False(TenantRules.IsValidEmail(new string('a', 251) + "@x.com"));

    [Theory]
    [InlineData("Sunrise Bakery", "sunrise-bakery")]
    [InlineData("  Café & Co!!  ", "caf-co")]
    [InlineData("ACME---Corp", "acme-corp")]
    [InlineData("!!!", "tenant")]
    [InlineData("日本", "tenant")]
    public void Slugify_produces_url_safe_slugs(string name, string expected) =>
        Assert.Equal(expected, TenantRules.Slugify(name));

    [Fact]
    public void Slugify_limits_length_without_trailing_dash()
    {
        var slug = TenantRules.Slugify(new string('a', 79) + " b" + new string('c', 50));
        Assert.True(slug.Length <= 80);
        Assert.False(slug.EndsWith('-'));
    }
}
