using System.Net;
using System.Net.Http.Json;
using Identity.Api.Auth;
using Identity.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Identity.Tests.Integration;

[Trait("Level", "Integration")]
[Collection(IdentityApiCollection.Name)]
public class LoginLockoutTests(IdentityApiFactory factory)
{
    private readonly HttpClient _client = factory.CreateClient();
    private const string Password = "Passw0rd!";

    private async Task<string> Register()
    {
        var email = $"lock-{Guid.NewGuid():N}@example.com";
        await _client.PostAsJsonAsync("/auth/register-tenant", new { tenantName = "Lock Co", email, password = Password });
        return email;
    }

    private Task<HttpResponseMessage> Login(string email, string password) =>
        _client.PostAsJsonAsync("/auth/login", new { email, password });

    [Fact]
    public async Task Five_wrong_passwords_lock_the_account_even_for_the_right_one()
    {
        var email = await Register();
        for (var i = 0; i < LoginRules.MaxFailures; i++)
            Assert.Equal(HttpStatusCode.Unauthorized, (await Login(email, "wrong-" + i)).StatusCode);

        var locked = await Login(email, Password);
        Assert.Equal(HttpStatusCode.TooManyRequests, locked.StatusCode);
        Assert.Contains("Try again in 15 minutes", await locked.Content.ReadAsStringAsync());

        // once the lock has passed, the right password works and the counter starts again
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.Users.Where(u => u.Email == email).ExecuteUpdateAsync(s => s.SetProperty(u => u.LockedUntil, DateTime.UtcNow.AddSeconds(-1)));
        }
        Assert.Equal(HttpStatusCode.OK, (await Login(email, Password)).StatusCode);
    }

    [Fact]
    public async Task A_successful_login_resets_the_count()
    {
        var email = await Register();
        for (var i = 0; i < LoginRules.MaxFailures - 1; i++) await Login(email, "wrong");
        Assert.Equal(HttpStatusCode.OK, (await Login(email, Password)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Login(email, "wrong")).StatusCode);   // counting from zero again
        Assert.Equal(HttpStatusCode.OK, (await Login(email, Password)).StatusCode);
    }

    [Fact]
    public async Task Unknown_emails_get_the_same_answer_as_wrong_passwords()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await Login($"nobody-{Guid.NewGuid():N}@example.com", "whatever1")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Login(await Register(), new string('x', 500))).StatusCode);
    }
}
