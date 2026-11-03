using System.Security.Claims;
using System.Text;
using Bots.Api.Storage;
using Bots.Api.Tenancy;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;

namespace Bots.Tests.Unit;

[Trait("Level", "Unit")]
public class LocalFileStorageTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "botforge-storage-" + Guid.NewGuid().ToString("N"));
    private readonly LocalFileStorage _storage;

    public LocalFileStorageTests()
    {
        _storage = new LocalFileStorage(Options.Create(new StorageOptions { RootPath = _root }));
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
        var sibling = _root + "-evil";
        if (Directory.Exists(sibling)) Directory.Delete(sibling, recursive: true);
    }

    [Fact]
    public async Task Save_read_and_delete_round_trip()
    {
        await _storage.SaveAsync("tenant/bot/doc.txt", new MemoryStream(Encoding.UTF8.GetBytes("hello")));

        await using (var read = await _storage.OpenReadAsync("tenant/bot/doc.txt"))
        using (var reader = new StreamReader(read))
            Assert.Equal("hello", await reader.ReadToEndAsync());

        await _storage.DeleteAsync("tenant/bot/doc.txt");
        Assert.False(File.Exists(Path.Combine(_root, "tenant", "bot", "doc.txt")));
    }

    [Fact]
    public async Task Delete_of_missing_file_is_a_no_op() =>
        await _storage.DeleteAsync("does/not/exist.txt");

    [Theory]
    [InlineData("../outside.txt")]
    [InlineData("a/../../outside.txt")]
    public async Task Rejects_keys_that_escape_the_root(string key) =>
        await Assert.ThrowsAsync<InvalidOperationException>(() => _storage.SaveAsync(key, new MemoryStream()));

    [Fact]
    public async Task Rejects_sibling_folder_sharing_the_root_prefix()
    {
        // root = .../botforge-storage-123, key escapes to .../botforge-storage-123-evil/x.txt
        var key = $"../{Path.GetFileName(_root)}-evil/x.txt";
        await Assert.ThrowsAsync<InvalidOperationException>(() => _storage.SaveAsync(key, new MemoryStream()));
    }
}

[Trait("Level", "Unit")]
public class TenantContextTests
{
    private static ITenantContext For(params Claim[] claims)
    {
        var ctx = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(claims, "test")) };
        return new TenantContext(new HttpContextAccessor { HttpContext = ctx });
    }

    [Fact]
    public void Reads_tenant_id_claim()
    {
        var id = Guid.NewGuid();
        Assert.Equal(id, For(new Claim("tenant_id", id.ToString())).TenantId);
    }

    [Fact]
    public void Missing_or_invalid_claim_means_no_tenant()
    {
        Assert.Equal(Guid.Empty, For().TenantId);
        Assert.Equal(Guid.Empty, For(new Claim("tenant_id", "not-a-guid")).TenantId);
        Assert.Equal(Guid.Empty, new TenantContext(new HttpContextAccessor()).TenantId);
    }
}
