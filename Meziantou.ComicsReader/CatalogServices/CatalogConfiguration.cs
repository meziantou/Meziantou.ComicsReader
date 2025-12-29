using Meziantou.Framework;

namespace Meziantou.ComicsReader.CatalogServices;

internal sealed class CatalogConfiguration
{
    public FullPath CoverImagesPath { get; set; }
    public FullPath Path { get; set; }
    public FullPath CompletedPath { get; set; }
    public FullPath IndexPath { get; set; }
    public TimeSpan RefreshPeriod { get; set; } = TimeSpan.FromHours(24);
    public string? AuthToken { get; set; }
}
