using Bots.Api.Data;

namespace Bots.Api;

// lead fields are optional: null means "leave unchanged" on update
public record CreateBotRequest(string? Name, string? WelcomeMessage,
    bool? LeadCaptureEnabled = null, string? LeadPrompt = null, int? LeadAfterMessages = null,
    List<string>? SuggestedQuestions = null);

public record BotDto(Guid Id, string Name, string WelcomeMessage, string PublicKey, DateTime CreatedAt,
    bool LeadCaptureEnabled, string LeadPrompt, int LeadAfterMessages, List<string> SuggestedQuestions)
{
    public static BotDto From(Bot b) => new(b.Id, b.Name, b.WelcomeMessage, b.PublicKey, b.CreatedAt,
        b.LeadCaptureEnabled, b.LeadPrompt, b.LeadAfterMessages, b.SuggestedQuestions);
}

public record TranscriptTurn(string? Role, string? Text);

// sent by the chat service on behalf of a website visitor
public record CreateLeadRequest(string? Name, string? Phone, string? Email, string? Course,
    string? PageUrl, List<TranscriptTurn>? Transcript);

public record UpdateLeadRequest(string? Status);

public record LeadDto(Guid Id, Guid BotId, string Name, string Phone, string? Email, string? Course,
    string? PageUrl, string Transcript, string Status, DateTime CreatedAt)
{
    public static LeadDto From(Lead l) =>
        new(l.Id, l.BotId, l.Name, l.Phone, l.Email, l.Course, l.PageUrl, l.Transcript, l.Status, l.CreatedAt);
}

public record DocumentDto(Guid Id, Guid BotId, string FileName, string ContentType, long SizeBytes,
    string Status, int? ChunkCount, string? Error, DateTime CreatedAt)
{
    public static DocumentDto From(BotDocument d) =>
        new(d.Id, d.BotId, d.FileName, d.ContentType, d.SizeBytes, d.Status, d.ChunkCount, d.Error, d.CreatedAt);
}

public static class BotRules
{
    public const int MaxNameLength = 200;
    public const int MaxWelcomeLength = 500;

    public static string? Validate(string? name, string? welcomeMessage)
    {
        var n = (name ?? "").Trim();
        if (n.Length == 0) return "Name is required.";
        if (n.Length > MaxNameLength) return $"Name must be at most {MaxNameLength} characters.";
        if ((welcomeMessage ?? "").Trim().Length > MaxWelcomeLength)
            return $"Welcome message must be at most {MaxWelcomeLength} characters.";
        return null;
    }

    public const int MaxSuggestedQuestions = 4;
    public const int MaxQuestionLength = 120;

    public static string? ValidateQuestions(List<string>? questions)
    {
        if (questions is null) return null;
        var cleaned = NormalizeQuestions(questions);
        if (cleaned.Count > MaxSuggestedQuestions)
            return $"At most {MaxSuggestedQuestions} suggested questions are allowed.";
        if (cleaned.Any(q => q.Length > MaxQuestionLength))
            return $"Each suggested question must be at most {MaxQuestionLength} characters.";
        return null;
    }

    /// <summary>Trims, drops blanks and case-insensitive duplicates, keeps the owner's order.</summary>
    public static List<string> NormalizeQuestions(IEnumerable<string?> questions) =>
        questions.Select(q => (q ?? "").Trim())
            .Where(q => q.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
}

public static class DocumentRules
{
    public const long MaxFileBytes = 10 * 1024 * 1024;
    public const int MaxFileNameLength = 300;

    public static readonly IReadOnlySet<string> AllowedExtensions =
        new HashSet<string>(StringComparer.OrdinalIgnoreCase) { ".pdf", ".txt", ".md", ".docx" };

    // keep only the last path segment (browsers on Windows may send "C:\fakepath\x.pdf")
    // and shorten long names while keeping the extension
    public static string SafeFileName(string fileName)
    {
        var name = fileName.Replace('\\', '/');
        name = name[(name.LastIndexOf('/') + 1)..].Trim();
        if (name.Length == 0) name = "document";
        if (name.Length <= MaxFileNameLength) return name;
        var ext = Path.GetExtension(name);
        return name[..(MaxFileNameLength - ext.Length)] + ext;
    }

    public static string Truncate(string value, int max) => value.Length <= max ? value : value[..max];
}

public static class LeadRules
{
    public const string DefaultPrompt = "Would you like our team to call you back? Share your details below.";
    public const int DefaultAfterMessages = 2;
    public const int MaxPromptLength = 300;
    public const int MaxAfterMessages = 20;
    public const int MaxNameLength = 100;
    public const int MaxEmailLength = 200;
    public const int MaxCourseLength = 150;
    public const int MaxPageUrlLength = 500;
    public const int MaxTranscriptTurns = 10;
    public const int MaxTranscriptTurnChars = 1000;
    public static readonly TimeSpan DuplicateWindow = TimeSpan.FromHours(24);

