using System.IO.Compression;
using Meziantou.ComicsReader.CatalogServices;
using Meziantou.Extensions.Logging.Xunit.v3;
using Meziantou.Framework;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Meziantou.ComicsReader.Tests;

internal sealed class ComicsReaderTestContext : IAsyncDisposable
{
    private readonly TemporaryDirectory? _booksFolder;
    private readonly TemporaryDirectory? _booksCompletedFolder;
    private readonly TemporaryDirectory? _indexFolder;
    private readonly FullPath _booksPath;
    private readonly FullPath _booksCompletedPath;
    private readonly FullPath _indexPath;

    private readonly WebApplicationFactory<Program> _applicationFactory;
    private string? _authToken;

    [SuppressMessage("Reliability", "CA2000:Dispose objects before losing scope")]
    public ComicsReaderTestContext(
        string? authToken = null,
        TimeSpan? refreshPeriod = null,
        bool? copyBooksToCache = null,
        FullPath? booksPath = null,
        FullPath? booksCompletedPath = null,
        FullPath? indexPath = null)
    {
        CancellationToken = TestContext.Current.CancellationToken;
        _booksPath = InitializePath(booksPath, out _booksFolder);
        _booksCompletedPath = InitializePath(booksCompletedPath, out _booksCompletedFolder);
        _indexPath = InitializePath(indexPath, out _indexFolder);

        _applicationFactory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.ConfigureLogging(builder => builder.AddXunit());

            builder.ConfigureServices(services =>
            {
                services.Configure<CatalogConfiguration>(options =>
                {
                    options.Path = _booksPath;
                    options.CompletedPath = _booksCompletedPath;
                    options.IndexPath = _indexPath;
                    options.AuthToken = authToken;
                    options.RefreshPeriod = refreshPeriod ?? options.RefreshPeriod;
                    options.CopyBooksToCache = copyBooksToCache ?? options.CopyBooksToCache;
                });
            });
        });
    }

    public CancellationToken CancellationToken { get; }
    public CatalogService CatalogService => _applicationFactory.Services.GetRequiredService<CatalogService>();
    public CatalogIndexerService CatalogIndexerService => _applicationFactory.Services.GetRequiredService<CatalogIndexerService>();
    public FullPath BooksCachePath => _indexPath / CatalogService.BookFilesCacheDirectoryName;

    public void SetAuthToken(string? token)
    {
        _authToken = token;
    }

    public HttpClient CreateClient()
    {
        return _applicationFactory.CreateClient();
    }

    public async Task RunIndexer()
    {
        var service = _applicationFactory.Services.GetServices<IHostedService>().OfType<CatalogIndexerService>().Single();
        await service.WaitForFirstIndexation();
    }

    public void AddBook(string name, int pageCount = 2)
    {
        var path = _booksPath / name;
        AddBookCore(pageCount, path);
    }

    private static void AddBookCore(int pageCount, FullPath path)
    {
        path.CreateParentDirectory();
        using var ms = new MemoryStream();
        using (var content = new ZipArchive(ms, ZipArchiveMode.Create))
        {
            for (var i = 0; i < pageCount; i++)
            {
                var entry = content.CreateEntry($"page{i}.png");
                using var stream = entry.Open();
                stream.Write(Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQAAAAA3bvkkAAAACklEQVR4AWNgAAAAAgABc3UBGAAAAABJRU5ErkJggg=="));
            }
        }

        File.WriteAllBytes(path, ms.ToArray());
    }

    public async Task<(string Url, byte[] Data)> GetPageData(string path, int page)
    {
        var url = $"/api/v1/books/{Uri.EscapeDataString(path)}/pages/{page}";
        using var client = _applicationFactory.CreateDefaultClient();

        if (_authToken is not null)
        {
            client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", _authToken);
        }

        var data = await client.GetByteArrayAsync(url, CancellationToken);
        return (url, data);
    }

    public async ValueTask DisposeAsync()
    {
        await _applicationFactory.DisposeAsync();
        if (_booksFolder is not null)
        {
            await _booksFolder.DisposeAsync();
        }

        if (_booksCompletedFolder is not null)
        {
            await _booksCompletedFolder.DisposeAsync();
        }

        if (_indexFolder is not null)
        {
            await _indexFolder.DisposeAsync();
        }
    }

    private static FullPath InitializePath(FullPath? path, out TemporaryDirectory? temporaryDirectory)
    {
        if (path is { } value)
        {
            temporaryDirectory = null;
            return value;
        }

        temporaryDirectory = TemporaryDirectory.Create();
        return temporaryDirectory.FullPath;
    }
}
