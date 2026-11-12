using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Bots.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddLeads : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "lead_after_messages",
                schema: "bots",
                table: "bots",
                type: "integer",
                nullable: false,
                defaultValue: 2);

            migrationBuilder.AddColumn<bool>(
                name: "lead_capture_enabled",
                schema: "bots",
                table: "bots",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "lead_prompt",
                schema: "bots",
                table: "bots",
                type: "character varying(300)",
                maxLength: 300,
                nullable: false,
                defaultValue: "Would you like our team to call you back? Share your details below.");

            migrationBuilder.CreateTable(
                name: "leads",
                schema: "bots",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    bot_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    phone = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    email = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    course = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: true),
                    page_url = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    transcript = table.Column<string>(type: "text", nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    consent_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_leads", x => x.id);
                    table.ForeignKey(
                        name: "fk_leads_bots_bot_id",
                        column: x => x.bot_id,
                        principalSchema: "bots",
                        principalTable: "bots",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_leads_bot_id_phone_created_at",
                schema: "bots",
                table: "leads",
                columns: new[] { "bot_id", "phone", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_leads_tenant_id_bot_id_created_at",
                schema: "bots",
                table: "leads",
                columns: new[] { "tenant_id", "bot_id", "created_at" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "leads",
                schema: "bots");

            migrationBuilder.DropColumn(
                name: "lead_after_messages",
                schema: "bots",
                table: "bots");

            migrationBuilder.DropColumn(
                name: "lead_capture_enabled",
                schema: "bots",
                table: "bots");

            migrationBuilder.DropColumn(
                name: "lead_prompt",
                schema: "bots",
                table: "bots");
        }
    }
}
