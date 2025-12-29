using System.Reflection;
using Meziantou.ComicsReader.CatalogServices;
using Microsoft.Extensions.Options;

namespace Meziantou.ComicsReader.Api;

internal static class ApiEndpoints
{
    public static void MapApiEndpoints(this WebApplication app)
    {
        var api = app.MapGroup("/api/v1");

        // Books
        api.MapGet("/books", GetBooks);
        api.MapGet("/books/{path}/info", GetBookInfo);
        api.MapGet("/books/{path}/pages", GetBookPages);
        api.MapGet("/books/{path}/pages/{pageIndex:int}", GetPage);
        api.MapGet("/books/{path}/cover", GetCover);
        api.MapPost("/books/{path}/mark-as-read", MarkAsRead);

        // Reading progress
        api.MapGet("/reading-list", GetReadingList);
        api.MapGet("/reading-list/{path}", GetReadingListItem);
        api.MapPut("/reading-list/{path}", UpdateReadingProgress);
        api.MapDelete("/reading-list/{path}", RemoveFromReadingList);

        // History
        api.MapGet("/history", GetReadingHistory);

        // Indexing
        api.MapGet("/indexing/status", GetIndexingStatus);
        api.MapPost("/indexing/reindex", TriggerReindex);

        // Version
        api.MapGet("/version", GetVersion);
    }

    private static bool TryParseBookPath(string value, [NotNullWhen(true)] out CatalogItemPath? result)
    {
        // ASP.NET Core doesn't decode slashes in route parameters, so we need to replace %2f with /
        value = value.Replace("%2f", "/", StringComparison.OrdinalIgnoreCase);
        return CatalogItemPath.TryParse(value, out result);
    }

    /// <summary>Get all books in the catalog</summary>
    private static async Task<IResult> GetBooks(
        CatalogService catalog,
        string? search = null,
        string? filter = null)
    {
        var books = await catalog.GetBooks();

        // Apply filter
        if (filter is "one-shot")
        {
            books = [.. books.Where(book => book.Path.Directory is null)];
        }
        else if (filter is "series")
        {
            books = [.. books.Where(book => book.Path.Directory is not null)];
        }

        // Apply search
        if (!string.IsNullOrEmpty(search))
        {
            books = [.. books.Where(book => book.Path.Value.Contains(search, StringComparison.OrdinalIgnoreCase) || book.Title.Contains(search, StringComparison.OrdinalIgnoreCase))];
        }

        var readingList = await catalog.GetReadingList();
        var response = books.Select(book =>
        {
            var readingItem = readingList.FirstOrDefault(r => r.BookPath == book.Path);
            return MapToBookResponse(book, readingItem);
        });

        return Results.Ok(new BooksResponse(books.Count, [.. response]));
    }

    /// <summary>Get a specific book by path</summary>
    private static async Task<IResult> GetBookInfo(
        CatalogService catalog,
        string path)
    {
        if (!TryParseBookPath(path, out var catalogPath))
            return Results.BadRequest("Invalid path format");

        var book = await catalog.GetBook(catalogPath);
        if (book is null)
            return Results.NotFound();

        var readingItem = await catalog.GetReadingListItem(catalogPath);
        return Results.Ok(MapToBookResponse(book, readingItem));
    }

    /// <summary>Get all pages of a book</summary>
    private static async Task<IResult> GetBookPages(
        CatalogService catalog,
        string path)
    {
        if (!TryParseBookPath(path, out var catalogPath))
            return Results.BadRequest("Invalid path format");

        var book = await catalog.GetBook(catalogPath);
        if (book is null)
            return Results.NotFound();

        var pages = book.GetImageFileNames()
            .Select((fileName, index) => new PageInfo(index, fileName))
            .ToArray();

        return Results.Ok(new PagesResponse(pages.Length, pages));
    }

