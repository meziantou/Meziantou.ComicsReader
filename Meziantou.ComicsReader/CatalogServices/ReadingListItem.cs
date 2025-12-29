namespace Meziantou.ComicsReader.CatalogServices;

public sealed class ReadingListItem
{
    public required CatalogItemPath BookPath { get; init; }
    public required int PageIndex { get; init; }
    public required bool Completed { get; init; }
    public required DateTimeOffset LastRead { get; init; }
}
