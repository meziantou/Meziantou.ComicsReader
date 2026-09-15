import ComicsReaderKit
import Foundation
import Observation

@Observable
final class AppModel {
    private static let indexingPollInterval = Duration.seconds(1)

    private(set) var settings: AppSettings
    private(set) var api: APIClient?
    private(set) var books: [Book] = []
    private(set) var readingList: [ReadingListItem] = []
    private(set) var inProgressBooks: [Book] = []
    private(set) var nextToRead: [Book] = []
    private(set) var isLoading = false
    private(set) var hasLoaded = false
    var errorMessage: String?

    /// Books available offline: path => fully downloaded
    private(set) var cachedBooksInfo: [String: Bool] = [:]

    let network = NetworkMonitor()
    let library: LibraryService
    let covers = CoverImageCache()

    @ObservationIgnored private let settingsStore = SettingsStore()
    @ObservationIgnored private var autoDownloadTask: Task<Void, Never>?
    @ObservationIgnored private var autoDownloadGeneration = 0
    @ObservationIgnored private var isStarted = false

    var isConfigured: Bool { api != nil }
    var networkConditions: NetworkConditions { network.conditions }

    init() {
        let store: OfflineStore
        do {
            store = try OfflineStore.makeDefault()
        } catch {
            store = OfflineStore(rootDirectory: FileManager.default.temporaryDirectory.appending(path: "OfflineStore", directoryHint: .isDirectory))
        }

        library = LibraryService(store: store)
        settings = settingsStore.load()
        api = try? APIClient(serverURL: settings.serverURL, token: settings.token)
    }

    func start() async {
        guard !isStarted else {
            return
        }

        isStarted = true
        network.onChange = { [weak self] old, new in
            guard let self else {
                return
            }

            Task {
                if new.isOnline && !old.isOnline {
                    await self.refresh()
                } else if !new.isOnline && old.isOnline {
                    await self.loadOfflineLibrary()
                }
            }
        }
        network.start()

        await refresh()
        hasLoaded = true
    }

    /// Refreshes the data every minute while the app is active
    func runBackgroundRefreshLoop() async {
        while !Task.isCancelled {
            do {
                try await Task.sleep(for: .seconds(60))
            } catch {
                return
            }

            if network.isOnline {
                await refresh(isBackgroundRefresh: true)
            }
        }
    }

    func refresh(isBackgroundRefresh: Bool = false) async {
        guard let api, network.isOnline else {
            await loadOfflineLibrary()
            return
        }

        // Only show the loading indicator for user-initiated refreshes
        if !isBackgroundRefresh {
            isLoading = true
        }

        defer {
            if !isBackgroundRefresh {
                isLoading = false
            }
        }

        do {
            try? await library.syncPendingUpdates(api: api)
            try await fetchData(api: api, isBackgroundRefresh: isBackgroundRefresh)
            errorMessage = nil
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription

            // Keep the current books if any, otherwise show what is available offline
            if books.isEmpty {
                await loadOfflineLibrary()
            }
        }
    }

    private func fetchData(api: APIClient, isBackgroundRefresh: Bool) async throws {
        async let booksResponse = api.getBooks()
        async let readingListResponse = api.getReadingList(includeCompleted: true)
        let (serverBooks, serverReadingList) = try await (booksResponse.books, readingListResponse.items)

        let newBooks = LibraryService.applyProgress(to: serverBooks, readingList: serverReadingList)

        // For background refreshes, ignore lastRead changes to avoid useless updates of the UI
        let hasChanged = !isBackgroundRefresh
            || Self.removingLastRead(newBooks) != Self.removingLastRead(books)
            || serverReadingList != readingList
        if hasChanged {
            setLibrary(books: newBooks, readingList: serverReadingList)
        }

        try? await library.saveServerReadingList(serverReadingList)
        await library.performCleanup(books: serverBooks, readingList: serverReadingList)
        await refreshCachedBooksInfo()

        if settings.autoDownloadNewBooks {
            startAutoDownload()
        }
    }

    private static func removingLastRead(_ books: [Book]) -> [Book] {
        books.map { book in
            var copy = book
            copy.lastRead = nil
            return copy
        }
    }

    private func setLibrary(books: [Book], readingList: [ReadingListItem]) {
        self.books = books
        self.readingList = readingList
        inProgressBooks = LibraryService.inProgressBooks(books: books, readingList: readingList)
        nextToRead = Recommendations.nextBooksToRead(books: books, readingList: readingList)
    }

    func loadOfflineLibrary() async {
        let offline = await library.loadOfflineLibrary()
        if !offline.books.isEmpty || books.isEmpty {
            setLibrary(books: offline.books, readingList: offline.readingList)
        }

        await refreshCachedBooksInfo()
    }

    func refreshCachedBooksInfo() async {
        let cachedBooks = await library.store.cachedBooks()
        cachedBooksInfo = Dictionary(cachedBooks.map { ($0.path, $0.fullyDownloaded) }, uniquingKeysWith: { first, _ in first })
    }

