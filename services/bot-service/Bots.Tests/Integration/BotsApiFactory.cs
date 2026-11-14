using System.Collections.Concurrent;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text;
using Bots.Api.Messaging;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Npgsql;

namespace Bots.Tests.Integration;

/// <summary>
/// The real bot API in memory, on a throw-away Postgres database (botforge_test_bots, recreated each run),
/// a temp storage folder and an in-memory event publisher.
/// </summary>
public class BotsApiFactory : WebApplicationFactory<Program>
{
    public const string JwtKey = "integration-tests-signing-key-0123456789abcdef";
    public const string InternalKey = "integration-internal-key";
    public const string AdminKey = "integration-admin-key";
    public const string WebhookSecret = "integration-webhook-secret";

    public string StorageRoot { get; } = Path.Combine(Path.GetTempPath(), "botforge-it-" + Guid.NewGuid().ToString("N"));
    public FakePublisher Publisher { get; } = new();
    public FakePlatform Platform { get; } = new();
    /// <summary>Lead alert emails (to the identity service) and webhooks.</summary>
    public FakeOutbound Outbound { get; } = new();
    public string ConnectionString { get; }

    public BotsApiFactory()
    {
        ConnectionString = TestDatabase.Recreate("botforge_test_bots");
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        builder.UseSetting("ConnectionStrings:Default", ConnectionString);
        builder.UseSetting("Jwt:Key", JwtKey);
        builder.UseSetting("Jwt:Issuer", "botforge-identity");
        builder.UseSetting("Jwt:Audience", "botforge");
        builder.UseSetting("Internal:ApiKey", InternalKey);
        builder.UseSetting("Storage:RootPath", StorageRoot);
        builder.UseSetting("RabbitMq:ConsumeStatusEvents", "false");
        builder.UseSetting("Admin:ApiKey", AdminKey);
        builder.UseSetting("Sources:AutoSync", "false");   // tests call SourceSync.RunOnceAsync directly
        builder.UseSetting("Channels:PublicUrl", "https://bots.test");
        builder.UseSetting("Razorpay:WebhookSecret", WebhookSecret);
        builder.ConfigureTestServices(s =>
        {
            s.RemoveAll<IEventPublisher>();
            s.AddSingleton<IEventPublisher>(Publisher);
            s.AddHttpClient<Bots.Api.ChannelPlatforms>().ConfigurePrimaryHttpMessageHandler(() => Platform);
            s.AddHttpClient<Bots.Api.IdentityAlerts>().ConfigurePrimaryHttpMessageHandler(() => Outbound);
            s.AddHttpClient<Bots.Api.WebhookSender>().ConfigurePrimaryHttpMessageHandler(() => Outbound);
        });
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (Directory.Exists(StorageRoot)) Directory.Delete(StorageRoot, recursive: true);
    }

    public HttpClient ClientFor(Guid tenantId) => ClientWithToken(Token(tenantId));

    public HttpClient ClientWithToken(string token)
    {
        var client = CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    public static string Token(Guid? tenantId, string key = JwtKey, DateTime? expires = null)
    {
        var claims = new List<Claim> { new("sub", Guid.NewGuid().ToString()), new("role", "Owner") };
        if (tenantId is not null) claims.Add(new Claim("tenant_id", tenantId.Value.ToString()));
        var now = DateTime.UtcNow;
        var exp = expires ?? now.AddMinutes(30);
        return new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = "botforge-identity",
            Audience = "botforge",
            NotBefore = exp < now ? exp.AddMinutes(-10) : now,
            IssuedAt = exp < now ? exp.AddMinutes(-10) : now,
            Expires = exp,
            Subject = new ClaimsIdentity(claims),
            SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)), SecurityAlgorithms.HmacSha256)
        });
    }
}

public class FakePublisher : IEventPublisher
{
    public ConcurrentQueue<(string RoutingKey, object Message)> Published { get; } = new();
    public bool Fail { get; set; }

    /// <summary>Runs inside PublishAsync, e.g. to simulate a worker that answers instantly.</summary>
    public Func<string, object, Task>? OnPublish { get; set; }

    public async Task PublishAsync<T>(string routingKey, T message, CancellationToken ct = default)
    {
        if (Fail) throw new InvalidOperationException("broker down (simulated)");
        Published.Enqueue((routingKey, message!));
        if (OnPublish is not null) await OnPublish(routingKey, message!);
    }

    public IEnumerable<T> Of<T>(string routingKey) =>
        Published.Where(p => p.RoutingKey == routingKey).Select(p => p.Message).OfType<T>();
}

public static class TestDatabase
{
    /// <summary>Connection settings from BOTFORGE_TEST_DB or the API's user secrets; only the database name changes.</summary>
    public static string BaseConnectionString() =>
        Environment.GetEnvironmentVariable("BOTFORGE_TEST_DB")
        ?? new ConfigurationBuilder().AddUserSecrets<Program>().Build().GetConnectionString("Default")
        ?? throw new InvalidOperationException(
            "Set BOTFORGE_TEST_DB or the API's ConnectionStrings:Default user secret to run integration tests.");

    public static string Recreate(string databaseName)
    {
        var baseConnection = BaseConnectionString();
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
public class BotsApiCollection : ICollectionFixture<BotsApiFactory>
{
    public const string Name = "bots-api";
}

/// <summary>Stands in for api.telegram.org and graph.facebook.com.</summary>
public class FakePlatform : HttpMessageHandler
{
    public ConcurrentQueue<(string Method, string Url, string Body)> Calls { get; } = new();
    public Func<HttpRequestMessage, HttpResponseMessage?>? Override { get; set; }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        var url = request.RequestUri!.ToString();
        Calls.Enqueue((request.Method.Method, url, request.Content is null ? "" : await request.Content.ReadAsStringAsync(ct)));
        if (Override?.Invoke(request) is { } custom) return custom;
        string json;
        if (url.Contains("/getMe")) json = """{"ok":true,"result":{"id":777000111,"username":"sunrise_bot"}}""";
        else if (url.Contains("/setWebhook") || url.Contains("/deleteWebhook")) json = """{"ok":true,"result":true}""";
        else if (url.Contains("fields=display_phone_number")) json = """{"display_phone_number":"+91 98200 12345","id":"1234567890"}""";
        else if (url.Contains("/me?fields=")) json = """{"id":"55501","name":"Sunrise Academy"}""";
        else if (url.Contains("subscribed_apps")) json = """{"success":true}""";
        else return new HttpResponseMessage(System.Net.HttpStatusCode.NotFound);
        return new HttpResponseMessage(System.Net.HttpStatusCode.OK) { Content = new StringContent(json, System.Text.Encoding.UTF8, "application/json") };
    }
}

/// <summary>Records outgoing calls; answers 200 unless Status says otherwise for that address.</summary>
public class FakeOutbound : HttpMessageHandler
{
    public ConcurrentQueue<(string Url, Dictionary<string, string> Headers, string Body)> Calls { get; } = new();
    public Func<Uri, System.Net.HttpStatusCode>? Status { get; set; }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        var headers = request.Headers.ToDictionary(h => h.Key, h => string.Join(",", h.Value));
        Calls.Enqueue((request.RequestUri!.ToString(), headers, request.Content is null ? "" : await request.Content.ReadAsStringAsync(ct)));
        return new HttpResponseMessage(Status?.Invoke(request.RequestUri!) ?? System.Net.HttpStatusCode.OK) { Content = new StringContent("{}") };
    }

    public List<(string Url, Dictionary<string, string> Headers, string Body)> To(string urlPart) =>
        Calls.Where(c => c.Url.Contains(urlPart)).ToList();
}
