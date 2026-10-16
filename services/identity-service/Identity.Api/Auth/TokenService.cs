using System.Security.Claims;
using System.Text;
using Identity.Api.Data;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Identity.Api.Auth;

public class TokenService(IOptions<JwtOptions> options)
{
    public string Create(User user)
    {
        var o = options.Value;
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(o.Key));

        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = o.Issuer,
            Audience = o.Audience,
            Expires = DateTime.UtcNow.AddMinutes(o.ExpiryMinutes),
            SigningCredentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256),
            Subject = new ClaimsIdentity(new[]
            {
                new Claim("sub", user.Id.ToString()),
                new Claim("email", user.Email),
                new Claim("tenant_id", user.TenantId.ToString()),
                new Claim("role", user.Role),
            })
        };

        return new JsonWebTokenHandler().CreateToken(descriptor);
    }
}