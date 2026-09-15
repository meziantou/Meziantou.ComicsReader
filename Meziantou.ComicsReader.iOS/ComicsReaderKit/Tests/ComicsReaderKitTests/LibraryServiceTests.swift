import Foundation
import Testing
@testable import ComicsReaderKit

/// In-memory implementation of the server API
actor FakeComicsAPI: ComicsAPI {
    var books: [Book] = []
    var serverProgress: [String: Int] = [:]
    var failure: APIError?
    var progressUpdates: [(path: String, pageIndex: Int)] = []
    var downloadedPages: [Int] = []

    func setFailure(_ failure: APIError?) {
        self.failure = failure
    }

    func setServerProgress(_ path: String, _ pageIndex: Int) {
        serverProgress[path] = pageIndex
    }

    func getBooks() async throws -> BooksResponse {
        try throwIfNeeded()
        return BooksResponse(totalCount: books.count, books: books)
    }

    func getPage(path: String, pageIndex: Int) async throws -> Data {
        try throwIfNeeded()
        downloadedPages.append(pageIndex)
        return Data([UInt8(pageIndex)])
    }

    func getCover(path: String) async throws -> Data {
        try throwIfNeeded()
        return Data([255])
    }

    func markAsRead(path: String) async throws {
        try throwIfNeeded()
    }

    func getReadingList(includeCompleted: Bool) async throws -> ReadingListResponse {
        try throwIfNeeded()
        return ReadingListResponse(totalCount: 0, items: [])
    }

    func getReadingListItem(path: String) async throws -> ReadingListItem? {
        try throwIfNeeded()
        return serverProgress[path].map { ReadingListItem(bookPath: path, pageIndex: $0, completed: false, lastRead: Date()) }
    }

    func updateReadingProgress(path: String, pageIndex: Int) async throws -> ReadingListResponse {
        try throwIfNeeded()
        progressUpdates.append((path, pageIndex))
        serverProgress[path] = pageIndex
        return ReadingListResponse(totalCount: 0, items: [])
    }

    func removeFromReadingList(path: String) async throws -> ReadingListResponse {
        try throwIfNeeded()
        return ReadingListResponse(totalCount: 0, items: [])
    }

    func getIndexingStatus() async throws -> IndexingStatus {
        try throwIfNeeded()
        return IndexingStatus(lastIndexationDate: Date(), isInProgress: false, firstIndexationCompleted: true)
    }

    func triggerReindex() async throws {
        try throwIfNeeded()
    }

    func getVersion() async throws -> VersionResponse {
        try throwIfNeeded()
        return VersionResponse(version: "1.0.0")
    }

    private func throwIfNeeded() throws {
        if let failure {
            throw failure
        }
    }
}

final class LibraryServiceTests {
    private let directory: URL
    private let store: OfflineStore
    private let service: LibraryService
    private let api = FakeComicsAPI()
    private let online = NetworkConditions(isOnline: true)

    init() {
        directory = FileManager.default.temporaryDirectory.appending(path: "LibraryServiceTests-\(UUID().uuidString)", directoryHint: .isDirectory)
        store = OfflineStore(rootDirectory: directory)
        service = LibraryService(store: store)
    }

    deinit {
        try? FileManager.default.removeItem(at: directory)
    }

    @Test func syncSendsHighestPendingPageWhenAheadOfServer() async throws {
        try await store.addPendingUpdate(path: "a.cbz", pageIndex: 3)
        try await store.addPendingUpdate(path: "a.cbz", pageIndex: 7)
        try await store.addPendingUpdate(path: "a.cbz", pageIndex: 5)
        await api.setServerProgress("a.cbz", 4)

        try await service.syncPendingUpdates(api: api)

        let updates = await api.progressUpdates
        #expect(updates.map(\.pageIndex) == [7])
        #expect(await store.pendingUpdates().isEmpty)
    }

