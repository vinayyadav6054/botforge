using System.Net.Mail;
using System.Text.RegularExpressions;

namespace Identity.Api.Auth;

public static partial class TenantRules
{
    public static bool IsValidEmail(string email) =>
        email.Length <= 256
        && MailAddress.TryCreate(email, out var parsed)
        && parsed.Address == email
        && email[(email.IndexOf('@') + 1)..].Contains('.');

    /// <summary>"Sunrise Bakery & Café!" becomes "sunrise-bakery-caf".</summary>
    public static string Slugify(string name)
    {
        var slug = NonAlphanumeric().Replace(name.ToLowerInvariant(), "-").Trim('-');
        if (slug.Length > 80) slug = slug[..80].TrimEnd('-');
        return slug.Length == 0 ? "tenant" : slug;
    }

    [GeneratedRegex("[^a-z0-9]+")]
    private static partial Regex NonAlphanumeric();
}
