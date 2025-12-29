using System.Collections.Immutable;

namespace Meziantou.ComicsReader.CatalogServices;

internal sealed class Catalog
{
    public DateTimeOffset LastIndexationDate { get; set; }
    public ImmutableArray<Book> Books { get; set; } = [];
    public ImmutableArray<ReadingListItem> ReadingList { get; set; } = [];
    public ImmutableArray<IndexingError> IndexingErrors { get; set; } = [];

    public void SetBooks(IEnumerable<Book> books)
    {
        Books = [.. books.OrderBy(book => book.Path.Value, NaturalSortStringComparer.OrdinalIgnoreCase)];
    }
}
