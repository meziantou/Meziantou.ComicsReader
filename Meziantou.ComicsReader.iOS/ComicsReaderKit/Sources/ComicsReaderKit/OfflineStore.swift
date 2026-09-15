import CryptoKit
import Foundation

/// File-based storage for offline reading: book metadata, covers, pages, local reading progress and pending updates.
///
/// Layout of the root directory:
/// - books/<key>.json: cached book metadata
/// - covers/<key>: cover images
/// - pages/<key>/<pageIndex>: page images
/// - reading-list.json: local reading progress
/// - pending-updates.json: progress updates not yet sent to the server
public actor OfflineStore {
    public let rootDirectory: URL

    private let fileManager = FileManager()
    private let decoder = JSONCoding.makeDecoder()
    private let encoder = JSONCoding.makeEncoder()

    private var booksDirectory: URL { rootDirectory.appending(path: "books", directoryHint: .isDirectory) }
    private var coversDirectory: URL { rootDirectory.appending(path: "covers", directoryHint: .isDirectory) }
    private var pagesDirectory: URL { rootDirectory.appending(path: "pages", directoryHint: .isDirectory) }
    private var readingListFile: URL { rootDirectory.appending(path: "reading-list.json") }
    private var pendingUpdatesFile: URL { rootDirectory.appending(path: "pending-updates.json") }

    public init(rootDirectory: URL) {
        self.rootDirectory = rootDirectory
    }

    /// Store located in Application Support. Offline books must not be purged by the system like the Caches directory.
    public static func makeDefault() throws -> OfflineStore {
        var directory = try FileManager.default
            .url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appending(path: "OfflineStore", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        // The content can be downloaded again from the server, so it doesn't need to be part of the device backup
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? directory.setResourceValues(values)

        return OfflineStore(rootDirectory: directory)
    }

    static func key(for bookPath: String) -> String {
        SHA256.hash(data: Data(bookPath.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    // Books

    public func cachedBooks() -> [CachedBook] {
        guard let files = try? fileManager.contentsOfDirectory(at: booksDirectory, includingPropertiesForKeys: nil) else {
            return []
        }

        return files
            .filter { $0.pathExtension == "json" }
            .compactMap { readJSON(CachedBook.self, from: $0) }
            .sorted { $0.path < $1.path }
    }

    public func cachedBook(path: String) -> CachedBook? {
        readJSON(CachedBook.self, from: bookFile(path))
    }

    public func cacheBook(_ book: Book, fullyDownloaded: Bool = false) throws {
        try writeJSON(CachedBook(book: book, cachedAt: Date(), fullyDownloaded: fullyDownloaded), to: bookFile(book.path))
    }

    public func setDownloadStatus(path: String, fullyDownloaded: Bool) throws {
        guard var cached = cachedBook(path: path) else {
            return
        }

        cached.fullyDownloaded = fullyDownloaded
        try writeJSON(cached, to: bookFile(path))
    }

    public func isBookFullyDownloaded(path: String) -> Bool {
        cachedBook(path: path)?.fullyDownloaded ?? false
    }

    public func removeCachedBook(path: String) {
        try? fileManager.removeItem(at: bookFile(path))
        try? fileManager.removeItem(at: coverFile(path))
        try? fileManager.removeItem(at: bookPagesDirectory(path))
    }

    public func cleanupRemovedBooks(availableBookPaths: Set<String>) {
        for cached in cachedBooks() where !availableBookPaths.contains(cached.path) {
            removeCachedBook(path: cached.path)
        }
    }

    public func cleanupCompletedBooks(_ completedBookPaths: Set<String>) {
        for path in completedBookPaths {
            removeCachedBook(path: path)
        }
    }

    // Covers

    public func cachedCover(path: String) -> Data? {
        try? Data(contentsOf: coverFile(path))
    }

    public func cacheCover(path: String, data: Data) throws {
        try write(data, to: coverFile(path))
    }

    // Pages

    public func cachedPage(path: String, pageIndex: Int) -> Data? {
        try? Data(contentsOf: pageFile(path, pageIndex))
    }

    public func cachePage(path: String, pageIndex: Int, data: Data) throws {
        try write(data, to: pageFile(path, pageIndex))
    }

    public func cachedPageIndices(path: String) -> [Int] {
        guard let files = try? fileManager.contentsOfDirectory(atPath: bookPagesDirectory(path).path(percentEncoded: false)) else {
            return []
        }

        return files.compactMap(Int.init).sorted()
    }

    public func cachedPageCount(path: String) -> Int {
        cachedPageIndices(path: path).count
    }

    public func cacheStatus(path: String, pageCount: Int) -> BookCacheStatus {
        BookCacheStatus(
            isFullyDownloaded: isBookFullyDownloaded(path: path),
            cachedPages: cachedPageCount(path: path),
            totalPages: pageCount)
    }

    // Local reading list

    public func localReadingList() -> [String: ReadingProgress] {
        readJSON([String: ReadingProgress].self, from: readingListFile) ?? [:]
    }

    public func updateLocalReadingListItem(path: String, pageIndex: Int, completed: Bool, lastRead: Date = Date()) throws {
        var items = localReadingList()
        items[path] = ReadingProgress(pageIndex: pageIndex, completed: completed, lastRead: lastRead)
        try writeJSON(items, to: readingListFile)
    }

    public func replaceLocalReadingList(_ items: [String: ReadingProgress]) throws {
        try writeJSON(items, to: readingListFile)
    }

    public func removeLocalReadingListItem(path: String) throws {
        var items = localReadingList()
        items[path] = nil
        try writeJSON(items, to: readingListFile)
    }

    // Pending updates

    public func pendingUpdates() -> [PendingProgressUpdate] {
        (readJSON([PendingProgressUpdate].self, from: pendingUpdatesFile) ?? []).sorted { $0.timestamp < $1.timestamp }
    }

    public func addPendingUpdate(path: String, pageIndex: Int) throws {
        var updates = pendingUpdates()
        updates.append(PendingProgressUpdate(bookPath: path, pageIndex: pageIndex))
        try writeJSON(updates, to: pendingUpdatesFile)
    }

    public func removePendingUpdates(ids: Set<UUID>) throws {
        let updates = pendingUpdates().filter { !ids.contains($0.id) }
        try writeJSON(updates, to: pendingUpdatesFile)
    }

    // Maintenance

    public func clearAllPages() {
        try? fileManager.removeItem(at: pagesDirectory)
    }

    public func clearAllCovers() {
        try? fileManager.removeItem(at: coversDirectory)
    }

    public func clearAllCachedBooks() {
        try? fileManager.removeItem(at: booksDirectory)
        clearAllCovers()
        clearAllPages()
    }

    public func statistics() -> CacheStatistics {
        let books = fileCount(in: booksDirectory)
        let covers = fileCount(in: coversDirectory)
        let pagesDirectories = (try? fileManager.contentsOfDirectory(at: pagesDirectory, includingPropertiesForKeys: nil)) ?? []
        let pages = pagesDirectories.reduce(0) { $0 + fileCount(in: $1) }
        return CacheStatistics(books: books, covers: covers, pages: pages, totalSizeBytes: directorySize(rootDirectory))
    }

    // Helpers

    private func bookFile(_ path: String) -> URL {
        booksDirectory.appending(path: "\(Self.key(for: path)).json")
    }

    private func coverFile(_ path: String) -> URL {
        coversDirectory.appending(path: Self.key(for: path))
    }

    private func bookPagesDirectory(_ path: String) -> URL {
        pagesDirectory.appending(path: Self.key(for: path), directoryHint: .isDirectory)
    }

    private func pageFile(_ path: String, _ pageIndex: Int) -> URL {
        bookPagesDirectory(path).appending(path: String(pageIndex))
    }

    private func readJSON<T: Decodable>(_ type: T.Type, from url: URL) -> T? {
        guard let data = try? Data(contentsOf: url) else {
            return nil
        }

        return try? decoder.decode(type, from: data)
    }

    private func writeJSON(_ value: some Encodable, to url: URL) throws {
        try write(encoder.encode(value), to: url)
    }

    private func write(_ data: Data, to url: URL) throws {
        try fileManager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
    }

    private func fileCount(in directory: URL) -> Int {
        (try? fileManager.contentsOfDirectory(atPath: directory.path(percentEncoded: false)).count) ?? 0
    }

    private func directorySize(_ directory: URL) -> Int64 {
        guard let enumerator = fileManager.enumerator(at: directory, includingPropertiesForKeys: [.totalFileAllocatedSizeKey, .isRegularFileKey]) else {
            return 0
        }

        var size: Int64 = 0
        for case let url as URL in enumerator {
            guard let values = try? url.resourceValues(forKeys: [.totalFileAllocatedSizeKey, .isRegularFileKey]),
                  values.isRegularFile == true else {
                continue
            }

            size += Int64(values.totalFileAllocatedSize ?? 0)
        }

        return size
    }
}
