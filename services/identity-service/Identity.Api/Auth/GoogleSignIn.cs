using System.Security.Cryptography;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;

namespace Identity.Api.Auth;

public record GoogleIdentity(string Subject, string Email, bool EmailVerified, string? Name);

public record GoogleSignInRequest(string? Credential, string? TenantName);

/// <summary>Checks a "Sign in with Google" ID token (from Google Identity Services in the browser).</summary>
public interface IGoogleTokenValidator
{
    bool Enabled { get; }
    Task<GoogleIdentity?> ValidateAsync(string credential, CancellationToken ct);
}

/// <summary>
/// Validates the token's signature with Google's published keys (cached and refreshed by the OpenID Connect
/// configuration manager), the issuer, the audience (our OAuth client id, Google:ClientId) and the expiry.
/// </summary>
public class GoogleTokenValidator(IConfiguration config, ILogger<GoogleTokenValidator> log) : IGoogleTokenValidator
{
    private static readonly ConfigurationManager<OpenIdConnectConfiguration> Discovery = new(
        "https://accounts.google.com/.well-known/openid-configuration", new OpenIdConnectConfigurationRetriever(),
        new HttpDocumentRetriever { RequireHttps = true });

    private string? ClientId => config["Google:ClientId"];
    public bool Enabled => !string.IsNullOrWhiteSpace(ClientId);

    public async Task<GoogleIdentity?> ValidateAsync(string credential, CancellationToken ct)
    {
        if (!Enabled || string.IsNullOrWhiteSpace(credential) || credential.Length > 4096) return null;
        try
        {
            var google = await Discovery.GetConfigurationAsync(ct);
            var result = await new JsonWebTokenHandler().ValidateTokenAsync(credential, new TokenValidationParameters
            {
                ValidIssuers = ["https://accounts.google.com", "accounts.google.com"],
                ValidAudience = ClientId,
                IssuerSigningKeys = google.SigningKeys,
                ValidateLifetime = true,
                ClockSkew = TimeSpan.FromMinutes(2),
            });
            if (!result.IsValid) return null;
            var c = result.Claims;
            var email = c.TryGetValue("email", out var e) ? e?.ToString() : null;
            var sub = c.TryGetValue("sub", out var s) ? s?.ToString() : null;
            if (string.IsNullOrEmpty(email) || string.IsNullOrEmpty(sub)) return null;
            var verified = c.TryGetValue("email_verified", out var v) && (v is true || string.Equals(v?.ToString(), "true", StringComparison.OrdinalIgnoreCase));
            return new GoogleIdentity(sub, email.Trim().ToLowerInvariant(), verified, c.TryGetValue("name", out var n) ? n?.ToString() : null);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning("Google sign-in token rejected: {Reason}", ex.Message);
            return null;
        }
    }

    /// <summary>A password nobody knows, for accounts created with Google (they can set one with "forgot password").</summary>
    public static string UnusablePassword() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
}