    /// <summary>Get a specific page image from a book</summary>
    [SuppressMessage("Reliability", "CA2000:Dispose objects before losing scope")]
    private static async Task<IResult> GetPage(
        HttpContext context,
        CatalogService catalog,
        string path,
        int pageIndex)
    {
        if (!TryParseBookPath(path, out var catalogPath))
            return Results.BadRequest("Invalid path format");

        var book = await catalog.GetBook(catalogPath);
        if (book is null)
            return Results.NotFound();

        if (pageIndex < 0 || pageIndex >= book.PageCount)
            return Results.BadRequest($"Page index must be between 0 and {book.PageCount - 1}");

        var pageName = book.GetFileNameFromPageIndex(pageIndex);

        // Cache for 1 hour
        context.Response.Headers.CacheControl = new Microsoft.Extensions.Primitives.StringValues("max-age=3600");

        var stream = await catalog.GetPageStream(book, pageIndex);
        return Results.Stream(stream, fileDownloadName: pageName);
    }

    /// <summary>Get cover image for a book</summary>
    private static async Task<IResult> GetCover(
        HttpContext context,
        CatalogService catalog,
        IOptions<CatalogConfiguration> options,
        string path)
    {
        if (!TryParseBookPath(path, out var catalogPath))
            return Results.BadRequest("Invalid path format");

        var book = await catalog.GetBook(catalogPath);
        if (book is null)
            return Results.NotFound();

        if (string.IsNullOrEmpty(book.CoverImageFileName))
            return Results.NotFound("No cover image available");

        if (options.Value.CoverImagesPath.IsEmpty)
            return Results.NotFound("Cover images path not configured");

        var fullPath = options.Value.CoverImagesPath / book.CoverImageFileName;
        if (!File.Exists(fullPath))
            return Results.NotFound();

        // Cache forever (immutable)
        context.Response.Headers.CacheControl = new Microsoft.Extensions.Primitives.StringValues("public, max-age=31536000, immutable");

        return Results.File(fullPath);
    }

    /// <summary>Get reading list (books in progress)</summary>
    private static async Task<IResult> GetReadingList(
        CatalogService catalog,
        bool includeCompleted = false)
    {
        return await GetReadingListResponse(catalog, includeCompleted);
    }

    /// <summary>Get reading list item for a specific book</summary>
    private static async Task<IResult> GetReadingListItem(
        CatalogService catalog,
        string path)
    {
        if (!TryParseBookPath(path, out var catalogPath))
            return Results.BadRequest("Invalid path format");

        var readingItem = await catalog.GetReadingListItem(catalogPath);
        if (readingItem is null)
            return Results.NotFound();

        var book = await catalog.GetBook(catalogPath);

        return Results.Ok(new ReadingListItemResponse(
            readingItem.BookPath.Value,
            readingItem.PageIndex,
            readingItem.Completed,
            readingItem.LastRead,
            book is not null ? MapToBookResponse(book, readingItem) : null));
    }

    /// <summary>Update reading progress for a book</summary>
    private static async Task<IResult> UpdateReadingProgress(
        CatalogService catalog,
        string path,
        UpdateReadingProgressRequest request)
    {
        if (!TryParseBookPath(path, out var catalogPath))
            return Results.BadRequest("Invalid path format");

        var book = await catalog.GetBook(catalogPath);
        if (book is null)
            return Results.NotFound();

        if (request.PageIndex < 0 || request.PageIndex >= book.PageCount)
            return Results.BadRequest($"Page index must be between 0 and {book.PageCount - 1}");

        await catalog.UpdateReadingProgress(catalogPath, request.PageIndex);

        return await GetReadingListResponse(catalog);
    }

    /// <summary>Remove a book from reading list</summary>
    private static async Task<IResult> RemoveFromReadingList(
        CatalogService catalog,
        string path)
    {
        if (!TryParseBookPath(path, out var catalogPath))
            return Results.BadRequest("Invalid path format");

        await catalog.RemoveFromReadingList(catalogPath);

        return await GetReadingListResponse(catalog);
    }

