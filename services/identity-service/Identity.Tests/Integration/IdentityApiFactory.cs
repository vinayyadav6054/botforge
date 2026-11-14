using System.Collections.Concurrent;
using Identity.Api.Accounts;
using Identity.Api.Email;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
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
    public const string AdminKey = "integration-admin-key";
    public const string InternalKey = "integration-internal-key";

    public FakeEmailSender Emails { get; } = new();
    public FakeBotsClient Bots { get; } = new();

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
        builder.UseSetting("Admin:ApiKey", AdminKey);
        builder.UseSetting("Internal:ApiKey", InternalKey);
        builder.UseSetting("App:DashboardUrl", "https://dash.example");
        builder.UseSetting("Reports:Enabled", "false");   // tests call MonthlyReportService.SendDueAsync directly
        builder.ConfigureTestServices(s =>
        {
            s.RemoveAll<IEmailSender>();
            s.AddSingleton<IEmailSender>(Emails);
            s.RemoveAll<IBotsClient>();
            s.AddSingleton<IBotsClient>(Bots);
        });
    }
}

public class FakeEmailSender : IEmailSender
{
    public ConcurrentQueue<EmailMessage> Sent { get; } = new();
    public bool Fail { get; set; }

    public Task SendAsync(EmailMessage message, CancellationToken ct = default)
    {
        if (Fail) throw new InvalidOperationException("SMTP down (simulated)");
        Sent.Enqueue(message);
        return Task.CompletedTask;
    }

    public List<EmailMessage> To(string address) => Sent.Where(m => m.To == address).ToList();

    /// <summary>The token from the last link of this kind sent to the address.</summary>
    public string LastToken(string address, string path)
    {
        var text = To(address).Last(m => m.Text.Contains(path)).Text;
        var start = text.IndexOf(path + "?token=", StringComparison.Ordinal) + path.Length + 7;
        var end = text.IndexOfAny(['\n', '\r', ' '], start);
        return Uri.UnescapeDataString(end < 0 ? text[start..] : text[start..end]);
    }
}

public class FakeBotsClient : IBotsClient
{
    public ConcurrentBag<Guid> Deleted { get; } = new();
    public bool Fail { get; set; }
    public List<MonthlyStats> Stats { get; set; } = new();

    public Task DeleteTenantAsync(Guid tenantId, CancellationToken ct = default)
    {
        if (Fail) throw new HttpRequestException("bot service down (simulated)");
        Deleted.Add(tenantId);
        return Task.CompletedTask;
    }

    public Task<List<MonthlyStats>> MonthlyReportAsync(string period, CancellationToken ct = default) => Task.FromResult(Stats);
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

/// <summary>All integration classes share one API instance and one test database.</summary>
[CollectionDefinition(Name)]
public class IdentityApiCollection : ICollectionFixture<IdentityApiFactory>
{
    public const string Name = "identity-api";
}
