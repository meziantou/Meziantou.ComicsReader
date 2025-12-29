using System.Collections.Immutable;
using System.Diagnostics;
using System.IO.Compression;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;
using Meziantou.Framework;
using Meziantou.Framework.Threading;
using Microsoft.Extensions.Options;
using Polly;

namespace Meziantou.ComicsReader.CatalogServices;

internal sealed partial class CatalogService(IOptions<CatalogConfiguration> options)
{
    private const string CatalogFileName = "catalog.json.gz";
    private const string ReadingListFileName = "readinglist.json.gz";

    private static readonly Policy RetryPolicy = Policy.Handle<Exception>().WaitAndRetry(3, retryAttempt => TimeSpan.FromSeconds(Math.Pow(2, retryAttempt)));

    private readonly BookContentCache _cache = new(FullPath.GetTempPath() / "books_cache");
    private readonly AsyncLock _lock = new();
    private Catalog? _catalog;

    private async Task PersistCatalog()
    {
        using (ComicsReaderActivitySource.Instance.StartActivity("Save catalog"))
        {
            var fullPath = options.Value.IndexPath / CatalogFileName;
            var tempFullPath = options.Value.IndexPath / (CatalogFileName + ".tmp");
            fullPath.CreateParentDirectory();
            await using (var stream = File.Create(tempFullPath))
            await using (var gz = new GZipStream(stream, CompressionLevel.Optimal))
            {
                var item = _catalog is null ? null : new PersistedCatalog(_catalog.LastIndexationDate, _catalog.Books, _catalog.IndexingErrors);
                await JsonSerializer.SerializeAsync(gz, item, CatalogJsonContext.Default.PersistedCatalog);
            }

            RetryPolicy.Execute(() => File.Move(tempFullPath, fullPath, overwrite: true));
        }
    }

    private async Task PersistReadingList()
    {
        using (ComicsReaderActivitySource.Instance.StartActivity("Save reading list"))
        {
            var fullPath = options.Value.IndexPath / ReadingListFileName;
            var tempFullPath = options.Value.IndexPath / (ReadingListFileName + ".tmp");
            fullPath.CreateParentDirectory();
            await using (var stream = File.Create(tempFullPath))
            await using (var gz = new GZipStream(stream, CompressionLevel.Optimal))
            {
                var item = _catalog is null ? null : new PersistedReadingList(_catalog.ReadingList);
                await JsonSerializer.SerializeAsync(gz, item, CatalogJsonContext.Default.PersistedReadingList);
            }

            RetryPolicy.Execute(() => File.Move(tempFullPath, fullPath, overwrite: true));
        }
    }

    private async Task Load()
    {
        using (ComicsReaderActivitySource.Instance.StartActivity("Load index"))
        {
            _catalog = new Catalog();
            var persistedCatalog = await Deserialize(options.Value.IndexPath / CatalogFileName, CatalogJsonContext.Default.PersistedCatalog);
            var persistedReadingList = await Deserialize(options.Value.IndexPath / ReadingListFileName, CatalogJsonContext.Default.PersistedReadingList);

            if (persistedCatalog is not null)
            {
                _catalog.LastIndexationDate = persistedCatalog.LastIndexationDate;
                _catalog.IndexingErrors = persistedCatalog.IndexingErrors;
                _catalog.SetBooks(persistedCatalog.Books);
            }

            if (persistedReadingList is not null)
            {
                _catalog.ReadingList = persistedReadingList.Items;
            }

            static Task<T?> Deserialize<T>(FullPath path, JsonTypeInfo<T> jsonTypeInfo) where T : class
            {
                return Policy.Handle<Exception>()
                    .WaitAndRetryAsync(3, retryAttempt => TimeSpan.FromSeconds(Math.Pow(2, retryAttempt)))
                    .ExecuteAsync(async () =>
                    {
                        try
                        {
                            await using var stream = File.OpenRead(path);
                            await using var gz = new GZipStream(stream, CompressionMode.Decompress);
                            return await JsonSerializer.DeserializeAsync(gz, jsonTypeInfo);
                        }
                        catch (FileNotFoundException)
                        {
                            return null;
                        }
                        catch (DirectoryNotFoundException)
                        {
                            return null;
                        }
                    });
            }
        }

        var lastBook = _catalog.ReadingList.Where(item => !item.Completed).MaxBy(item => item.LastRead);
        if (lastBook is not null)
        {
            _cache.CacheBook(GetBookPath(lastBook.BookPath));
        }
    }

