using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Bots.Api.Migrations
{
    /// <inheritdoc />
    public partial class Phase4AlertsActions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "alert_email",
                schema: "bots",
                table: "bots",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "alert_email_enabled",
                schema: "bots",
                table: "bots",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<string>(
                name: "booking_label",
                schema: "bots",
                table: "bots",
                type: "text",
                nullable: false,
                defaultValue: "Book a visit");

            migrationBuilder.AddColumn<string>(
                name: "booking_url",
                schema: "bots",
                table: "bots",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "payment_label",
                schema: "bots",
                table: "bots",
                type: "text",
                nullable: false,
                defaultValue: "Pay fees");

            migrationBuilder.AddColumn<string>(
                name: "payment_url",
                schema: "bots",
                table: "bots",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "upi_id",
                schema: "bots",
                table: "bots",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "webhook_secret",
                schema: "bots",
                table: "bots",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "webhook_url",
                schema: "bots",
                table: "bots",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "alert_email",
                schema: "bots",
                table: "bots");

            migrationBuilder.DropColumn(
                name: "alert_email_enabled",
                schema: "bots",
                table: "bots");

            migrationBuilder.DropColumn(
                name: "booking_label",
                schema: "bots",
                table: "bots");

            migrationBuilder.DropColumn(
                name: "booking_url",
                schema: "bots",
                table: "bots");

            migrationBuilder.DropColumn(
                name: "payment_label",
                schema: "bots",
                table: "bots");

            migrationBuilder.DropColumn(
                name: "payment_url",
                schema: "bots",
                table: "bots");

            migrationBuilder.DropColumn(
                name: "upi_id",
                schema: "bots",
                table: "bots");

            migrationBuilder.DropColumn(
                name: "webhook_secret",
                schema: "bots",
                table: "bots");

            migrationBuilder.DropColumn(
                name: "webhook_url",
                schema: "bots",
                table: "bots");
        }
    }
}