    @Test func syncKeepsServerProgressWhenServerIsAhead() async throws {
        try await store.addPendingUpdate(path: "a.cbz", pageIndex: 3)
        await api.setServerProgress("a.cbz", 10)

        try await service.syncPendingUpdates(api: api)

        #expect(await api.progressUpdates.isEmpty)
        #expect(await store.pendingUpdates().isEmpty)
    }

    @Test func syncKeepsPendingUpdatesWhenServerIsUnreachable() async throws {
        try await store.addPendingUpdate(path: "a.cbz", pageIndex: 3)
        await api.setFailure(.network(server: "https://example.com", isTimeout: false, timeoutSeconds: 15))

        await #expect(throws: APIError.self) {
            try await self.service.syncPendingUpdates(api: self.api)
        }

        #expect(await store.pendingUpdates().count == 1)
    }

    @Test func syncDropsPendingUpdatesOfUnknownBooks() async throws {
        try await store.addPendingUpdate(path: "a.cbz", pageIndex: 3)
        await api.setFailure(.http(status: 400))

        try await service.syncPendingUpdates(api: api)

        #expect(await store.pendingUpdates().isEmpty)
    }

    @Test func updateReadingProgressQueuesUpdateWhenOffline() async throws {
        try await service.updateReadingProgress(api: api, network: .offline, path: "a.cbz", pageIndex: 9, pageCount: 10)

        #expect(await api.progressUpdates.isEmpty)
        #expect(await store.pendingUpdates().map(\.pageIndex) == [9])
        #expect(await store.localReadingList()["a.cbz"]?.completed == true)
    }

    @Test func updateReadingProgressQueuesUpdateWhenRequestFails() async throws {
        await api.setFailure(.http(status: 500))

        try await service.updateReadingProgress(api: api, network: online, path: "a.cbz", pageIndex: 2, pageCount: 10)

        #expect(await store.pendingUpdates().map(\.pageIndex) == [2])
        #expect(await store.localReadingList()["a.cbz"]?.completed == false)
    }

    @Test func updateReadingProgressSendsUpdateWhenOnline() async throws {
        try await service.updateReadingProgress(api: api, network: online, path: "a.cbz", pageIndex: 2, pageCount: 10)

        #expect(await api.progressUpdates.map(\.pageIndex) == [2])
        #expect(await store.pendingUpdates().isEmpty)
    }

    @Test func pageDataUsesCacheFirst() async throws {
        let book = Book(path: "a.cbz", title: "a", pageCount: 2)
        try await store.cachePage(path: book.path, pageIndex: 1, data: Data([42]))

        let data = try await service.pageData(api: api, network: .offline, book: book, pageIndex: 1, cacheDownloadedPage: false)

        #expect(data == Data([42]))
    }

    @Test func pageDataThrowsWhenOfflineAndNotCached() async throws {
        let book = Book(path: "a.cbz", title: "a", pageCount: 2)

        await #expect(throws: LibraryError.pageNotAvailableOffline) {
            try await self.service.pageData(api: self.api, network: .offline, book: book, pageIndex: 0, cacheDownloadedPage: true)
        }
    }

    @Test func pageDataCachesDownloadedPageWhenRequested() async throws {
        let book = Book(path: "a.cbz", title: "a", pageCount: 2)

        _ = try await service.pageData(api: api, network: online, book: book, pageIndex: 1, cacheDownloadedPage: true)
        #expect(await store.cachedPageIndices(path: book.path) == [1])
        #expect(await store.cachedBook(path: book.path)?.fullyDownloaded == false)

        _ = try await service.pageData(api: api, network: NetworkConditions(isOnline: true, isConstrained: true), book: book, pageIndex: 0, cacheDownloadedPage: true)
        #expect(await store.cachedPageIndices(path: book.path) == [1])
    }

    @Test func downloadBookDownloadsMissingPages() async throws {
        let book = Book(path: "a.cbz", title: "a", pageCount: 3, coverImageFileName: "cover.jpg")
        try await store.cacheBook(book)
        try await store.cachePage(path: book.path, pageIndex: 1, data: Data([1]))

        try await service.downloadBook(api: api, network: online, book: book)

        #expect(await api.downloadedPages == [0, 2])
        #expect(await store.cacheStatus(path: book.path, pageCount: 3) == BookCacheStatus(isFullyDownloaded: true, cachedPages: 3, totalPages: 3))
        #expect(await store.cachedCover(path: book.path) == Data([255]))
    }

    @Test func downloadBookIsRefusedInLowDataMode() async throws {
        let book = Book(path: "a.cbz", title: "a", pageCount: 3)

        await #expect(throws: LibraryError.constrainedNetwork) {
            try await self.service.downloadBook(api: self.api, network: NetworkConditions(isOnline: true, isConstrained: true), book: book)
        }
    }

    @Test func downloadAllBooksSkipsCompletedAndOnExpensiveNetwork() async throws {
        let books = [
            Book(path: "a.cbz", title: "a", pageCount: 1),
            Book(path: "b.cbz", title: "b", pageCount: 1, isCompleted: true),
        ]

        await service.downloadAllBooks(api: api, network: NetworkConditions(isOnline: true, isExpensive: true), books: books)
        #expect(await store.cachedBooks().isEmpty)

        await service.downloadAllBooks(api: api, network: online, books: books)
        #expect(await store.cachedBooks().filter(\.fullyDownloaded).map(\.path) == ["a.cbz"])
    }

    @Test func saveServerReadingListKeepsProgressNotYetSynchronized() async throws {
        let date = Date(timeIntervalSince1970: 1_000)
        try await store.updateLocalReadingListItem(path: "local-only.cbz", pageIndex: 1, completed: false)
        try await store.updateLocalReadingListItem(path: "pending.cbz", pageIndex: 8, completed: false)
        try await store.updateLocalReadingListItem(path: "removed.cbz", pageIndex: 8, completed: false)
        try await store.addPendingUpdate(path: "pending.cbz", pageIndex: 8)

        try await service.saveServerReadingList([
            ReadingListItem(bookPath: "pending.cbz", pageIndex: 5, completed: false, lastRead: date),
            ReadingListItem(bookPath: "server.cbz", pageIndex: 2, completed: true, lastRead: date),
        ])

        let local = await store.localReadingList()
        #expect(local.keys.sorted() == ["pending.cbz", "server.cbz"])
        #expect(local["pending.cbz"]?.pageIndex == 8)
        #expect(local["server.cbz"] == ReadingProgress(pageIndex: 2, completed: true, lastRead: date))
    }

    @Test func loadOfflineLibraryAppliesLocalProgress() async throws {
        try await store.cacheBook(Book(path: "a.cbz", title: "a", pageCount: 10))
        try await store.updateLocalReadingListItem(path: "a.cbz", pageIndex: 4, completed: false)

        let library = await service.loadOfflineLibrary()

        #expect(library.books.map(\.currentPage) == [4])
        #expect(library.readingList.map(\.bookPath) == ["a.cbz"])
        #expect(LibraryService.inProgressBooks(books: library.books, readingList: library.readingList).map(\.path) == ["a.cbz"])
    }

    @Test func filterCatalogAppliesFilterAndSearch() {
        let books = [
            Book(path: "Zorro.cbz", title: "Zorro", pageCount: 1),
            Book(path: "Astérix/t02.cbz", title: "t02", pageCount: 1, directory: "Astérix"),
            Book(path: "Astérix/t01.cbz", title: "t01", pageCount: 1, directory: "Astérix"),
        ]

        #expect(LibraryService.filterCatalog(books, search: "", filter: .all).map(\.path) == ["Astérix/t01.cbz", "Astérix/t02.cbz", "Zorro.cbz"])
        #expect(LibraryService.filterCatalog(books, search: "", filter: .oneShot).map(\.path) == ["Zorro.cbz"])
        #expect(LibraryService.filterCatalog(books, search: " asterix ", filter: .series).map(\.path) == ["Astérix/t01.cbz", "Astérix/t02.cbz"])
    }
}
