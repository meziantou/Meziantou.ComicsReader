import Foundation
import Testing
@testable import ComicsReaderKit

final class OfflineStoreTests {
    private let directory: URL
    private let store: OfflineStore

    init() {
        directory = FileManager.default.temporaryDirectory.appending(path: "OfflineStoreTests-\(UUID().uuidString)", directoryHint: .isDirectory)
        store = OfflineStore(rootDirectory: directory)
    }

    deinit {
        try? FileManager.default.removeItem(at: directory)
    }

    @Test func cachesBooksAndPages() async throws {
        let book = Book(path: "series/t01.cbz", title: "t01", pageCount: 3, directory: "series", firstDirectory: "series")

        try await store.cacheBook(book)
        try await store.cachePage(path: book.path, pageIndex: 0, data: Data([1]))
        try await store.cachePage(path: book.path, pageIndex: 2, data: Data([3]))
        try await store.cacheCover(path: book.path, data: Data([9]))

        #expect(await store.cachedBooks().map(\.book) == [book])
        #expect(await store.cachedPage(path: book.path, pageIndex: 2) == Data([3]))
        #expect(await store.cachedPage(path: book.path, pageIndex: 1) == nil)
        #expect(await store.cachedPageIndices(path: book.path) == [0, 2])
        #expect(await store.cachedCover(path: book.path) == Data([9]))
        #expect(await store.cacheStatus(path: book.path, pageCount: 3) == BookCacheStatus(isFullyDownloaded: false, cachedPages: 2, totalPages: 3))

        try await store.setDownloadStatus(path: book.path, fullyDownloaded: true)
        #expect(await store.isBookFullyDownloaded(path: book.path))

        let statistics = await store.statistics()
        #expect(statistics.books == 1)
        #expect(statistics.covers == 1)
        #expect(statistics.pages == 2)
        #expect(statistics.totalSizeBytes > 0)
    }

    @Test func removesCachedBook() async throws {
        let book = Book(path: "t01.cbz", title: "t01", pageCount: 1)
        try await store.cacheBook(book)
        try await store.cachePage(path: book.path, pageIndex: 0, data: Data([1]))
        try await store.cacheCover(path: book.path, data: Data([9]))

        await store.removeCachedBook(path: book.path)

        #expect(await store.cachedBooks().isEmpty)
        #expect(await store.cachedPageCount(path: book.path) == 0)
        #expect(await store.cachedCover(path: book.path) == nil)
    }

    @Test func cleansUpRemovedAndCompletedBooks() async throws {
        for path in ["a.cbz", "b.cbz", "c.cbz"] {
            try await store.cacheBook(Book(path: path, title: path, pageCount: 1))
        }

        await store.cleanupRemovedBooks(availableBookPaths: ["a.cbz", "b.cbz"])
        await store.cleanupCompletedBooks(["b.cbz"])

        #expect(await store.cachedBooks().map(\.path) == ["a.cbz"])
    }

    @Test func clearsPagesButKeepsBooksAndCovers() async throws {
        let book = Book(path: "t01.cbz", title: "t01", pageCount: 1)
        try await store.cacheBook(book)
        try await store.cachePage(path: book.path, pageIndex: 0, data: Data([1]))
        try await store.cacheCover(path: book.path, data: Data([9]))

        await store.clearAllPages()

        #expect(await store.statistics().pages == 0)
        #expect(await store.statistics().books == 1)
        #expect(await store.statistics().covers == 1)

        await store.clearAllCachedBooks()

        #expect(await store.statistics() == CacheStatistics(books: 0, covers: 0, pages: 0, totalSizeBytes: 0))
    }

    @Test func storesPendingUpdatesAndReadingList() async throws {
        try await store.addPendingUpdate(path: "a.cbz", pageIndex: 1)
        try await store.addPendingUpdate(path: "a.cbz", pageIndex: 2)
        try await store.updateLocalReadingListItem(path: "a.cbz", pageIndex: 2, completed: false)

        let updates = await store.pendingUpdates()
        #expect(updates.map(\.pageIndex) == [1, 2])
        #expect(await store.localReadingList()["a.cbz"]?.pageIndex == 2)

        try await store.removePendingUpdates(ids: [updates[0].id])
        #expect(await store.pendingUpdates().map(\.pageIndex) == [2])
    }
}
