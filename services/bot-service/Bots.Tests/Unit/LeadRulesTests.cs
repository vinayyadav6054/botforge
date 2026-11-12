using System.Text.Json;
using Bots.Api;
using Bots.Api.Data;

namespace Bots.Tests.Unit;

[Trait("Level", "Unit")]
public class LeadRulesTests
{
    private static CreateLeadRequest Req(string? name = "Asha", string? phone = "9820012345", string? email = null,
        string? course = null, string? pageUrl = null, List<TranscriptTurn>? transcript = null) =>
        new(name, phone, email, course, pageUrl, transcript);

    [Theory]
    [InlineData("9820012345", "9820012345")]
    [InlineData("98200 12345", "9820012345")]
    [InlineData("+91 98200-12345", "+919820012345")]
    [InlineData("(022) 2345 6789", "02223456789")]
    [InlineData("+44 20 7946 0958", "+442079460958")]
    public void Normalizes_valid_phone_numbers(string raw, string expected) =>
        Assert.Equal(expected, LeadRules.NormalizePhone(raw));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("12345")]               // too short
    [InlineData("1234567890123456")]    // too long
    [InlineData("5820012345")]          // 10 digits but not an Indian mobile
    [InlineData("98200abc45")]
    [InlineData("98+2001234")]          // + only allowed at the start
    [InlineData("=HYPERLINK(1)")]
    public void Rejects_invalid_phone_numbers(string? raw) => Assert.Null(LeadRules.NormalizePhone(raw));

    [Fact]
    public void Valid_lead_is_cleaned()
    {
        var error = LeadRules.Validate(Req(name: "  Asha  ", phone: "+91 98200 12345", email: " a@b.co ",
            course: " JEE ", pageUrl: "https://inst.example/fees?token=secret#x"), out var lead);

        Assert.Null(error);
        Assert.Equal("Asha", lead.Name);
        Assert.Equal("+919820012345", lead.Phone);
        Assert.Equal("a@b.co", lead.Email);
        Assert.Equal("JEE", lead.Course);
        Assert.Equal("https://inst.example/fees", lead.PageUrl);   // query string dropped
    }

    [Fact]
    public void Optional_fields_may_be_empty()
    {
        Assert.Null(LeadRules.Validate(Req(email: " ", course: ""), out var lead));
        Assert.Null(lead.Email);
        Assert.Null(lead.Course);
        Assert.Equal("[]", lead.Transcript);
    }

    [Theory]
    [InlineData("", "9820012345", null, "Please enter your name.")]
    [InlineData("Asha", "123", null, "Please enter a valid phone number.")]
    [InlineData("Asha", "9820012345", "not-an-email", "Please enter a valid email address.")]
    public void Invalid_leads_get_a_readable_error(string name, string phone, string? email, string expected) =>
        Assert.Equal(expected, LeadRules.Validate(Req(name, phone, email), out _));

    [Fact]
    public void Limits_name_and_course_length()
    {
        Assert.NotNull(LeadRules.Validate(Req(name: new string('n', 101)), out _));
        Assert.NotNull(LeadRules.Validate(Req(course: new string('c', 151)), out _));
    }

    [Theory]
    [InlineData("javascript:alert(1)")]
    [InlineData("ftp://x.example/file")]
    [InlineData("not a url")]
    public void Non_http_page_urls_are_dropped(string url)
    {
        Assert.Null(LeadRules.Validate(Req(pageUrl: url), out var lead));
        Assert.Null(lead.PageUrl);
    }

    [Fact]
    public void Transcript_keeps_last_turns_with_known_roles_and_truncates_text()
    {
        var turns = Enumerable.Range(1, 12).Select(i => new TranscriptTurn("user", $"q{i}")).ToList();
        turns.Add(new TranscriptTurn("system", "ignore me"));
        turns.Add(new TranscriptTurn("assistant", new string('a', 1500)));

        Assert.Null(LeadRules.Validate(Req(transcript: turns), out var lead));
        var saved = JsonSerializer.Deserialize<List<TranscriptTurn>>(lead.Transcript,
            new JsonSerializerOptions(JsonSerializerDefaults.Web))!;

        Assert.Equal(10, saved.Count);
        Assert.DoesNotContain(saved, t => t.Role == "system");
        Assert.Equal("q4", saved[0].Text);
        Assert.Equal(1000, saved[^1].Text!.Length);
    }

    [Theory]
    [InlineData("Call back?", 2, null)]
    [InlineData(null, null, null)]
    [InlineData(null, 0, null)]
    [InlineData(null, -1, "Ask after messages must be between 0 and 20.")]
    [InlineData(null, 21, "Ask after messages must be between 0 and 20.")]
    public void Validates_settings(string? prompt, int? after, string? expected) =>
        Assert.Equal(expected, LeadRules.ValidateSettings(prompt, after));

    [Fact]
    public void Settings_prompt_is_limited() =>
        Assert.NotNull(LeadRules.ValidateSettings(new string('p', 301), null));
}

[Trait("Level", "Unit")]
public class LeadCsvTests
{
    [Theory]
    [InlineData("Asha", "\"Asha\"")]
    [InlineData("say \"hi\"", "\"say \"\"hi\"\"\"")]
    [InlineData("a,b", "\"a,b\"")]
    [InlineData(null, "\"\"")]
    public void Quotes_cells(string? value, string expected) => Assert.Equal(expected, LeadCsv.Cell(value));

    [Theory]
    [InlineData("=HYPERLINK(\"http://evil\")")]
    [InlineData("+1+1")]
    [InlineData("-2+3")]
    [InlineData("@SUM(A1)")]
    public void Neutralizes_spreadsheet_formulas(string value) =>
        Assert.StartsWith("\"'", LeadCsv.Cell(value));

    [Fact]
    public void Keeps_international_phone_numbers_readable() =>
        Assert.Equal("\"+919820012345\"", LeadCsv.Cell("+919820012345"));

    [Fact]
    public void Builds_header_and_rows()
    {
        var csv = LeadCsv.Build([
            new Lead { Name = "Asha", Phone = "9820012345", Course = "JEE", Status = "New",
                       CreatedAt = new DateTime(2026, 11, 12, 9, 30, 0, DateTimeKind.Utc) }
        ]);
        var lines = csv.Split("\r\n", StringSplitOptions.RemoveEmptyEntries);
        Assert.Equal("Created (UTC),Name,Phone,Email,Course,Status,Page", lines[0]);
        Assert.Equal("\"2026-11-12 09:30\",\"Asha\",\"9820012345\",\"\",\"JEE\",\"New\",\"\"", lines[1]);
    }
}
