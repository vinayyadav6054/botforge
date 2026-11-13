using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Bots.Api.Migrations
{
    /// <inheritdoc />
    public partial class BotSettingsQaSources : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "kind",
                schema: "bots",
                table: "documents",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<DateTime>(
                name: "last_synced_at",
                schema: "bots",
                table: "documents",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "max_pages",
                schema: "bots",
                table: "documents",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "source_secret",
                schema: "bots",
                table: "documents",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "source_url",
                schema: "bots",
                table: "documents",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "sync_interval_days",
                schema: "bots",
                table: "documents",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "answer_length",
                schema: "bots",
                table: "bots",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "avatar_data_url",
                schema: "bots",
                table: "bots",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "custom_instructions",
                schema: "bots",
                table: "bots",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<List<int>>(
                name: "hours_days",
                schema: "bots",
                table: "bots",
                type: "integer[]",
                nullable: false);

            migrationBuilder.AddColumn<bool>(
                name: "hours_enabled",
                schema: "bots",
                table: "bots",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "hours_end",
                schema: "bots",
                table: "bots",
                type: "character varying(5)",
                maxLength: 5,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "hours_start",
                schema: "bots",
                table: "bots",
                type: "character varying(5)",
                maxLength: 5,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<bool>(
                name: "lead_ask_course",
                schema: "bots",
                table: "bots",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "lead_ask_email",
                schema: "bots",
                table: "bots",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "lead_course_label",
                schema: "bots",
                table: "bots",
                type: "character varying(60)",
                maxLength: 60,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "lead_timing",
                schema: "bots",
                table: "bots",
                type: "character varying(10)",
                maxLength: 10,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "offline_message",
                schema: "bots",
                table: "bots",
                type: "character varying(300)",
                maxLength: 300,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<bool>(
                name: "show_sources",
                schema: "bots",
                table: "bots",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "time_zone",
                schema: "bots",
                table: "bots",
                type: "character varying(60)",
                maxLength: 60,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "tone",
                schema: "bots",
                table: "bots",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "topics_to_avoid",
                schema: "bots",
                table: "bots",
                type: "character varying(500)",
                maxLength: 500,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "widget_color",
                schema: "bots",
                table: "bots",
                type: "character varying(7)",
                maxLength: 7,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "widget_position",
                schema: "bots",
                table: "bots",
                type: "character varying(5)",
                maxLength: 5,
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateTable(
                name: "qa_entries",
                schema: "bots",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    bot_id = table.Column<Guid>(type: "uuid", nullable: false),
                    question = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    answer = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_qa_entries", x => x.id);
                    table.ForeignKey(
                        name: "fk_qa_entries_bots_bot_id",
                        column: x => x.bot_id,
                        principalSchema: "bots",
                        principalTable: "bots",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_documents_kind_last_synced_at",
                schema: "bots",
                table: "documents",
                columns: new[] { "kind", "last_synced_at" });

            migrationBuilder.CreateIndex(
                name: "ix_qa_entries_bot_id",
                schema: "bots",
                table: "qa_entries",
                column: "bot_id");

            migrationBuilder.CreateIndex(
                name: "ix_qa_entries_tenant_id_bot_id",
                schema: "bots",
                table: "qa_entries",
                columns: new[] { "tenant_id", "bot_id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "qa_entries",
                schema: "bots");

            migrationBuilder.DropIndex(
                name: "ix_documents_kind_last_synced_at",
                schema: "bots",
                table: "documents");

            migrationBuilder.DropColumn(
                name: "kind",
                schema: "bots",
                table: "documents");

            migrationBuilder.DropColumn(
                name: "last_synced_at",
                schema: "bots",
                table: "documents");

            migrationBuilder.DropColumn(
                name: "max_pages",
                schema: "bots",
                table: "documents");

            migrationBuilder.DropColumn(
                name: "source_secret",
                schema: "bots",
                table: "documents");

            migrationBuilder.DropColumn(
                name: "source_url",
                schema: "bots",
                table: "documents");

            migrationBuilder.DropColumn(
                name: "sync_interval_days",
                schema: "bots",
                table: "documents");

            migrationBuilder.DropColumn(
                name: "answer_length",
                schema: "bots",
                table: "bots");

            migrationBuilder.DropColumn(
                name: "avatar_data_url",
                schema: "bots",
                table: "bots");

            migrationBuilder.DropColumn(
                name: "custom_instructions",
                schema: "bots",
                table: "bots");

            migrationBuilder.DropColumn(
                name: "hours_days",
                schema: "bots",
                table: "bots");

            migrationBuilder.DropColumn(
                name: "hours_enabled",
                schema: "bots",
                table: "bots");

            migrationBuilder.DropColumn(
                name: "hours_end",
                schema: "bots",
                table: "bots");

            migrationBuilder.DropColumn(
                name: "hours_start",
                schema: "bots",
                table: "bots");

            migrationBuilder.DropColumn(
                name: "lead_ask_course",
                schema: "bots",
                table: "bots");

            migrationBuilder.DropColumn(
                name: "lead_ask_email",
                schema: "bots",
                table: "bots");

            migrationBuilder.DropColumn(
                name: "lead_course_label",
                schema: "bots",
                table: "bots");

            migrationBuilder.DropColumn(
                name: "lead_timing",
                schema: "bots",
                table: "bots");

            migrationBuilder.DropColumn(
                name: "offline_message",
                schema: "bots",
                table: "bots");

            migrationBuilder.DropColumn(
                name: "show_sources",
                schema: "bots",
                table: "bots");

            migrationBuilder.DropColumn(
                name: "time_zone",
                schema: "bots",
                table: "bots");

            migrationBuilder.DropColumn(
                name: "tone",
                schema: "bots",
                table: "bots");

            migrationBuilder.DropColumn(
                name: "topics_to_avoid",
                schema: "bots",
                table: "bots");

            migrationBuilder.DropColumn(
                name: "widget_color",
                schema: "bots",
                table: "bots");

            migrationBuilder.DropColumn(
                name: "widget_position",
                schema: "bots",
                table: "bots");
        }
    }
}
