namespace Meziantou.ComicsReader.CatalogServices;

internal static class BookExtensions
{
    public static Book? Find(this IEnumerable<Book> books, CatalogItemPath path)
    {
        return books.FirstOrDefault(book => book.Path == path);
    }

    public static bool HasError(this IEnumerable<IndexingError> errors, CatalogItemPath path)
    {
        return errors.Any(error => error.Path == path);
    }
}
