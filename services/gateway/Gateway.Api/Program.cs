using System.Threading.RateLimiting;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.FileProviders;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddReverseProxy()
    .LoadFromConfig(builder.Configuration.GetSection("ReverseProxy"));

var dashboardOrigins = builder.Configuration.GetSection("Gateway:DashboardOrigins").Get<string[]>() ?? [];
builder.Services.AddCors(o =>
{
    // the dashboard sends a bearer token, so only our own front-end may call those routes from a browser
    o.AddPolicy("dashboard", p => p.WithOrigins(dashboardOrigins)
        .AllowAnyHeader()
        .WithMethods("GET", "POST", "PUT", "DELETE"));
    // the widget runs on customers' websites, so the public chat routes accept any origin (no cookies involved)
    o.AddPolicy("public", p => p.AllowAnyOrigin()
        .WithHeaders("Content-Type")
        .WithMethods("GET", "POST"));
});

var authPerMinute = builder.Configuration.GetValue("Gateway:RateLimits:AuthPerMinute", 20);
var chatPerMinute = builder.Configuration.GetValue("Gateway:RateLimits:ChatPerMinute", 30);
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy("auth", ctx => PerClientIp(ctx, authPerMinute));
    o.AddPolicy("chat", ctx => PerClientIp(ctx, chatPerMinute));
});

// behind a hosting proxy (Hugging Face, Render, a load balancer) every request comes from the proxy's IP,
// which would put all visitors into one rate-limit bucket; trust only the last hop the proxy appended
var trustProxy = builder.Configuration.GetValue("Gateway:TrustForwardedHeaders", false);
if (trustProxy)
{
    builder.Services.Configure<ForwardedHeadersOptions>(o =>
    {
        o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
        o.ForwardLimit = 1;
        o.KnownNetworks.Clear();
        o.KnownProxies.Clear();
    });
}

var app = builder.Build();

if (trustProxy) app.UseForwardedHeaders();

// defense in depth: service-to-service endpoints must never be reachable from outside,
// even if someone later adds a broad route by mistake
app.Use(async (ctx, next) =>
{
    if (ctx.Request.Path.Value?.Contains("/internal", StringComparison.OrdinalIgnoreCase) == true)
    {
        ctx.Response.StatusCode = StatusCodes.Status404NotFound;
        return;
    }
    await next();
});

// serve the embeddable widget bundle (apps/widget/dist) at /widget.js.
// Static files must run before routing: once a catch-all proxy route (e.g. to the dashboard) has been
// selected, the static file middleware skips the request.
var widgetPath = Path.GetFullPath(builder.Configuration["Gateway:WidgetPath"] ?? "widget", app.Environment.ContentRootPath);
if (Directory.Exists(widgetPath))
{
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = new PhysicalFileProvider(widgetPath),
        OnPrepareResponse = c =>
        {
            c.Context.Response.Headers.AccessControlAllowOrigin = "*";
            c.Context.Response.Headers.CacheControl = "public, max-age=300";
        }
    });
}
else
{
    app.Logger.LogWarning("Widget bundle not found at {Path}; build apps/widget to serve /widget.js", widgetPath);
}

app.UseRouting();
app.UseCors();          // after routing: the CORS policy comes from the matched proxy route
app.UseRateLimiter();

app.MapGet("/health", () => Results.Ok(new { status = "ok", service = "gateway" }));
app.MapReverseProxy();

app.Run();

static RateLimitPartition<string> PerClientIp(HttpContext ctx, int perMinute) =>
    RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = perMinute,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0
        });

public partial class Program;