    func book(path: String) -> Book? {
        books.first { $0.path == path }
    }

    // Settings

    func updateSettings(_ newSettings: AppSettings) async throws {
        let previousSettings = settings
        let serverChanged = previousSettings.serverURL != newSettings.serverURL || previousSettings.token != newSettings.token
        let newAPI = serverChanged ? try APIClient(serverURL: newSettings.serverURL, token: newSettings.token) : api

        try settingsStore.save(newSettings)
        settings = newSettings
        api = newAPI

        if previousSettings.autoDownloadNewBooks && !newSettings.autoDownloadNewBooks {
            cancelAutoDownload()
        }

        if serverChanged {
            await refresh()
        } else if !previousSettings.autoDownloadNewBooks && newSettings.autoDownloadNewBooks {
            startAutoDownload()
        }
    }

    func setAutoDownloadNewBooks(_ value: Bool) async throws {
        var newSettings = settings
        newSettings.autoDownloadNewBooks = value
        try await updateSettings(newSettings)
    }

    func setLargeFullscreenProgressBar(_ value: Bool) async throws {
        var newSettings = settings
        newSettings.largeFullscreenProgressBar = value
        try await updateSettings(newSettings)
    }

    // Server actions

    func triggerReindex() async throws {
        guard let api else {
            return
        }

        try await api.triggerReindex()
        while try await api.getIndexingStatus().isInProgress {
            try await Task.sleep(for: Self.indexingPollInterval)
        }

        try await fetchData(api: api, isBackgroundRefresh: false)
    }

    // Reading

    func updateReadingProgress(book: Book, pageIndex: Int) async {
        // The completion screen is not a real page
        guard pageIndex >= 0 && pageIndex < book.pageCount else {
            return
        }

        try? await library.updateReadingProgress(api: api, network: network.conditions, path: book.path, pageIndex: pageIndex, pageCount: book.pageCount)

        // Update the in-memory state so the library reflects the progress without waiting for the next refresh
        let item = ReadingListItem(bookPath: book.path, pageIndex: pageIndex, completed: false, lastRead: Date(), book: book)
        var newReadingList = readingList.filter { $0.bookPath != book.path }
        newReadingList.insert(item, at: 0)
        let newBooks = books.map { $0.path == book.path ? $0.withProgress(ReadingProgress(pageIndex: pageIndex, completed: false, lastRead: item.lastRead)) : $0 }
        setLibrary(books: newBooks, readingList: newReadingList)
    }

    func markAsRead(book: Book) async throws {
        guard let api else {
            return
        }

        try await api.markAsRead(path: book.path)
        covers.remove(path: book.path)

        // The server may move the book out of the catalog, so don't make the caller wait for the refresh
        Task { await refresh() }
    }

    func removeFromReadingList(book: Book) async throws {
        guard let api else {
            return
        }

        let response = try await api.removeFromReadingList(path: book.path)
        try? await library.store.removeLocalReadingListItem(path: book.path)

        let completedItems = readingList.filter(\.completed)
        let newReadingList = response.items + completedItems.filter { item in !response.items.contains { $0.bookPath == item.bookPath } }
        var newBooks = books
        if let index = newBooks.firstIndex(where: { $0.path == book.path }) {
            newBooks[index].currentPage = nil
            newBooks[index].isCompleted = false
            newBooks[index].lastRead = nil
        }

        setLibrary(books: newBooks, readingList: newReadingList)
    }

    // Offline

    func downloadBook(_ book: Book, onProgress: @escaping @Sendable (Int, Int) -> Void) async throws {
        guard let api else {
            return
        }

        defer {
            Task { await refreshCachedBooksInfo() }
        }

        try await library.downloadBook(api: api, network: network.conditions, book: book, onProgress: onProgress)
    }

    func removeFromCache(path: String) async {
        await library.store.removeCachedBook(path: path)
        covers.remove(path: path)
        await refreshCachedBooksInfo()
    }

    func clearCache(_ scope: CacheClearScope) async {
        let store = library.store
        switch scope {
        case .pages:
            await store.clearAllPages()
        case .covers:
            await store.clearAllCovers()
            covers.removeAll()
        case .everything:
            await store.clearAllCachedBooks()
            covers.removeAll()
        }

        await refreshCachedBooksInfo()
    }

    private func startAutoDownload() {
        guard let api, autoDownloadTask == nil, network.conditions.allowsAutomaticDownloads else {
            return
        }

        let books = books
        let library = library
        let network = network.conditions
        autoDownloadGeneration += 1
        let generation = autoDownloadGeneration
        autoDownloadTask = Task { [weak self] in
            await library.downloadAllBooks(api: api, network: network, books: books) { [weak self] _ in
                await self?.refreshCachedBooksInfo()
            }

            if let self, generation == autoDownloadGeneration {
                autoDownloadTask = nil
            }
        }
    }

    private func cancelAutoDownload() {
        autoDownloadTask?.cancel()
        autoDownloadTask = nil
        autoDownloadGeneration += 1
    }
}

enum CacheClearScope {
    case pages
    case covers
    case everything
}
