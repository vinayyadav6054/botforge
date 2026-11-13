using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Bots.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddPlansUsageConversations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "conversations",
                schema: "bots",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    bot_id = table.Column<Guid>(type: "uuid", nullable: false),
                    page_url = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    started_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    last_message_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    message_count = table.Column<int>(type: "integer", nullable: false),
                    unanswered_count = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_conversations", x => x.id);
                    table.ForeignKey(
                        name: "fk_conversations_bots_bot_id",
                        column: x => x.bot_id,
                        principalSchema: "bots",
                        principalTable: "bots",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "subscriptions",
                schema: "bots",
                columns: table => new
                {
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    plan = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    trial_ends_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    current_period_end = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    provider = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    provider_subscription_id = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_subscriptions", x => x.tenant_id);
                });

            migrationBuilder.CreateTable(
                name: "usage_counters",
                schema: "bots",
                columns: table => new
                {
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    period = table.Column<string>(type: "character varying(7)", maxLength: 7, nullable: false),
                    answers = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_usage_counters", x => new { x.tenant_id, x.period });
                });

            migrationBuilder.CreateTable(
                name: "conversation_messages",
                schema: "bots",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    conversation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    role = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    text = table.Column<string>(type: "text", nullable: false),
                    answered = table.Column<bool>(type: "boolean", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_conversation_messages", x => x.id);
                    table.ForeignKey(
                        name: "fk_conversation_messages_conversations_conversation_id",
                        column: x => x.conversation_id,
                        principalSchema: "bots",
                        principalTable: "conversations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_conversation_messages_conversation_id_created_at",
                schema: "bots",
                table: "conversation_messages",
                columns: new[] { "conversation_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_conversations_bot_id",
                schema: "bots",
                table: "conversations",
                column: "bot_id");

            migrationBuilder.CreateIndex(
                name: "ix_conversations_last_message_at",
                schema: "bots",
                table: "conversations",
                column: "last_message_at");

            migrationBuilder.CreateIndex(
                name: "ix_conversations_tenant_id_bot_id_last_message_at",
                schema: "bots",
                table: "conversations",
                columns: new[] { "tenant_id", "bot_id", "last_message_at" });

            migrationBuilder.CreateIndex(
                name: "ix_subscriptions_provider_subscription_id",
                schema: "bots",
                table: "subscriptions",
                column: "provider_subscription_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "conversation_messages",
                schema: "bots");

            migrationBuilder.DropTable(
                name: "subscriptions",
                schema: "bots");

            migrationBuilder.DropTable(
                name: "usage_counters",
                schema: "bots");

            migrationBuilder.DropTable(
                name: "conversations",
                schema: "bots");
        }
    }
}
