using Bots.Api;

namespace Bots.Tests.Unit;

[Trait("Level", "Unit")]
public class BotRulesTests
{
    [Theory]
    [InlineData("Support Bot", null)]
    [InlineData("  Support Bot  ", "")]
    [InlineData("Bot", "Hello!")]
    public void Accepts_valid_input(string name, string? welcome) => Assert.Null(BotRules.Validate(name, welcome));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Requires_a_name(string? name) => Assert.Equal("Name is required.", BotRules.Validate(name, null));

    [Fact]
    public void Limits_name_and_welcome_length()
    {
        Assert.NotNull(BotRules.Validate(new string('n', 201), null));
        Assert.Null(BotRules.Validate(new string('n', 200), null));
        Assert.NotNull(BotRules.Validate("ok", new string('w', 501)));
        Assert.Null(BotRules.Validate("ok", new string('w', 500)));
    }
}

[Trait("Level", "Unit")]
public class DocumentRulesTests
{
    [Theory]
    [InlineData("faq.pdf", "faq.pdf")]
    [InlineData(@"C:\fakepath\menu.docx", "menu.docx")]
    [InlineData("../../etc/passwd.txt", "passwd.txt")]
    [InlineData("  notes.md ", "notes.md")]
    [InlineData("", "document")]
    [InlineData("folder/", "document")]
    public void SafeFileName_keeps_only_the_name(string input, string expected) =>
        Assert.Equal(expected, DocumentRules.SafeFileName(input));

    [Fact]
    public void SafeFileName_shortens_long_names_but_keeps_extension()
    {
        var name = DocumentRules.SafeFileName(new string('a', 400) + ".pdf");
        Assert.Equal(DocumentRules.MaxFileNameLength, name.Length);
        Assert.EndsWith(".pdf", name);
    }

    [Theory]
    [InlineData(".pdf", true)]
    [InlineData(".PDF", true)]
    [InlineData(".docx", true)]
    [InlineData(".md", true)]
    [InlineData(".txt", true)]
    [InlineData(".exe", false)]
    [InlineData(".html", false)]
    [InlineData("", false)]
    public void Only_document_types_are_allowed(string ext, bool allowed) =>
        Assert.Equal(allowed, DocumentRules.AllowedExtensions.Contains(ext));

    [Fact]
    public void Truncate_cuts_long_values() =>
        Assert.Equal("abc", DocumentRules.Truncate("abcdef", 3));
}
