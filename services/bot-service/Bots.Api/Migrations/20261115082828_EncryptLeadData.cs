using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Bots.Api.Migrations
{
    /// <inheritdoc />
    public partial class EncryptLeadData : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_leads_bot_id_phone_created_at",
                schema: "bots",
                table: "leads");

            migrationBuilder.AlterColumn<string>(
                name: "phone",
                schema: "bots",
                table: "leads",
                type: "character varying(120)",
                maxLength: 120,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(20)",
                oldMaxLength: 20);

            migrationBuilder.AlterColumn<string>(
                name: "name",
                schema: "bots",
                table: "leads",
                type: "character varying(600)",
                maxLength: 600,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(100)",
                oldMaxLength: 100);

            migrationBuilder.AlterColumn<string>(
                name: "email",
                schema: "bots",
                table: "leads",
                type: "character varying(400)",
                maxLength: 400,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(200)",
                oldMaxLength: 200,
                oldNullable: true);

            migrationBuilder.AddColumn<string>(
                name: "phone_hash",
                schema: "bots",
                table: "leads",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_leads_bot_id_phone_hash_created_at",
                schema: "bots",
                table: "leads",
                columns: new[] { "bot_id", "phone_hash", "created_at" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_leads_bot_id_phone_hash_created_at",
                schema: "bots",
                table: "leads");

            migrationBuilder.DropColumn(
                name: "phone_hash",
                schema: "bots",
                table: "leads");

            migrationBuilder.AlterColumn<string>(
                name: "phone",
                schema: "bots",
                table: "leads",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(120)",
                oldMaxLength: 120);

            migrationBuilder.AlterColumn<string>(
                name: "name",
                schema: "bots",
                table: "leads",
                type: "character varying(100)",
                maxLength: 100,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(600)",
                oldMaxLength: 600);

            migrationBuilder.AlterColumn<string>(
                name: "email",
                schema: "bots",
                table: "leads",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(400)",
                oldMaxLength: 400,
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_leads_bot_id_phone_created_at",
                schema: "bots",
                table: "leads",
                columns: new[] { "bot_id", "phone", "created_at" });
        }
    }
}
