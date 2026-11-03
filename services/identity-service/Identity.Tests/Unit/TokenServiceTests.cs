using System.IdentityModel.Tokens.Jwt;
using Identity.Api.Auth;
using Identity.Api.Data;
using Microsoft.Extensions.Options;

namespace Identity.Tests.Unit;

[Trait("Level", "Unit")]
public class TokenServiceTests
{
    private static readonly JwtOptions Options = new()
    {
        Issuer = "test-issuer",
        Audience = "test-audience",
        Key = new string('k', 48),
        ExpiryMinutes = 15
    };

    [Fact]
    public void Token_carries_user_tenant_and_role_claims()
    {
        var user = new User { TenantId = Guid.NewGuid(), Email = "owner@example.com", Role = "Owner" };
        var token = new TokenService(Microsoft.Extensions.Options.Options.Create(Options)).Create(user);

        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(token);
        Assert.Equal("test-issuer", jwt.Issuer);
        Assert.Contains("test-audience", jwt.Audiences);
        Assert.Equal(user.Id.ToString(), jwt.Subject);
        Assert.Equal(user.TenantId.ToString(), jwt.Claims.Single(c => c.Type == "tenant_id").Value);
        Assert.Equal("owner@example.com", jwt.Claims.Single(c => c.Type == "email").Value);
        Assert.Equal("Owner", jwt.Claims.Single(c => c.Type == "role").Value);
        Assert.Equal("HS256", jwt.Header.Alg);
    }

    [Fact]
    public void Token_expires_after_configured_minutes()
    {
        var user = new User { TenantId = Guid.NewGuid(), Email = "a@b.co" };
        var token = new TokenService(Microsoft.Extensions.Options.Options.Create(Options)).Create(user);
        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(token);

        var minutes = (jwt.ValidTo - DateTime.UtcNow).TotalMinutes;
        Assert.InRange(minutes, 14, 15.1);
    }
}
