import Foundation

public enum LibraryError: Error, LocalizedError, Equatable, Sendable {
    case pageNotAvailableOffline
    case offline
    case constrainedNetwork

    public var errorDescription: String? {
        switch self {
        case .pageNotAvailableOffline: "Page not cached and offline"
        case .offline: "Cannot download while offline"
        case .constrainedNetwork: "Cannot download while Low Data Mode is enabled"
        }
    }
}

/// Network conditions used to decide whether data can be downloaded
public struct NetworkConditions: Hashable, Sendable {
    public var isOnline: Bool

    /// Low Data Mode is enabled (equivalent of the "Save Data" mode of browsers)
    public var isConstrained: Bool

    /// Cellular or personal hotspot connection
    public var isExpensive: Bool

    public init(isOnline: Bool, isConstrained: Bool = false, isExpensive: Bool = false) {
        self.isOnline = isOnline
        self.isConstrained = isConstrained
        self.isExpensive = isExpensive
    }

    public static let offline = NetworkConditions(isOnline: false)

    /// Automatic downloads only happen on a Wi-Fi like connection without Low Data Mode
    public var allowsAutomaticDownloads: Bool {
        isOnline && !isConstrained && !isExpensive
    }
}

/// Offline-aware operations combining the server API and the local store
public struct LibraryService: Sendable {
    public let store: OfflineStore

    public init(store: OfflineStore) {
        self.store = store
    }

    /// Applies the reading progress to the matching books
    public static func applyProgress(to books: [Book], progress: [String: ReadingProgress]) -> [Book] {
        books.map { book in
            guard let item = progress[book.path] else {
                return book
            }

            return book.withProgress(item)
        }
    }

    public static func applyProgress(to books: [Book], readingList: [ReadingListItem]) -> [Book] {
        let progress = Dictionary(
            readingList.map { ($0.bookPath, ReadingProgress(pageIndex: $0.pageIndex, completed: $0.completed, lastRead: $0.lastRead)) },
            uniquingKeysWith: { first, _ in first })
        return applyProgress(to: books, progress: progress)
    }

    /// Books in progress, most recently read first
    public static func inProgressBooks(books: [Book], readingList: [ReadingListItem]) -> [Book] {
        let booksByPath = Dictionary(books.map { ($0.path, $0) }, uniquingKeysWith: { first, _ in first })
        return readingList
            .filter { !$0.completed }
            .sorted { $0.lastRead > $1.lastRead }
            .compactMap { booksByPath[$0.bookPath] }
    }

    /// Filters and sorts the catalog according to the search text and the filter
    public static func filterCatalog(_ books: [Book], search: String, filter: BookFilter) -> [Book] {
        let search = search.trimmingCharacters(in: .whitespacesAndNewlines)
        return books
            .filter { filter.includes($0) }
            .filter { search.isEmpty || StringUtilities.containsInsensitive($0.title, search) || StringUtilities.containsInsensitive($0.path, search) }
            .sorted { $0.path < $1.path }
    }

    /// Sends the progress updates made while offline. When the server has a more advanced progress, the server wins.
    public func syncPendingUpdates(api: any ComicsAPI) async throws {
        let pendingUpdates = await store.pendingUpdates()
        guard !pendingUpdates.isEmpty else {
            return
        }

        // Group by book, keeping only the highest page for each
        var latestByBook: [String: Int] = [:]
        for update in pendingUpdates {
            latestByBook[update.bookPath] = max(latestByBook[update.bookPath] ?? update.pageIndex, update.pageIndex)
        }

        for (bookPath, pageIndex) in latestByBook.sorted(by: { $0.key < $1.key }) {
            let updateIds = Set(pendingUpdates.filter { $0.bookPath == bookPath }.map(\.id))
            do {
                let serverItem = try await api.getReadingListItem(path: bookPath)

                // Conflict resolution: highest page number wins
                if pageIndex > serverItem?.pageIndex ?? -1 {
                    _ = try await api.updateReadingProgress(path: bookPath, pageIndex: pageIndex)
                }

                try await store.removePendingUpdates(ids: updateIds)
            } catch let error as APIError where error.isNetworkError {
                // The server is unreachable, so there is no point trying the remaining books
                throw error
            } catch APIError.http(status: 400), APIError.http(status: 404) {
                // The book probably doesn't exist anymore, so retrying is useless
                try await store.removePendingUpdates(ids: updateIds)
            } catch {
                // Keep pending updates for retry on other errors
            }
        }
    }

    /// Saves the reading progress locally and sends it to the server, or queues it when the server cannot be reached
    public func updateReadingProgress(api: (any ComicsAPI)?, network: NetworkConditions, path: String, pageIndex: Int, pageCount: Int) async throws {
        let completed = pageIndex >= pageCount - 1
        try await store.updateLocalReadingListItem(path: path, pageIndex: pageIndex, completed: completed)

        guard network.isOnline, let api else {
            try await store.addPendingUpdate(path: path, pageIndex: pageIndex)
            return
        }

        do {
            _ = try await api.updateReadingProgress(path: path, pageIndex: pageIndex)
        } catch {
            try await store.addPendingUpdate(path: path, pageIndex: pageIndex)
        }
    }

