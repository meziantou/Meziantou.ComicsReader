using System.Reflection;
using Meziantou.ComicsReader.CatalogServices;
using Meziantou.Framework;
using Microsoft.Extensions.DependencyInjection;

namespace Meziantou.ComicsReader.Tests;

public sealed class CatalogServiceTests
{
    [Fact]
    public async Task EmptyCompleted()
    {
        await using var context = new ComicsReaderTestContext();
        context.AddBook("book1.cbz");
        context.AddBook("book2.cbz");

        await context.RunIndexer();
        var next = await context.CatalogService.GetNextBooksToRead();
        Assert.Empty(next);
    }

    [Fact]
    public async Task CompletedNotInFolder()
    {
        await using var context = new ComicsReaderTestContext();
        context.AddBook("book1.cbz");
        context.AddBook("book2.cbz");

        await context.RunIndexer();
        await context.CatalogService.MarkAsRead(new CatalogItemPath("book1.cbz"));
        var next = await context.CatalogService.GetNextBooksToRead();
        Assert.Empty(next);
    }

    [Fact]
    public async Task SuggestNextInFolder()
    {
        await using var context = new ComicsReaderTestContext();
        context.AddBook("foo/t01.cbz");
        context.AddBook("foo/t02.cbz");
        context.AddBook("bar/t01.cbz");
        context.AddBook("dummy.cbz");

        await context.RunIndexer();
        await context.CatalogService.MarkAsRead(new CatalogItemPath("foo/t01.cbz"));
        var next = await context.CatalogService.GetNextBooksToRead();
        Assert.Equal(["foo/t02.cbz"], next.Select(item => item.Path.Value));
    }

    [Fact]
    public async Task ReloadCatalog()
    {
        await using var context = new ComicsReaderTestContext();
        context.AddBook("book1.cbz");
        context.AddBook("book2.cbz");

        await context.RunIndexer();
        await (Task)typeof(CatalogService).GetMethod("Load", BindingFlags.NonPublic | BindingFlags.Instance)!.Invoke(context.CatalogService, [])!;

        var books = await context.CatalogService.GetBooks();

        Assert.Equal(2, books.Count);
    }

    [Fact]
    public async Task GetPageData()
    {
        await using var context = new ComicsReaderTestContext();
        var bookPath = "book1.cbz";
        context.AddBook(bookPath, pageCount: 2);

        await context.RunIndexer();
        for (var i = 0; i < 2; i++)
        {
            var (url, data) = await context.GetPageData(bookPath, page: i);
            Assert.NotEmpty(data);
            Assert.Equal($"/api/v1/books/{Uri.EscapeDataString(bookPath)}/pages/{i}", url);
        }
    }

    [Fact]
    public async Task GetPageDataWithValidToken()
    {
        const string Token = "test-secret-token";
        await using var context = new ComicsReaderTestContext(authToken: Token);
        var bookPath = "book1.cbz";
        context.AddBook(bookPath, pageCount: 2);

        await context.RunIndexer();
        
        // Test with valid token
        context.SetAuthToken(Token);
        var (url, data) = await context.GetPageData(bookPath, page: 0);
        Assert.NotEmpty(data);
        Assert.Equal($"/api/v1/books/{Uri.EscapeDataString(bookPath)}/pages/0", url);
    }

    [Fact]
    public async Task GetPageDataWithInvalidTokenShouldFail()
    {
        const string Token = "test-secret-token";
        await using var context = new ComicsReaderTestContext(authToken: Token);
        var bookPath = "book1.cbz";
        context.AddBook(bookPath, pageCount: 2);

        await context.RunIndexer();
        
        // Test with invalid token should throw
        context.SetAuthToken("wrong-token");
        await Assert.ThrowsAsync<HttpRequestException>(async () =>
        {
            await context.GetPageData(bookPath, page: 0);
        });
    }

    [Fact]
    public async Task GetPageDataWithoutTokenWhenRequiredShouldFail()
    {
        const string Token = "test-secret-token";
        await using var context = new ComicsReaderTestContext(authToken: Token);
        var bookPath = "book1.cbz";
        context.AddBook(bookPath, pageCount: 2);

        await context.RunIndexer();
        
        // Test without token when required should throw
        context.SetAuthToken(null);
        await Assert.ThrowsAsync<HttpRequestException>(async () =>
        {
            await context.GetPageData(bookPath, page: 0);
        });
    }

    [Fact]
    public async Task GetPageDataWithoutTokenWhenNotRequiredShouldSucceed()
    {
        // No token configured in settings
        await using var context = new ComicsReaderTestContext(authToken: null);
        var bookPath = "book1.cbz";
        context.AddBook(bookPath, pageCount: 2);

        await context.RunIndexer();
        
        // Test without token when not required should succeed
        var (url, data) = await context.GetPageData(bookPath, page: 0);
        Assert.NotEmpty(data);
        Assert.Equal($"/api/v1/books/{Uri.EscapeDataString(bookPath)}/pages/0", url);
    }
}
