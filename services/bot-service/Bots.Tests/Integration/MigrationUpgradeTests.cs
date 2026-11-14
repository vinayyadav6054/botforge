using Bots.Api.Data;
using Bots.Api.Tenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace Bots.Tests.Integration;

/// <summary>
/// Upgrading a database that already has bots and documents: new columns must get the same defaults new rows get
/// (a fresh test database never has old rows, so the other tests cannot catch this).
/// </summary>
[Trait("Level", "Integration")]
public class MigrationUpgradeTests
{
    private sealed class NoTenant : ITenantContext
    {
        public Guid TenantId => Guid.Empty;
    }

    [Fact]
    public async Task Existing_bots_and_documents_get_working_defaults()
    {
        var connection = TestDatabase.Recreate("botforge_test_bots_upgrade");
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql(connection, n => n.MigrationsHistoryTable("__EFMigrationsHistory", "bots"))
            .UseSnakeCaseNamingConvention().Options;
        await using var db = new AppDbContext(options, new NoTenant());
        var migrator = db.GetService<IMigrator>();

        await migrator.MigrateAsync("AddPlansUsageConversations");   // the schema before Phase 2
        var botId = Guid.NewGuid();
        await using (var conn = new NpgsqlConnection(connection))
        {
            await conn.OpenAsync();
            await using var cmd = new NpgsqlCommand($"""
                INSERT INTO bots.bots (id, tenant_id, name, welcome_message, public_key, created_at, lead_capture_enabled,
                                       lead_prompt, lead_after_messages, suggested_questions)
                VALUES ('{botId}', gen_random_uuid(), 'Old bot', 'Hi', 'bk_old', now(), false, 'Call?', 2, ARRAY[]::text[]);
                INSERT INTO bots.documents (id, tenant_id, bot_id, file_name, content_type, size_bytes, storage_key, status, created_at)
                VALUES (gen_random_uuid(), gen_random_uuid(), '{botId}', 'old.pdf', 'application/pdf', 1, 'k', 'Ready', now());
                """, conn);
            await cmd.ExecuteNonQueryAsync();
        }

        await migrator.MigrateAsync();

        var bot = await db.Bots.IgnoreQueryFilters().AsNoTracking().SingleAsync(b => b.Id == botId);
        Assert.Equal(("friendly", "medium", "after", "right", "Asia/Kolkata", "09:00", "18:00"),
            (bot.Tone, bot.AnswerLength, bot.LeadTiming, bot.WidgetPosition, bot.TimeZone, bot.HoursStart, bot.HoursEnd));
        Assert.True(bot.ShowSources);
        Assert.True(bot.LeadAskCourse);
        Assert.Equal("Course / interest", bot.LeadCourseLabel);
        Assert.Equal([1, 2, 3, 4, 5, 6], bot.HoursDays);
        Assert.False(string.IsNullOrEmpty(bot.OfflineMessage));
        Assert.Equal("auto", bot.ReplyLanguage);
        Assert.True(bot.VoiceEnabled);
        Assert.True(bot.AlertEmailEnabled);            // Phase 4: existing bots get lead alerts
        Assert.Equal("Book a visit", bot.BookingLabel);
        Assert.Equal("Pay fees", bot.PaymentLabel);
        Assert.Null(bot.WebhookUrl);

        var doc = await db.Documents.IgnoreQueryFilters().AsNoTracking().SingleAsync(d => d.BotId == botId);
        Assert.Equal("file", doc.Kind);
    }
}