    /// Replaces the local reading progress with the server one, except for books with progress not yet synchronized
    public func saveServerReadingList(_ items: [ReadingListItem]) async throws {
        var result = Dictionary(
            items.map { ($0.bookPath, ReadingProgress(pageIndex: $0.pageIndex, completed: $0.completed, lastRead: $0.lastRead)) },
            uniquingKeysWith: { first, _ in first })

        let pendingPaths = Set(await store.pendingUpdates().map(\.bookPath))
        for (path, local) in await store.localReadingList() where pendingPaths.contains(path) {
            if local.pageIndex > result[path]?.pageIndex ?? -1 {
                result[path] = local
            }
        }

        try await store.replaceLocalReadingList(result)
    }

    /// Gets a page from the cache, or downloads it (and caches it when requested)
    public func pageData(api: (any ComicsAPI)?, network: NetworkConditions, book: Book, pageIndex: Int, cacheDownloadedPage: Bool) async throws -> Data {
        if let cached = await store.cachedPage(path: book.path, pageIndex: pageIndex) {
            return cached
        }

        guard network.isOnline, let api else {
            throw LibraryError.pageNotAvailableOffline
        }

        let data = try await api.getPage(path: book.path, pageIndex: pageIndex)
        if cacheDownloadedPage && !network.isConstrained {
            if await store.cachedBook(path: book.path) == nil {
                try? await store.cacheBook(book)
            }

            try? await store.cachePage(path: book.path, pageIndex: pageIndex, data: data)
        }

        return data
    }

    /// Gets a cover from the server when online (and caches it), otherwise from the cache
    public func coverData(api: (any ComicsAPI)?, network: NetworkConditions, path: String) async -> Data? {
        if network.isOnline, let api {
            if let data = try? await api.getCover(path: path) {
                try? await store.cacheCover(path: path, data: data)
                return data
            }
        }

        return await store.cachedCover(path: path)
    }

    /// Downloads the cover and all the pages of a book. Supports task cancellation.
    public func downloadBook(api: any ComicsAPI, network: NetworkConditions, book: Book, onProgress: (@Sendable (Int, Int) -> Void)? = nil) async throws {
        guard network.isOnline else {
            throw LibraryError.offline
        }

        guard !network.isConstrained else {
            throw LibraryError.constrainedNetwork
        }

        try Task.checkCancellation()
        if let existing = await store.cachedBook(path: book.path) {
            if existing.fullyDownloaded {
                onProgress?(book.pageCount, book.pageCount)
                return
            }
        } else {
            try await store.cacheBook(book)
        }

        if book.coverImageFileName != nil, await store.cachedCover(path: book.path) == nil {
            if let cover = try? await api.getCover(path: book.path) {
                try await store.cacheCover(path: book.path, data: cover)
            }
        }

        let cachedPages = Set(await store.cachedPageIndices(path: book.path))
        for pageIndex in 0..<book.pageCount {
            try Task.checkCancellation()
            if !cachedPages.contains(pageIndex) {
                let data = try await api.getPage(path: book.path, pageIndex: pageIndex)
                try await store.cachePage(path: book.path, pageIndex: pageIndex, data: data)
            }

            onProgress?(pageIndex + 1, book.pageCount)
        }

        try await store.setDownloadStatus(path: book.path, fullyDownloaded: true)
    }

    /// Downloads, one after the other, all the books of the catalog that are not fully downloaded
    public func downloadAllBooks(api: any ComicsAPI, network: NetworkConditions, books: [Book], onBookDownloaded: (@Sendable (Book) async -> Void)? = nil) async {
        guard network.allowsAutomaticDownloads else {
            return
        }

        let downloadedPaths = Set(await store.cachedBooks().filter(\.fullyDownloaded).map(\.path))
        for book in books where !downloadedPaths.contains(book.path) && !book.isCompleted {
            if Task.isCancelled {
                return
            }

            do {
                try await downloadBook(api: api, network: network, book: book)
                await onBookDownloaded?(book)
            } catch is CancellationError {
                return
            } catch {
                // Continue with the next book even if one fails
            }
        }
    }

    /// Removes the cached data of books that are no longer in the catalog or that are completed
    public func performCleanup(books: [Book], readingList: [ReadingListItem]) async {
        await store.cleanupRemovedBooks(availableBookPaths: Set(books.map(\.path)))
        await store.cleanupCompletedBooks(Set(readingList.filter(\.completed).map(\.bookPath)))
    }

    /// Loads the data available offline: cached books with the local reading progress
    public func loadOfflineLibrary() async -> (books: [Book], readingList: [ReadingListItem]) {
        let cachedBooks = await store.cachedBooks()
        let progress = await store.localReadingList()
        let books = Self.applyProgress(to: cachedBooks.map(\.book), progress: progress)
        let booksByPath = Dictionary(books.map { ($0.path, $0) }, uniquingKeysWith: { first, _ in first })
        let readingList = progress
            .map { ReadingListItem(bookPath: $0.key, pageIndex: $0.value.pageIndex, completed: $0.value.completed, lastRead: $0.value.lastRead, book: booksByPath[$0.key]) }
            .sorted { $0.lastRead > $1.lastRead }
        return (books, readingList)
    }
}
