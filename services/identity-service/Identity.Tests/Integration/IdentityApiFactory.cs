using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Npgsql;

namespace Identity.Tests.Integration;

/// <summary>
/// Runs the real identity API in memory against a throw-away Postgres database
/// (botforge_test_identity on the local docker Postgres). The database is recreated on every run.
/// Connection details come from BOTFORGE_TEST_DB or the API's user secrets; only the database name changes.
/// </summary>
public class IdentityApiFactory : WebApplicationFactory<Program>
{
    public const string JwtKey = "integration-tests-signing-key-0123456789abcdef";
    public const string Issuer = "botforge-identity";
    public const string Audience = "botforge";

    private readonly string _connectionString;

    public IdentityApiFactory()
    {
        _connectionString = TestDatabase.Recreate("botforge_test_identity");
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        builder.UseSetting("ConnectionStrings:Default", _connectionString);
        builder.UseSetting("Jwt:Key", JwtKey);
        builder.UseSetting("Jwt:Issuer", Issuer);
        builder.UseSetting("Jwt:Audience", Audience);
    }
}

public static class TestDatabase
{
    public static string Recreate(string databaseName)
    {
        var baseConnection = Environment.GetEnvironmentVariable("BOTFORGE_TEST_DB")
            ?? new ConfigurationBuilder().AddUserSecrets<Program>().Build().GetConnectionString("Default")
            ?? throw new InvalidOperationException(
                "Set BOTFORGE_TEST_DB or the API's ConnectionStrings:Default user secret to run integration tests.");

        var admin = new NpgsqlConnectionStringBuilder(baseConnection) { Database = "postgres", Pooling = false };
        using (var conn = new NpgsqlConnection(admin.ConnectionString))
        {
            conn.Open();
            using var drop = new NpgsqlCommand($"DROP DATABASE IF EXISTS \"{databaseName}\" WITH (FORCE)", conn);
            drop.ExecuteNonQuery();
            using var create = new NpgsqlCommand($"CREATE DATABASE \"{databaseName}\"", conn);
            create.ExecuteNonQuery();
        }

        return new NpgsqlConnectionStringBuilder(baseConnection) { Database = databaseName }.ConnectionString;
    }
}
