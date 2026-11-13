using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Bots.Api.Migrations
{
    /// <inheritdoc />
    public partial class ChannelsLanguageVoice : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "channel",
                schema: "bots",
                table: "leads",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "web");

            migrationBuilder.AddColumn<string>(
                name: "channel",
                schema: "bots",
                table: "conversations",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "web");

            migrationBuilder.AddColumn<string>(
                name: "contact_id",
                schema: "bots",
                table: "conversations",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "contact_name",
                schema: "bots",
                table: "conversations",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "reply_language",
                schema: "bots",
                table: "bots",
                type: "character varying(10)",
                maxLength: 10,
                nullable: false,
                defaultValue: "auto");

            migrationBuilder.AddColumn<bool>(
                name: "voice_enabled",
                schema: "bots",
                table: "bots",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.CreateTable(
                name: "channels",
                schema: "bots",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    bot_id = table.Column<Guid>(type: "uuid", nullable: false),
                    kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    display_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    external_id = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    secrets_cipher = table.Column<string>(type: "text", nullable: false),
                    verify_token = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    webhook_secret = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    last_message_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    last_error = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_channels", x => x.id);
                    table.ForeignKey(
                        name: "fk_channels_bots_bot_id",
                        column: x => x.bot_id,
                        principalSchema: "bots",
                        principalTable: "bots",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_channels_bot_id",
                schema: "bots",
                table: "channels",
                column: "bot_id");

            migrationBuilder.CreateIndex(
                name: "ix_channels_kind_external_id",
                schema: "bots",
                table: "channels",
                columns: new[] { "kind", "external_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_channels_tenant_id_bot_id",
                schema: "bots",
                table: "channels",
                columns: new[] { "tenant_id", "bot_id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "channels",
                schema: "bots");

            migrationBuilder.DropColumn(
                name: "channel",
                schema: "bots",
                table: "leads");

            migrationBuilder.DropColumn(
                name: "channel",
                schema: "bots",
                table: "conversations");

            migrationBuilder.DropColumn(
                name: "contact_id",
                schema: "bots",
                table: "conversations");

            migrationBuilder.DropColumn(
                name: "contact_name",
                schema: "bots",
                table: "conversations");

            migrationBuilder.DropColumn(
                name: "reply_language",
                schema: "bots",
                table: "bots");

            migrationBuilder.DropColumn(
                name: "voice_enabled",
                schema: "bots",
                table: "bots");
        }
    }
}
