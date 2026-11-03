using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.DependencyInjection;

namespace Gateway.Tests;

/// <summary>A real HTTP server standing in for identity, bots and chat; it records what the gateway forwards.</summary>
public sealed class StubBackend : IAsyncDisposable
{
    private readonly WebApplication _app;
    public string Url { get; }
    public ConcurrentQueue<(string Path, string? Authorization)> Requests { get; } = new();

    public StubBackend()
    {
        var builder = WebApplication.CreateSlimBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        _app = builder.Build();
        _app.MapGet("/chat/{key}/stream-test", async (HttpContext ctx) =>
        {
            ctx.Response.ContentType = "text/event-stream";
            for (var i = 0; i < 3; i++)
            {
                await ctx.Response.WriteAsync($"event: token\ndata: {{\"text\":\"{i}\"}}\n\n");
                await ctx.Response.Body.FlushAsync();
                await Task.Delay(50);
            }
        });
        _app.MapFallback(async (HttpContext ctx) =>
        {
            Requests.Enqueue((ctx.Request.Path + ctx.Request.QueryString, ctx.Request.Headers.Authorization.FirstOrDefault()));
            ctx.Response.ContentType = "application/json";
            await ctx.Response.WriteAsync(JsonSerializer.Serialize(new { path = ctx.Request.Path.Value, method = ctx.Request.Method }));
        });
        _app.StartAsync().GetAwaiter().GetResult();
        Url = _app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.First() + "/";
    }

    public async ValueTask DisposeAsync() => await _app.DisposeAsync();
}

public sealed class GatewayFactory : WebApplicationFactory<Program>
{
    public StubBackend Backend { get; } = new();
    public string WidgetDir { get; } = Path.Combine(Path.GetTempPath(), "botforge-widget-" + Guid.NewGuid().ToString("N"));

    public GatewayFactory()
    {
        Directory.CreateDirectory(WidgetDir);
        File.WriteAllText(Path.Combine(WidgetDir, "widget.js"), "console.log('widget');");
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        foreach (var cluster in new[] { "identity", "bots", "chat" })
            builder.UseSetting($"ReverseProxy:Clusters:{cluster}:Destinations:d1:Address", Backend.Url);
        builder.UseSetting("Gateway:WidgetPath", WidgetDir);
        builder.UseSetting("Gateway:RateLimits:AuthPerMinute", "3");
        builder.UseSetting("Gateway:RateLimits:ChatPerMinute", "1000");
        builder.UseSetting("Gateway:DashboardOrigins:0", "http://localhost:3000");
    }

    public override async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        await Backend.DisposeAsync();
        if (Directory.Exists(WidgetDir)) Directory.Delete(WidgetDir, recursive: true);
    }
}

[Trait("Level", "Integration")]
public class GatewayTests(GatewayFactory factory) : IClassFixture<GatewayFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    private async Task<JsonElement> Json(HttpResponseMessage res) =>
        JsonDocument.Parse(await res.Content.ReadAsStringAsync()).RootElement;

    [Fact]
    public async Task Health_is_ok() =>
        Assert.Equal(HttpStatusCode.OK, (await _client.GetAsync("/health")).StatusCode);

    [Theory]
    [InlineData("/api/bots", "/bots")]
    [InlineData("/api/bots/123/documents?x=1", "/bots/123/documents")]
    [InlineData("/api/chat/bk_abc/info", "/chat/bk_abc/info")]
    public async Task Strips_the_api_prefix_when_forwarding(string incoming, string forwardedPath)
    {
        var res = await _client.GetAsync(incoming);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal(forwardedPath, (await Json(res)).GetProperty("path").GetString());
    }

    [Fact]
    public async Task Forwards_the_authorization_header()
    {
        var req = new HttpRequestMessage(HttpMethod.Get, "/api/bots/auth-check");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", "abc.def.ghi");
        await _client.SendAsync(req);
        Assert.Contains(factory.Backend.Requests, r => r.Path == "/bots/auth-check" && r.Authorization == "Bearer abc.def.ghi");
    }

    [Theory]
    [InlineData("/internal/bots/bk_x")]
    [InlineData("/api/bots/internal/bots/bk_x")]
    [InlineData("/api/chat/../internal/bots/bk_x")]
    [InlineData("/INTERNAL/bots/bk_x")]
    public async Task Internal_endpoints_are_never_reachable(string path)
    {
        var res = await _client.GetAsync(path);
        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
        Assert.DoesNotContain(factory.Backend.Requests, r => r.Path.Contains("internal", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task Unknown_paths_are_404() =>
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync("/api/unknown")).StatusCode);

    private async Task<HttpResponseMessage> Preflight(string path, string origin)
    {
        var req = new HttpRequestMessage(HttpMethod.Options, path);
        req.Headers.Add("Origin", origin);
        req.Headers.Add("Access-Control-Request-Method", "POST");
        req.Headers.Add("Access-Control-Request-Headers", "content-type,authorization");
        return await _client.SendAsync(req);
    }

    [Fact]
    public async Task Dashboard_routes_only_allow_the_dashboard_origin()
    {
        var ok = await Preflight("/api/bots", "http://localhost:3000");
        Assert.Equal("http://localhost:3000", ok.Headers.GetValues("Access-Control-Allow-Origin").Single());

        var evil = await Preflight("/api/bots", "https://evil.example");
        Assert.False(evil.Headers.Contains("Access-Control-Allow-Origin"));
        var evilAuth = await Preflight("/api/auth/login", "https://evil.example");
        Assert.False(evilAuth.Headers.Contains("Access-Control-Allow-Origin"));
    }

    [Fact]
    public async Task Chat_routes_allow_any_origin()
    {
        var req = new HttpRequestMessage(HttpMethod.Options, "/api/chat/bk_x");
        req.Headers.Add("Origin", "https://customer-site.example");
        req.Headers.Add("Access-Control-Request-Method", "POST");
        req.Headers.Add("Access-Control-Request-Headers", "content-type");
        var res = await _client.SendAsync(req);
        Assert.Equal("*", res.Headers.GetValues("Access-Control-Allow-Origin").Single());
    }

    [Fact]
    public async Task Auth_routes_are_rate_limited()
    {
        var codes = new List<HttpStatusCode>();
        for (var i = 0; i < 5; i++)
            codes.Add((await _client.PostAsync("/api/auth/login", new StringContent("{}"))).StatusCode);
        Assert.Contains(HttpStatusCode.TooManyRequests, codes);
        Assert.Equal(HttpStatusCode.OK, codes[0]);
    }

    [Fact]
    public async Task Server_sent_events_stream_through()
    {
        var res = await _client.GetAsync("/api/chat/bk_x/stream-test", HttpCompletionOption.ResponseHeadersRead);
        Assert.Equal("text/event-stream", res.Content.Headers.ContentType!.MediaType);
        var body = await res.Content.ReadAsStringAsync();
        Assert.Equal(3, body.Split("event: token").Length - 1);
    }

    [Fact]
    public async Task Serves_the_widget_script_to_any_site()
    {
        var res = await _client.GetAsync("/widget.js");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal("*", res.Headers.GetValues("Access-Control-Allow-Origin").Single());
        Assert.Contains("widget", await res.Content.ReadAsStringAsync());
    }
}
