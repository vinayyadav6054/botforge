using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Bots.Api.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "bots");

            migrationBuilder.CreateTable(
                name: "bots",
                schema: "bots",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    welcome_message = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    public_key = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_bots", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "documents",
                schema: "bots",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    bot_id = table.Column<Guid>(type: "uuid", nullable: false),
                    file_name = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    content_type = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    size_bytes = table.Column<long>(type: "bigint", nullable: false),
                    storage_key = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    status = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_documents", x => x.id);
                    table.ForeignKey(
                        name: "fk_documents_bots_bot_id",
                        column: x => x.bot_id,
                        principalSchema: "bots",
                        principalTable: "bots",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_bots_public_key",
                schema: "bots",
                table: "bots",
                column: "public_key",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_bots_tenant_id",
                schema: "bots",
                table: "bots",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "ix_documents_bot_id",
                schema: "bots",
                table: "documents",
                column: "bot_id");

            migrationBuilder.CreateIndex(
                name: "ix_documents_tenant_id_bot_id",
                schema: "bots",
                table: "documents",
                columns: new[] { "tenant_id", "bot_id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "documents",
                schema: "bots");

            migrationBuilder.DropTable(
                name: "bots",
                schema: "bots");
        }
    }
}
