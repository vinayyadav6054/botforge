using Identity.Api.Data;
using Microsoft.AspNetCore.Identity;

namespace Identity.Api.Auth;

/// <summary>Brute-force protection for password logins (on top of the gateway's per-IP limit).</summary>
public static class LoginRules
{
    public const int MaxFailures = 5;
    public static readonly TimeSpan LockFor = TimeSpan.FromMinutes(15);

    public static readonly User Dummy = new() { Email = "nobody@invalid", PasswordHash = "" };
    private static string? _dummyHash;

    /// <summary>A real hash to verify against when the email is unknown, so both cases take the same time.</summary>
    public static string DummyHash(IPasswordHasher<User> hasher) => _dummyHash ??= hasher.HashPassword(Dummy, Guid.NewGuid().ToString("N"));
}
