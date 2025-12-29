#pragma warning disable CA1848 // Use the LoggerMessage delegates
using System.IO.Compression;
using System.Security.Cryptography;
using System.Diagnostics;
using Meziantou.Framework;
using Microsoft.Extensions.Options;

namespace Meziantou.ComicsReader.CatalogServices;

internal sealed class CatalogIndexerService(IOptions<CatalogConfiguration> options, CatalogService catalogService, ILogger<CatalogIndexerService> logger) : BackgroundService
{
    private readonly TaskCompletionSource _firstIndexationTcs = new();
    private readonly Lock _lock = new();
    private Task? _currentIndexationTask;

    public bool IndexationInProgress => _currentIndexationTask is not null;

    public bool FirstIndexationCompleted => _firstIndexationTcs.Task.IsCompletedSuccessfully;

    public Task WaitForFirstIndexation() => _firstIndexationTcs.Task;

    public Task Reindex()
    {
        return Index(CancellationToken.None);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            await Index(stoppingToken);
            await Task.Delay(options.Value.RefreshPeriod, stoppingToken);
        }
    }

    private async Task<FullPath?> ExtractAndResizeCoverImage(FullPath bookPath, ZipArchive archive, string firstImageFileName, CancellationToken cancellationToken)
    {
        try
        {
            var entry = archive.GetEntry(firstImageFileName);
            if (entry is null)
                return null;

            // Create cover image filename based on book hash
            var hash = Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(bookPath.Value)));
            var coverFileName = $"{hash}.avif";
            var coverPath = options.Value.CoverImagesPath / coverFileName;

            // Extract the image to a temporary file
            var tempInputFile = FullPath.GetTempFileName();
            try
            {
                await using (var entryStream = await entry.OpenAsync(cancellationToken))
                await using (var tempFileStream = File.Create(tempInputFile))
                {
                    await entryStream.CopyToAsync(tempFileStream, cancellationToken);
                }

                await ResizeImageWithFFmpeg(tempInputFile, coverPath, 600, cancellationToken);

                return coverPath;
            }
            finally
            {
                // Clean up temp file
                try
                {
                    if (File.Exists(tempInputFile))
                    {
                        File.Delete(tempInputFile);
                    }
                }
                catch
                {
                    // Ignore cleanup errors
                }
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Cannot extract cover image from '{BookPath}'", bookPath.Value);
            return null;
        }
    }

    private async Task ResizeImageWithFFmpeg(FullPath inputPath, FullPath outputPath, int maxSize, CancellationToken cancellationToken)
    {
        outputPath.CreateParentDirectory();

        // FFmpeg filter to resize image maintaining aspect ratio, max dimension 600px
        // scale filter with force_original_aspect_ratio=decrease ensures the image fits within maxSize x maxSize
        var arguments = string.Create(CultureInfo.InvariantCulture, $"-i \"{inputPath}\" -vf \"scale='min({maxSize},iw)':'min({maxSize},ih)':force_original_aspect_ratio=decrease\" -q:v 2 -y \"{outputPath}\"");

        var processStartInfo = new ProcessStartInfo
        {
            FileName = "ffmpeg",
            Arguments = arguments,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };

        using var process = new Process { StartInfo = processStartInfo };

        var outputBuilder = new StringBuilder();
        var errorBuilder = new StringBuilder();

        process.OutputDataReceived += (sender, e) =>
        {
            if (e.Data is not null)
            {
                outputBuilder.AppendLine(e.Data);
            }
        };

        process.ErrorDataReceived += (sender, e) =>
        {
            if (e.Data is not null)
            {
                errorBuilder.AppendLine(e.Data);
            }
        };

        process.Start();
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        await process.WaitForExitAsync(cancellationToken);

        if (process.ExitCode != 0)
        {
            var errorMessage = errorBuilder.ToString();
            logger.LogWarning("FFmpeg failed with exit code {ExitCode}. Error: {Error}", process.ExitCode, errorMessage);
            throw new InvalidOperationException($"FFmpeg failed with exit code {process.ExitCode}");
        }
    }

    private Task Index(CancellationToken cancellationToken)
    {
        if (_currentIndexationTask is { } task)
            return task;

        lock (_lock)
        {
            if (_currentIndexationTask is not null)
                return _currentIndexationTask;

            task = Task.Run(Index, cancellationToken).ContinueWith(_ => { lock (_lock) { _currentIndexationTask = null; } }, TaskScheduler.Default);
            _currentIndexationTask = task;
            return task;
        }

        async Task Index()
        {
            using (ComicsReaderActivitySource.Instance.StartActivity("Indexation"))
            {
                logger.LogInformation("Start indexation");
                try
                {
                    var books = await catalogService.GetBooks();
                    var foundBooks = new HashSet<CatalogItemPath>();

                    var path = options.Value.Path;
                    using (ComicsReaderActivitySource.Instance.StartActivity("Index books"))
                    {
                        var indexationErrors = await catalogService.GetIndexationErrors();
                        foreach (var book in Directory.EnumerateFiles(path, "*.cbz", SearchOption.AllDirectories).Select(FullPath.FromPath))
                        {
                            logger.LogTrace("Import book '{Book}'", book);
                            var bookPath = new CatalogItemPath(path, book);
                            foundBooks.Add(bookPath);
                            try
                            {
                                var fileLength = new FileInfo(book).Length;
                                var existingBook = books.Find(bookPath);

                                if (existingBook is not null && existingBook.FileSize == fileLength && !indexationErrors.HasError(bookPath))
                                    continue;

                                await using var fs = File.OpenRead(book);

                                string[] pages;
                                FullPath? coverImagePath = null;
                                await using (var archive = new ZipArchive(fs, ZipArchiveMode.Read, leaveOpen: true))
                                {
                                    pages = [.. archive.Entries.Select(entry => entry.FullName).Order(NaturalSortStringComparer.OrdinalIgnoreCase)];

                                    if (!options.Value.CoverImagesPath.IsEmpty)
                                    {
                                        // Get the first image file as the cover
                                        var firstImageFile = pages.FirstOrDefault(IsImageFile);
                                        if (firstImageFile is not null)
                                        {
                                            coverImagePath = await ExtractAndResizeCoverImage(book, archive, firstImageFile, cancellationToken);
                                        }
                                    }
                                }

                                fs.Seek(0, SeekOrigin.Begin);
                                var hash = await SHA256.HashDataAsync(fs, cancellationToken);
                                var item = new Book
                                {
                                    Path = bookPath,
                                    Title = book.NameWithoutExtension ?? throw new InvalidOperationException($"{book} does not have a name"),
                                    FileSize = fileLength,
                                    FileSha256 = hash,
                                    FileNames = pages,
                                    CoverImageFileName = coverImagePath?.Name,
                                };

                                await catalogService.AddOrUpdateBookToCatalog(item);
                            }
                            catch (Exception ex)
                            {
                                logger.LogError(ex, "Cannot index '{BookPath}'", book.Value);
                                await catalogService.AddIndexingError(bookPath, ex.ToString());
                            }
                        }
                    }

                    using (ComicsReaderActivitySource.Instance.StartActivity("Remove extra books"))
                    {
                        // Remove books that are not in the directory anymore
                        foreach (var book in books)
                        {
                            if (!foundBooks.Contains(book.Path))
                            {
                                await catalogService.RemoveBookFromCatalog(book.Path);
                            }
                        }
                    }

                    using (ComicsReaderActivitySource.Instance.StartActivity("Remove extra cover images"))
                    {
                        // Remove cover image files that are not referenced in the catalog
                        if (!options.Value.CoverImagesPath.IsEmpty && Directory.Exists(options.Value.CoverImagesPath))
                        {
                            var updatedBooks = await catalogService.GetBooks();
                            var referencedCoverImages = new HashSet<string>(updatedBooks
                                .Where(b => !string.IsNullOrEmpty(b.CoverImageFileName))
                                .Select(b => b.CoverImageFileName!), StringComparer.Ordinal);

                            foreach (var coverFile in Directory.EnumerateFiles(options.Value.CoverImagesPath, "*.*", SearchOption.TopDirectoryOnly))
                            {
                                var fileName = Path.GetFileName(coverFile);
                                if (!referencedCoverImages.Contains(fileName))
                                {
                                    try
                                    {
                                        File.Delete(coverFile);
                                        logger.LogInformation("Removed orphaned cover image: {CoverFile}", fileName);
                                    }
                                    catch (Exception ex)
                                    {
                                        logger.LogWarning(ex, "Failed to delete cover image: {CoverFile}", fileName);
                                    }
                                }
                            }
                        }
                    }

                    await catalogService.CompleteIndexation();
                    _firstIndexationTcs.TrySetResult();
                }
                catch (Exception ex)
                {
                    logger.LogError(ex, "Cannot index");
                    _firstIndexationTcs.TrySetException(ex);
                }

                logger.LogInformation("End indexation");
            }
        }
    }

    private static bool IsImageFile(string path)
    {
        var extension = Path.GetExtension(path).ToUpperInvariant();
        return extension is ".JPG" or ".JPEG" or ".PNG" or ".GIF" or ".BMP" or ".AVIF" or ".TIFF" or ".HEIC";
    }
}