    public static string? ValidateSettings(string? prompt, int? afterMessages)
    {
        if (prompt is not null && prompt.Trim().Length > MaxPromptLength)
            return $"Lead prompt must be at most {MaxPromptLength} characters.";
        if (afterMessages is < 0 or > MaxAfterMessages)
            return $"Ask after messages must be between 0 and {MaxAfterMessages}.";
        return null;
    }

    /// <summary>Digits with an optional leading +; null when it does not look like a phone number.
    /// Accepts spaces, dashes, dots and brackets. 10-digit Indian mobiles must start with 6-9.</summary>
    public static string? NormalizePhone(string? raw)
    {
        var s = (raw ?? "").Trim();
        if (s.Length is 0 or > 30) return null;
        var plus = s.StartsWith('+');
        var digits = new string(s.Where(char.IsAsciiDigit).ToArray());
        if (s.Any(c => !char.IsAsciiDigit(c) && " -.()+".IndexOf(c) < 0)) return null;
        if (s.LastIndexOf('+') > 0) return null;
        if (digits.Length is < 8 or > 15) return null;
        if (!plus && digits.Length == 10 && digits[0] is < '6') return null;   // not an Indian mobile
        return plus ? "+" + digits : digits;
    }

    public static bool IsValidEmail(string email) =>
        email.Length <= MaxEmailLength &&
        System.Text.RegularExpressions.Regex.IsMatch(email, @"^[^@\s]+@[^@\s]+\.[^@\s]+$");

    /// <summary>Validates and cleans a lead. Returns an error message, or null and the cleaned values.</summary>
    /// <summary>Keeps http(s) URLs without the query string (it may hold tokens); anything else becomes null.</summary>
    public static string? CleanPageUrl(string? raw) =>
        Uri.TryCreate(raw?.Trim(), UriKind.Absolute, out var uri) &&
        (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp)
            ? DocumentRules.Truncate(uri.GetLeftPart(UriPartial.Path), MaxPageUrlLength)
            : null;

    public static string? Validate(CreateLeadRequest req, out Lead cleaned)
    {
        cleaned = new Lead();
        var name = (req.Name ?? "").Trim();
        if (name.Length == 0) return "Please enter your name.";
        if (name.Length > MaxNameLength) return $"Name must be at most {MaxNameLength} characters.";

        var phone = NormalizePhone(req.Phone);
        if (phone is null) return "Please enter a valid phone number.";

        var email = string.IsNullOrWhiteSpace(req.Email) ? null : req.Email.Trim();
        if (email is not null && !IsValidEmail(email)) return "Please enter a valid email address.";

        var course = string.IsNullOrWhiteSpace(req.Course) ? null : req.Course.Trim();
        if (course is not null && course.Length > MaxCourseLength)
            return $"Course must be at most {MaxCourseLength} characters.";

        // page URL is informational only: keep http(s) URLs, silently drop anything else
        var pageUrl = CleanPageUrl(req.PageUrl);

        var turns = (req.Transcript ?? [])
            .Where(t => (t.Role == "user" || t.Role == "assistant") && !string.IsNullOrWhiteSpace(t.Text))
            .TakeLast(MaxTranscriptTurns)
            .Select(t => new { role = t.Role, text = DocumentRules.Truncate(t.Text!.Trim(), MaxTranscriptTurnChars) });

        cleaned = new Lead
        {
            Name = name,
            Phone = phone,
            Email = email,
            Course = course,
            PageUrl = pageUrl,
            Transcript = System.Text.Json.JsonSerializer.Serialize(turns)
        };
        return null;
    }
}

public static class LeadCsv
{
    public static string Build(IEnumerable<Lead> leads)
    {
        var sb = new System.Text.StringBuilder();
        sb.Append("Created (UTC),Name,Phone,Email,Course,Status,Page\r\n");
        foreach (var l in leads)
        {
            sb.Append(string.Join(",",
                Cell(l.CreatedAt.ToString("yyyy-MM-dd HH:mm")), Cell(l.Name), Cell(l.Phone), Cell(l.Email),
                Cell(l.Course), Cell(l.Status), Cell(l.PageUrl)));
            sb.Append("\r\n");
        }
        return sb.ToString();
    }

    /// <summary>RFC 4180 quoting, plus a leading ' on values a spreadsheet would run as a formula.</summary>
    public static string Cell(string? value)
    {
        var v = value ?? "";
        if (v.Length > 0 && "=+-@\t\r".IndexOf(v[0]) >= 0 && !IsPhoneLike(v)) v = "'" + v;
        return "\"" + v.Replace("\"", "\"\"") + "\"";
    }

    // "+9198..." is a phone number, not a formula; keep it readable
    private static bool IsPhoneLike(string v) => v[0] == '+' && v.Skip(1).All(char.IsAsciiDigit);
}
