using System.Threading.RateLimiting;
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

var app = builder.Build();

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

app.UseCors();
app.UseRateLimiter();

// serve the embeddable widget bundle (apps/widget/dist) at /widget.js
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
