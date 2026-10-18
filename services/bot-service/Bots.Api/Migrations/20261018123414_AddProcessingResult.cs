using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Bots.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddProcessingResult : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "chunk_count",
                schema: "bots",
                table: "documents",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "error",
                schema: "bots",
                table: "documents",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "chunk_count",
                schema: "bots",
                table: "documents");

            migrationBuilder.DropColumn(
                name: "error",
                schema: "bots",
                table: "documents");
        }
    }
}
