using System.Diagnostics;

namespace Meziantou.ComicsReader;

internal static class ComicsReaderActivitySource
{
    public static ActivitySource Instance { get; } = new("Meziantou.ComicsReader", "1.0.0");
}
