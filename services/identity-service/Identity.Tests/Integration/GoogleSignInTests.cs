using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Identity.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Identity.Tests.Integration;

[Trait("Level", "Integration")]
[Collection(IdentityApiCollection.Name)]
public class GoogleSignInTests(IdentityApiFactory factory)
{
    private readonly HttpClient _client = factory.CreateClient();

    private Task<HttpResponseMessage> SignIn(string credential, string? tenantName = null) =>
        _client.PostAsJsonAsync("/auth/google", new { credential, tenantName });

    [Fact]
    public async Task A_new_google_user_gets_a_verified_business_account()
    {
        var email = $"g-{Guid.NewGuid():N}@gmail.com";
        var res = await SignIn($"good:{email}:true:Asha Rao");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.GetProperty("isNew").GetBoolean());
        Assert.False(string.IsNullOrEmpty(body.GetProperty("token").GetString()));

        using var scope = factory.Services.CreateScope();
        var user = await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.Include(u => u.Tenant).SingleAsync(u => u.Email == email);
        Assert.NotNull(user.EmailVerifiedAt);
        Assert.Equal("Asha Rao's business", user.Tenant.Name);

        // the second time it is a normal login into the same account
        var again = await (await SignIn($"good:{email}:true:Asha Rao")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(again.GetProperty("isNew").GetBoolean());
        Assert.Equal(body.GetProperty("tenantId").GetGuid(), again.GetProperty("tenantId").GetGuid());
    }

    [Fact]
    public async Task An_existing_email_account_can_use_google_and_becomes_verified()
    {
        var email = $"both-{Guid.NewGuid():N}@example.com";
        await _client.PostAsJsonAsync("/auth/register-tenant", new { tenantName = "Both Co", email, password = "Passw0rd!" });
        var body = await (await SignIn($"good:{email}:true:", "ignored for existing accounts")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(body.GetProperty("isNew").GetBoolean());
        using var scope = factory.Services.CreateScope();
        var user = await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.Include(u => u.Tenant).SingleAsync(u => u.Email == email);
        Assert.NotNull(user.EmailVerifiedAt);
        Assert.Equal("Both Co", user.Tenant.Name);
    }

    [Fact]
    public async Task Bad_or_unverified_tokens_are_refused_and_it_can_be_switched_off()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await SignIn("forged-token")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await SignIn($"good:x-{Guid.NewGuid():N}@gmail.com:false:X")).StatusCode);
        factory.Google.Enabled = false;
        try
        {
            Assert.Equal(HttpStatusCode.NotFound, (await SignIn("good:a@b.com:true:A")).StatusCode);
        }
        finally
        {
            factory.Google.Enabled = true;
        }
    }
}
