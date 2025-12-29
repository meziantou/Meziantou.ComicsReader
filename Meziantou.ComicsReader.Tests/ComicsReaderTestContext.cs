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
    private readonly TemporaryDirectory _booksFolder = TemporaryDirectory.Create();
    private readonly TemporaryDirectory _booksCompletedFolder = TemporaryDirectory.Create();
    private readonly TemporaryDirectory _indexFolder = TemporaryDirectory.Create();

    private readonly WebApplicationFactory<Program> _applicationFactory;
    private string? _authToken;

    [SuppressMessage("Reliability", "CA2000:Dispose objects before losing scope")]
    public ComicsReaderTestContext(string? authToken = null)
    {
        CancellationToken = TestContext.Current.CancellationToken;

        _applicationFactory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.ConfigureLogging(builder => builder.AddXunit());

            builder.ConfigureServices(services =>
            {
                services.Configure<CatalogConfiguration>(options =>
                {
                    options.Path = _booksFolder.FullPath;
                    options.CompletedPath = _booksCompletedFolder.FullPath;
                    options.IndexPath = _indexFolder.FullPath;
                    options.AuthToken = authToken;
                });
            });
        });
    }

    public CancellationToken CancellationToken { get; }
    public CatalogService CatalogService => _applicationFactory.Services.GetRequiredService<CatalogService>();

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
        var path = _booksFolder.FullPath / name;
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
        await _booksFolder.DisposeAsync();
        await _booksCompletedFolder.DisposeAsync();
        await _indexFolder.DisposeAsync();
    }
}