    [MemberNotNull(nameof(_catalog))]
    private async Task LoadIfNeeded()
    {
        if (_catalog is not null)
            return;

#pragma warning disable CS8774 // Member must have a non-null value when exiting.
        await Load();
#pragma warning restore CS8774

        Debug.Assert(_catalog is not null);
    }

    public async Task<IReadOnlyCollection<IndexingError>> GetIndexationErrors()
    {
        var catalog = _catalog;
        if (catalog is null)
        {
            using (await _lock.LockAsync())
            {
                await LoadIfNeeded();
                catalog = _catalog;
            }
        }

        return catalog.IndexingErrors;
    }

    public async Task AddIndexingError(CatalogItemPath path, string message)
    {
        using (await _lock.LockAsync())
        {
            await LoadIfNeeded();
            _catalog.IndexingErrors = _catalog.IndexingErrors.Add(new IndexingError
            {
                Path = path,
                Message = message,
            });

            await PersistCatalog();
        }
    }

    public async Task AddOrUpdateBookToCatalog(Book book)
    {
        using (await _lock.LockAsync())
        {
            await LoadIfNeeded();

            var existingBook = _catalog.Books.Find(book.Path);
            if (existingBook is not null)
            {
                _catalog.SetBooks(_catalog.Books.Replace(existingBook, book));
            }
            else
            {
                _catalog.SetBooks(_catalog.Books.Add(book));
            }

            _catalog.IndexingErrors = _catalog.IndexingErrors.RemoveAll(item => item.Path == book.Path);
            await PersistCatalog();
        }
    }

    public async Task RemoveBookFromCatalog(CatalogItemPath path)
    {
        using (await _lock.LockAsync())
        {
            await LoadIfNeeded();
            var existingBook = _catalog.Books.Find(path);
            if (existingBook is not null)
            {
                _catalog.SetBooks(_catalog.Books.Remove(existingBook));
                _catalog.ReadingList = _catalog.ReadingList.RemoveAll(item => item.BookPath == path);
            }

            _catalog.IndexingErrors = _catalog.IndexingErrors.RemoveAll(item => item.Path == path);
            await PersistCatalog();
        }
    }

    public async Task<IReadOnlyCollection<Book>> GetBooks()
    {
        var catalog = _catalog;
        if (catalog is null)
        {
            using (await _lock.LockAsync())
            {
                await LoadIfNeeded();
                catalog = _catalog;
            }
        }

        return catalog.Books;
    }

    public async Task<Book?> GetBook(CatalogItemPath path)
    {
        var catalog = _catalog;
        if (catalog is null)
        {
            using (await _lock.LockAsync())
            {
                await LoadIfNeeded();
                catalog = _catalog;
            }
        }

        return catalog.Books.Find(path);
    }

    public async Task<IReadOnlyCollection<Book>> GetNextBooksToRead()
    {
        var catalog = _catalog;
        if (catalog is null)
        {
            using (await _lock.LockAsync())
            {
                await LoadIfNeeded();
                catalog = _catalog;
            }
        }

        var result = new List<Book>();

        var completedBooks = catalog.ReadingList.Where(item => item.Completed).OrderByDescending(item => item.LastRead).ToArray();
        foreach (var completedBook in completedBooks)
        {
            var directory = completedBook.BookPath.Directory;
            if (directory is null)
                continue;

            // Files in the same directory
            foreach (var item in catalog.Books.Where(book => book.Path.Directory == directory))
            {
                if (!completedBooks.Any(completedBook => completedBook.BookPath == item.Path))
                {
                    AddBook(item);
                }
            }

            // File in child directories
            if (result.Count is 0)
            {
                foreach (var item in catalog.Books.Where(book => book.Path.Directory?.StartsWith(directory, StringComparison.Ordinal) is true))
                {
                    if (!completedBooks.Any(completedBook => completedBook.BookPath == item.Path))
                    {
                        AddBook(item);
                    }
                }
            }

            // File in parent directories
            if (result.Count is 0)
            {
                foreach (var item in catalog.Books.Where(book => book.Path.FirstDirectory == completedBook.BookPath.FirstDirectory))
                {
                    if (!completedBooks.Any(completedBook => completedBook.BookPath == item.Path))
                    {
                        AddBook(item);
                    }
                }
            }
        }

        return [.. result.Distinct().OrderBy(book => book.Path, NaturalSortStringComparer.OrdinalIgnoreCase)];

        void AddBook(Book book)
        {
            // Do not add a book which is already in progress
            if (catalog.ReadingList.Any(reading => !reading.Completed && reading.BookPath == book.Path))
                return;

            result.Add(book);
        }
    }

