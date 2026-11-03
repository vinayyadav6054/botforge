using Microsoft.Extensions.Options;

namespace Bots.Api.Storage;

public class StorageOptions
{
    public string RootPath { get; set; } = "storage";
}

public interface IFileStorage
{
    Task SaveAsync(string key, Stream content, CancellationToken ct = default);
    Task<Stream> OpenReadAsync(string key, CancellationToken ct = default);
    Task DeleteAsync(string key, CancellationToken ct = default);
}

public class LocalFileStorage(IOptions<StorageOptions> options) : IFileStorage
{
    // trailing separator so "storage-other" can never pass the "is inside the root" check
    private readonly string _root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(options.Value.RootPath))
                                    + Path.DirectorySeparatorChar;

    public async Task SaveAsync(string key, Stream content, CancellationToken ct = default)
    {
        var path = Resolve(key);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await using var fs = File.Create(path);
        await content.CopyToAsync(fs, ct);
    }

    public Task<Stream> OpenReadAsync(string key, CancellationToken ct = default) =>
        Task.FromResult<Stream>(File.OpenRead(Resolve(key)));

    public Task DeleteAsync(string key, CancellationToken ct = default)
    {
        var path = Resolve(key);
        if (File.Exists(path)) File.Delete(path);
        return Task.CompletedTask;
    }

    private string Resolve(string key)
    {
        var full = Path.GetFullPath(Path.Combine(_root, key));
        if (!full.StartsWith(_root, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Invalid storage key.");
        return full;
    }
}