    /// <summary>Helper method to get reading list response</summary>
    private static async Task<IResult> GetReadingListResponse(CatalogService catalog, bool includeCompleted = false)
    {
        var books = await catalog.GetBooks();
        var readingList = await catalog.GetReadingList();

        var items = readingList
            .Where(item => includeCompleted || !item.Completed)
            .Where(item => books.Find(item.BookPath) is not null) // Filter out books not in catalog
            .OrderByDescending(item => item.LastRead)
            .Select(item =>
            {
                var book = books.Find(item.BookPath)!; // Safe because we filtered above
                return new ReadingListItemResponse(
                    item.BookPath.Value,
                    item.PageIndex,
                    item.Completed,
                    item.LastRead,
                    MapToBookResponse(book, item));
            })
            .ToArray();

        return Results.Ok(new ReadingListResponse(items.Length, items));
    }

    /// <summary>Mark a book as read (completed)</summary>
    private static async Task<IResult> MarkAsRead(
        CatalogService catalog,
        string path)
    {
        if (!TryParseBookPath(path, out var catalogPath))
            return Results.BadRequest("Invalid path format");

        var book = await catalog.GetBook(catalogPath);
        if (book is null)
            return Results.NotFound();

        await catalog.MarkAsRead(catalogPath);

        return Results.Ok();
    }

    /// <summary>Get reading history (completed books)</summary>
    private static async Task<IResult> GetReadingHistory(
        CatalogService catalog)
    {
        var books = await catalog.GetBooks();
        var readingList = await catalog.GetReadingList();

        var history = readingList
            .Where(item => item.Completed)
            .OrderByDescending(item => item.LastRead)
            .Select(item =>
            {
                var book = books.Find(item.BookPath);
                return new ReadingHistoryItemResponse(
                    item.BookPath.Value,
                    item.LastRead,
                    book?.Title);
            })
            .ToArray();

        return Results.Ok(new ReadingHistoryResponse(history.Length, history));
    }

    /// <summary>Get indexing status</summary>
    private static async Task<IResult> GetIndexingStatus(
        CatalogService catalog,
        CatalogIndexerService indexer)
    {
        var lastIndexationDate = await catalog.GetLastIndexationDate();
        var errors = await catalog.GetIndexationErrors();
        var isInProgress = indexer.IndexationInProgress;
        var firstIndexationCompleted = indexer.FirstIndexationCompleted;

        var errorResponses = errors.Select(e => new IndexingErrorResponse(e.Path.Value, e.Message)).ToArray();

        return Results.Ok(new IndexingStatusResponse(
            lastIndexationDate,
            isInProgress,
            firstIndexationCompleted,
            errorResponses.Length,
            errorResponses));
    }

    /// <summary>Trigger a reindex</summary>
    private static IResult TriggerReindex(CatalogIndexerService indexer)
    {
        if (indexer.IndexationInProgress)
            return Results.Conflict("Indexation already in progress");

        _ = indexer.Reindex();

        return Results.Accepted();
    }

    /// <summary>Get version information</summary>
    private static IResult GetVersion()
    {
        var assembly = typeof(ApiEndpoints).Assembly;
        var version = assembly.GetName().Version?.ToString() ?? "unknown";
        var informationalVersion = assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? version;

        return Results.Ok(new VersionResponse(informationalVersion));
    }

    private static BookResponse MapToBookResponse(Book book, ReadingListItem? readingItem)
    {
        return new BookResponse(
            book.Path.Value,
            book.Title,
            book.PageCount,
            book.FileSize,
            book.CoverImageFileName,
            book.Path.Directory,
            book.Path.FirstDirectory,
            readingItem?.PageIndex,
            readingItem?.Completed ?? false,
            readingItem?.LastRead);
    }
}
