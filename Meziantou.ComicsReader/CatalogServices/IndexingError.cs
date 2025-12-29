namespace Meziantou.ComicsReader.CatalogServices;

internal sealed class IndexingError
{
    public required CatalogItemPath Path { get; init; }
    public required string Message { get; init; }
}