    public async Task<IReadOnlyCollection<ReadingListItem>> GetReadingList()
    {
        var catalog = _catalog;
        if (catalog is null)
        {
            using (await _lock.LockAsync())
            {
                await LoadIfNeeded();
                catalog = _catalog;
            }
        }

        return catalog.ReadingList;
    }

    public async Task<ReadingListItem?> GetReadingListItem(CatalogItemPath path)
    {
        var catalog = _catalog;
        if (catalog is null)
        {
            using (await _lock.LockAsync())
            {
                await LoadIfNeeded();
                catalog = _catalog;
            }
        }

        return catalog.ReadingList.FirstOrDefault(item => item.BookPath == path);
    }

    public async Task RemoveFromReadingList(CatalogItemPath path)
    {
        using (await _lock.LockAsync())
        {
            await LoadIfNeeded();
            _catalog.ReadingList = _catalog.ReadingList.RemoveAll(item => item.BookPath == path);

            await PersistReadingList();
        }
    }

    public async Task UpdateReadingProgress(CatalogItemPath path, int pageIndex)
    {
        using (await _lock.LockAsync())
        {
            await LoadIfNeeded();
            _catalog.ReadingList = _catalog.ReadingList.RemoveAll(item => item.BookPath == path).Add(new ReadingListItem
            {
                BookPath = path,
                PageIndex = pageIndex,
                Completed = false,
                LastRead = DateTimeOffset.UtcNow,
            });

            await PersistReadingList();
        }
    }

    public async Task MarkAsRead(CatalogItemPath path)
    {
        using (await _lock.LockAsync())
        {
            await LoadIfNeeded();

            // Move items to completed directory
            if (!options.Value.CompletedPath.IsEmpty)
            {
                var originalPath = GetBookPath(path);
                var completedPath = options.Value.CompletedPath / path;
                completedPath.CreateParentDirectory();
                RetryPolicy.Execute(() => File.Move(originalPath, completedPath));

                var existingBook = _catalog.Books.Find(path);
                if (existingBook is not null)
                {
                    _catalog.SetBooks(_catalog.Books.Remove(existingBook));
                }
            }

            _catalog.ReadingList = _catalog.ReadingList.RemoveAll(item => item.BookPath == path).Add(new ReadingListItem
            {
                BookPath = path,
                PageIndex = -1,
                Completed = true,
                LastRead = DateTimeOffset.UtcNow,
            });

            await PersistReadingList();

            _cache.Cleanup(GetBookPath(path));
        }
    }

    public Task<Stream> GetPageStream(Book book, int pageIndex)
    {
        using var activity = ComicsReaderActivitySource.Instance.StartActivity("Load page");
        activity?.AddTag("BookPath", book.Path.Value);
        activity?.AddTag("PageIndex", pageIndex);

        var pageName = book.GetFileNameFromPageIndex(pageIndex);
        var bookPath = GetBookPath(book.Path);

        var cacheFile = _cache.GetCacheFilePath(bookPath, pageName);
        return Task.FromResult<Stream>(File.OpenRead(cacheFile));
    }

    private FullPath GetBookPath(CatalogItemPath path)
    {
        return options.Value.Path / path.Value;
    }

    public async Task<DateTimeOffset> GetLastIndexationDate()
    {
        using (await _lock.LockAsync())
        {
            await LoadIfNeeded();
            return _catalog.LastIndexationDate = DateTimeOffset.UtcNow;
        }
    }

    public async Task CompleteIndexation()
    {
        using (await _lock.LockAsync())
        {
            await LoadIfNeeded();
            _catalog.LastIndexationDate = DateTimeOffset.UtcNow;
            await PersistCatalog();
        }
    }

    [JsonSerializable(typeof(Catalog))]
    [JsonSerializable(typeof(PersistedCatalog))]
    [JsonSerializable(typeof(PersistedReadingList))]
    internal sealed partial class CatalogJsonContext : JsonSerializerContext
    {
    }

    internal sealed record PersistedCatalog(DateTimeOffset LastIndexationDate, ImmutableArray<Book> Books, ImmutableArray<IndexingError> IndexingErrors);
    internal sealed record PersistedReadingList(ImmutableArray<ReadingListItem> Items);
}
