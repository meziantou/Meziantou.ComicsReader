#pragma warning disable MA0048 // File name must match type name
namespace Meziantou.ComicsReader.Api;

// Request DTOs
public sealed record UpdateReadingProgressRequest(int PageIndex);

// Response DTOs
public sealed record BooksResponse(int TotalCount, BookResponse[] Books);

public sealed record BookResponse(
    string Path,
    string Title,
    int PageCount,
    long FileSize,
    string? CoverImageFileName,
    string? Directory,
    string? FirstDirectory,
    int? CurrentPage,
    bool IsCompleted,
    DateTimeOffset? LastRead);

public sealed record PagesResponse(int TotalCount, PageInfo[] Pages);

public sealed record PageInfo(int Index, string FileName);

public sealed record ReadingListResponse(int TotalCount, ReadingListItemResponse[] Items);

public sealed record ReadingListItemResponse(
    string BookPath,
    int PageIndex,
    bool Completed,
    DateTimeOffset LastRead,
    BookResponse? Book);

public sealed record ReadingHistoryResponse(int TotalCount, ReadingHistoryItemResponse[] Items);

public sealed record ReadingHistoryItemResponse(
    string BookPath,
    DateTimeOffset CompletedAt,
    string? BookTitle);

public sealed record IndexingStatusResponse(
    DateTimeOffset LastIndexationDate,
    bool IsInProgress,
    bool FirstIndexationCompleted,
    int ErrorCount,
    IndexingErrorResponse[] Errors);

public sealed record IndexingErrorResponse(string Path, string Message);

public sealed record VersionResponse(string Version);
