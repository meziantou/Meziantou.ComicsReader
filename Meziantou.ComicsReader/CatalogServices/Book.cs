namespace Meziantou.ComicsReader.CatalogServices;

public sealed class Book
{
    public required string[] FileNames { get; init; }
    public required byte[] FileSha256 { get; init; }
    public required string Title { get; init; }
    public required CatalogItemPath Path { get; init; }
    public required long FileSize { get; init; }
    public string? CoverImageFileName { get; init; }

    public int PageCount => GetImageFileNames().Count();

    public string GetFileNameFromPageIndex(int index) => GetImageFileNames().ElementAt(index);

    public IEnumerable<string> GetImageFileNames()
    {
        return FileNames.Where(IsImage);

        static bool IsImage(string path)
        {
            var extension = System.IO.Path.GetExtension(path).ToUpperInvariant();
            return extension is ".JPG" or ".JPEG" or ".PNG" or ".GIF" or ".BMP" or ".AVIF" or ".TIFF" or ".HEIC";
        }
    }
}
