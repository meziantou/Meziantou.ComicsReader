using System.Buffers.Text;
using System.IO.Compression;
using System.Security.Cryptography;
using Meziantou.Framework;
using Meziantou.Framework.Threading;
using Polly;

namespace Meziantou.ComicsReader.CatalogServices;

internal sealed class BookContentCache
{
    private readonly static KeyedLock<FullPath> KeyedLock = new();

    private readonly FullPath _root;

    public BookContentCache(FullPath rootFolder)
    {
        _root = rootFolder;
    }

    private FullPath GetCacheFolder(FullPath bookPath)
    {
        var data = SHA256.HashData(Encoding.UTF8.GetBytes(bookPath.Value));
        return _root / Base64Url.EncodeToString(data);
    }

    public void CacheBook(FullPath bookPath)
    {
        var cacheFolder = GetCacheFolder(bookPath);
        if (Directory.Exists(cacheFolder))
            return;

        CleanupCache();
        using (KeyedLock.Lock(cacheFolder))
        {
            using var activity = ComicsReaderActivitySource.Instance.StartActivity("Caching book");
            activity?.AddTag("BookPath", bookPath.Value);

            var tmpFolder = cacheFolder + ".tmp";
            Policy.Handle<Exception>()
                .Retry(retryCount: 5)
                .Execute(() => ZipFile.ExtractToDirectory(bookPath, tmpFolder, overwriteFiles: true));

            IOUtilities.Delete(cacheFolder);
            Directory.Move(tmpFolder, cacheFolder);
        }
    }

    public FullPath GetCacheFilePath(FullPath bookPath, string fileName)
    {
        var cacheFolder = GetCacheFolder(bookPath);
        var filePath = cacheFolder / fileName;
        if (File.Exists(filePath))
            return filePath;

        CacheBook(bookPath);
        return filePath;
    }

    public FullPath Cleanup(FullPath path)
    {
        var cacheFolder = GetCacheFolder(path);
        if (Directory.Exists(cacheFolder))
        {
            using (KeyedLock.Lock(cacheFolder))
            {
                try
                {
                    IOUtilities.Delete(cacheFolder);
                }
                catch
                {
                }
            }
        }
        return cacheFolder;
    }

    private void CleanupCache()
    {
        try
        {
            var folders = Directory.GetDirectories(_root);
            if (folders.Length < 10)
                return;

            foreach (var folder in folders.Select(FullPath.FromPath))
            {
                using (KeyedLock.Lock(folder))
                {
                    try
                    {
                        var tempName = Guid.NewGuid().ToString("N");
                        Directory.Move(folder, tempName);
                        Directory.Delete(tempName, recursive: true);
                    }
                    catch
                    {
                    }
                }

            }
        }
        catch
        {
        }
    }
}
