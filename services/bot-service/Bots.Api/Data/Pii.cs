using System.Security.Cryptography;
using System.Text;

namespace Bots.Api.Data;

/// <summary>
/// Field-level encryption for visitors' personal data (lead name, phone, email, transcript): AES-256-GCM with a key
/// derived from Jwt:Key (HKDF, its own purpose label), stored as "enc1:" + base64(nonce | tag | ciphertext).
/// A database copy alone does not reveal who enquired. Duplicate checks use a keyed hash of the phone (PhoneHash),
/// never the number itself. Values without the prefix (rows from before encryption) are read as they are.
/// </summary>
public static class Pii
{
    private const string Prefix = "enc1:";
    private static byte[]? _key;
    private static byte[]? _lookupKey;

    public static void Configure(string secret)
    {
        if (string.IsNullOrEmpty(secret) || secret.Length < 32) throw new InvalidOperationException("Jwt:Key must be at least 32 characters.");
        var ikm = Encoding.UTF8.GetBytes(secret);
        var salt = Encoding.UTF8.GetBytes("kahiye-pii");
        _key = HKDF.DeriveKey(HashAlgorithmName.SHA256, ikm, 32, salt, Encoding.UTF8.GetBytes("lead-fields-v1"));
        _lookupKey = HKDF.DeriveKey(HashAlgorithmName.SHA256, ikm, 32, salt, Encoding.UTF8.GetBytes("lead-lookup-v1"));
    }

    private static byte[] Key => _key ?? throw new InvalidOperationException("Pii.Configure was not called.");

    public static bool IsProtected(string? value) => value is not null && value.StartsWith(Prefix, StringComparison.Ordinal);

    public static string Protect(string value)
    {
        if (IsProtected(value)) return value;
        var plain = Encoding.UTF8.GetBytes(value);
        var nonce = RandomNumberGenerator.GetBytes(12);
        var tag = new byte[16];
        var cipher = new byte[plain.Length];
        using (var aes = new AesGcm(Key, 16)) aes.Encrypt(nonce, plain, cipher, tag);
        return Prefix + Convert.ToBase64String([.. nonce, .. tag, .. cipher]);
    }

    public static string Unprotect(string value)
    {
        if (!IsProtected(value)) return value;
        var all = Convert.FromBase64String(value[Prefix.Length..]);
        var plain = new byte[all.Length - 28];
        using (var aes = new AesGcm(Key, 16)) aes.Decrypt(all.AsSpan(0, 12), all.AsSpan(28), all.AsSpan(12, 16), plain);
        return Encoding.UTF8.GetString(plain);
    }

    /// <summary>Stable keyed fingerprint of a normalised phone number, for "same person submitted twice" checks.</summary>
    public static string Lookup(string normalizedPhone) =>
        Convert.ToHexString(HMACSHA256.HashData(_lookupKey ?? throw new InvalidOperationException("Pii.Configure was not called."),
            Encoding.UTF8.GetBytes(normalizedPhone))).ToLowerInvariant();
}
