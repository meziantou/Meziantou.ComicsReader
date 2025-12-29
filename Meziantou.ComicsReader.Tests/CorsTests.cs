using System.Net;
using System.Net.Http.Json;

namespace Meziantou.ComicsReader.Tests;
public sealed class CorsTests
{
    [Fact]
    public async Task CorsHeaders_ArePresent_OnGetRequest()
    {
        await using var context = new ComicsReaderTestContext();
        context.AddBook("book1.cbz");
        await context.RunIndexer();

        using var client = context.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/books");
        request.Headers.Add("Origin", "https://example.com");

        using var response = await client.SendAsync(request, context.CancellationToken);

        Assert.True(response.Headers.Contains("Access-Control-Allow-Origin"), "Access-Control-Allow-Origin header should be present");
        Assert.Equal("https://example.com", response.Headers.GetValues("Access-Control-Allow-Origin").First());
    }

    [Fact]
    public async Task CorsHeaders_ArePresent_OnPostRequest()
    {
        await using var context = new ComicsReaderTestContext();
        context.AddBook("book1.cbz");
        await context.RunIndexer();

        using var client = context.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/books/book1.cbz/mark-as-read");
        request.Headers.Add("Origin", "https://example.com");

        using var response = await client.SendAsync(request, context.CancellationToken);

        Assert.True(response.Headers.Contains("Access-Control-Allow-Origin"), "Access-Control-Allow-Origin header should be present");
        Assert.Equal("https://example.com", response.Headers.GetValues("Access-Control-Allow-Origin").First());
    }

    [Fact]
    public async Task CorsHeaders_ArePresent_OnPutRequest()
    {
        await using var context = new ComicsReaderTestContext();
        context.AddBook("book1.cbz");
        await context.RunIndexer();

        using var client = context.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Put, "/api/v1/reading-list/book1.cbz")
        {
            Content = JsonContent.Create(new { PageIndex = 1 }),
        };
        request.Headers.Add("Origin", "https://example.com");

        using var response = await client.SendAsync(request, context.CancellationToken);

        Assert.True(response.Headers.Contains("Access-Control-Allow-Origin"), "Access-Control-Allow-Origin header should be present");
        Assert.Equal("https://example.com", response.Headers.GetValues("Access-Control-Allow-Origin").First());
    }

    [Fact]
    public async Task CorsHeaders_ArePresent_OnDeleteRequest()
    {
        await using var context = new ComicsReaderTestContext();
        context.AddBook("book1.cbz");
        await context.RunIndexer();

        using var client = context.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Delete, "/api/v1/reading-list/book1.cbz");
        request.Headers.Add("Origin", "https://example.com");

        using var response = await client.SendAsync(request, context.CancellationToken);

        Assert.True(response.Headers.Contains("Access-Control-Allow-Origin"), "Access-Control-Allow-Origin header should be present");
        Assert.Equal("https://example.com", response.Headers.GetValues("Access-Control-Allow-Origin").First());
    }

    [Fact]
    public async Task PreflightRequest_ReturnsCorrectHeaders()
    {
        await using var context = new ComicsReaderTestContext();

        using var client = context.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Options, "/api/v1/books");
        request.Headers.Add("Origin", "https://example.com");
        request.Headers.Add("Access-Control-Request-Method", "GET");
        request.Headers.Add("Access-Control-Request-Headers", "content-type");

        using var response = await client.SendAsync(request, context.CancellationToken);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.True(response.Headers.Contains("Access-Control-Allow-Origin"), "Access-Control-Allow-Origin header should be present");
        Assert.Equal("https://example.com", response.Headers.GetValues("Access-Control-Allow-Origin").First());
        Assert.True(response.Headers.Contains("Access-Control-Allow-Methods"), "Access-Control-Allow-Methods header should be present");
        Assert.True(response.Headers.Contains("Access-Control-Allow-Headers"), "Access-Control-Allow-Headers header should be present");
    }

    [Fact]
    public async Task CorsHeaders_AllowAnyOrigin()
    {
        await using var context = new ComicsReaderTestContext();
        context.AddBook("book1.cbz");
        await context.RunIndexer();

        using var client = context.CreateClient();

        var origins = new[] { "https://example.com", "http://localhost:3000", "https://api.test.com" };

        foreach (var origin in origins)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/books");
            request.Headers.Add("Origin", origin);

            using var response = await client.SendAsync(request, context.CancellationToken);

            Assert.True(response.Headers.Contains("Access-Control-Allow-Origin"), $"Access-Control-Allow-Origin header should be present for origin {origin}");
            Assert.Equal(origin, response.Headers.GetValues("Access-Control-Allow-Origin").First());
        }
    }
}
