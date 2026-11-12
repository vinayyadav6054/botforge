using Bots.Api;

namespace Bots.Tests.Unit;

[Trait("Level", "Unit")]
public class SuggestedQuestionsTests
{
    [Fact]
    public void Normalize_trims_drops_blanks_and_duplicates_keeping_order() =>
        Assert.Equal(new[] { "What are the fees?", "Batch timings?" },
            BotRules.NormalizeQuestions(new[] { "  What are the fees? ", "", "   ", null, "what are the FEES?", "Batch timings?" }));

    [Fact]
    public void Null_means_unchanged_and_is_valid() => Assert.Null(BotRules.ValidateQuestions(null));

    [Fact]
    public void Up_to_four_questions_are_allowed() =>
        Assert.Null(BotRules.ValidateQuestions(new() { "a", "b", "c", "d", " " }));

    [Fact]
    public void More_than_four_is_rejected() =>
        Assert.Equal("At most 4 suggested questions are allowed.",
            BotRules.ValidateQuestions(new() { "a", "b", "c", "d", "e" }));

    [Fact]
    public void Overlong_question_is_rejected() =>
        Assert.Equal("Each suggested question must be at most 120 characters.",
            BotRules.ValidateQuestions(new() { new string('q', 121) }));
}
