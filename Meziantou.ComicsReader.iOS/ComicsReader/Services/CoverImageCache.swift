import ComicsReaderKit
import UIKit

/// In-memory cache of decoded cover thumbnails, backed by the offline store
final class CoverImageCache {
    private let cache = NSCache<NSString, UIImage>()

    init() {
        cache.countLimit = 500
    }

    func cachedImage(for path: String) -> UIImage? {
        cache.object(forKey: path as NSString)
    }

    func image(for book: Book, api: (any ComicsAPI)?, network: NetworkConditions, library: LibraryService) async -> UIImage? {
        if let image = cachedImage(for: book.path) {
            return image
        }

        guard book.coverImageFileName != nil,
              let data = await library.coverData(api: api, network: network, path: book.path),
              let image = await Self.decodeThumbnail(data) else {
            return nil
        }

        cache.setObject(image, forKey: book.path as NSString)
        return image
    }

    func remove(path: String) {
        cache.removeObject(forKey: path as NSString)
    }

    func removeAll() {
        cache.removeAllObjects()
    }

    @concurrent
    private static func decodeThumbnail(_ data: Data) async -> UIImage? {
        guard let image = UIImage(data: data) else {
            return nil
        }

        // Covers are displayed at 150x200 points, so there is no need to keep the full resolution image in memory
        let ratio = min(1, max(450 / image.size.width, 600 / image.size.height))
        let size = CGSize(width: (image.size.width * ratio).rounded(), height: (image.size.height * ratio).rounded())
        return await image.byPreparingThumbnail(ofSize: size) ?? image
    }
}
