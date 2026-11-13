using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Identity.Api.Migrations
{
    /// <inheritdoc />
    public partial class EmailVerificationTokensReports : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "email_verified_at",
                schema: "identity",
                table: "users",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "report_logs",
                schema: "identity",
                columns: table => new
                {
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    period = table.Column<string>(type: "character varying(7)", maxLength: 7, nullable: false),
                    sent_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_report_logs", x => new { x.tenant_id, x.period });
                });

            migrationBuilder.CreateTable(
                name: "user_tokens",
                schema: "identity",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    purpose = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    token_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    expires_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    used_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_user_tokens", x => x.id);
                    table.ForeignKey(
                        name: "fk_user_tokens_users_user_id",
                        column: x => x.user_id,
                        principalSchema: "identity",
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_user_tokens_token_hash",
                schema: "identity",
                table: "user_tokens",
                column: "token_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_user_tokens_user_id_purpose_created_at",
                schema: "identity",
                table: "user_tokens",
                columns: new[] { "user_id", "purpose", "created_at" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "report_logs",
                schema: "identity");

            migrationBuilder.DropTable(
                name: "user_tokens",
                schema: "identity");

            migrationBuilder.DropColumn(
                name: "email_verified_at",
                schema: "identity",
                table: "users");
        }
    }
}
