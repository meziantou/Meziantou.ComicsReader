import Foundation

// API DTOs, matching the server's ApiModels.cs

public struct Book: Codable, Hashable, Sendable, Identifiable {
    public var path: String
    public var title: String
    public var pageCount: Int
    public var fileSize: Int64
    public var coverImageFileName: String?
    public var directory: String?
    public var firstDirectory: String?
    public var currentPage: Int?
    public var isCompleted: Bool
    public var lastRead: Date?

    public var id: String { path }

    public init(
        path: String,
        title: String,
        pageCount: Int,
        fileSize: Int64 = 0,
        coverImageFileName: String? = nil,
        directory: String? = nil,
        firstDirectory: String? = nil,
        currentPage: Int? = nil,
        isCompleted: Bool = false,
        lastRead: Date? = nil
    ) {
        self.path = path
        self.title = title
        self.pageCount = pageCount
        self.fileSize = fileSize
        self.coverImageFileName = coverImageFileName
        self.directory = directory
        self.firstDirectory = firstDirectory
        self.currentPage = currentPage
        self.isCompleted = isCompleted
        self.lastRead = lastRead
    }

    /// Returns a copy of the book with the progress fields replaced by the given reading progress
    public func withProgress(_ progress: ReadingProgress) -> Book {
        var copy = self
        copy.currentPage = progress.pageIndex
        copy.isCompleted = progress.completed
        copy.lastRead = progress.lastRead
        return copy
    }
}

public struct BooksResponse: Codable, Sendable {
    public var totalCount: Int
    public var books: [Book]

    public init(totalCount: Int, books: [Book]) {
        self.totalCount = totalCount
        self.books = books
    }
}

public struct PageInfo: Codable, Hashable, Sendable {
    public var index: Int
    public var fileName: String
}

public struct PagesResponse: Codable, Sendable {
    public var totalCount: Int
    public var pages: [PageInfo]
}

public struct ReadingListItem: Codable, Hashable, Sendable {
    public var bookPath: String
    public var pageIndex: Int
    public var completed: Bool
    public var lastRead: Date
    public var book: Book?

    public init(bookPath: String, pageIndex: Int, completed: Bool, lastRead: Date, book: Book? = nil) {
        self.bookPath = bookPath
        self.pageIndex = pageIndex
        self.completed = completed
        self.lastRead = lastRead
        self.book = book
    }
}

public struct ReadingListResponse: Codable, Sendable {
    public var totalCount: Int
    public var items: [ReadingListItem]

    public init(totalCount: Int, items: [ReadingListItem]) {
        self.totalCount = totalCount
        self.items = items
    }
}

public struct IndexingError: Codable, Hashable, Sendable {
    public var path: String
    public var message: String
}

public struct IndexingStatus: Codable, Sendable {
    public var lastIndexationDate: Date
    public var isInProgress: Bool
    public var firstIndexationCompleted: Bool
    public var errorCount: Int
    public var errors: [IndexingError]

    public init(lastIndexationDate: Date, isInProgress: Bool, firstIndexationCompleted: Bool, errorCount: Int = 0, errors: [IndexingError] = []) {
        self.lastIndexationDate = lastIndexationDate
        self.isInProgress = isInProgress
        self.firstIndexationCompleted = firstIndexationCompleted
        self.errorCount = errorCount
        self.errors = errors
    }
}

public struct VersionResponse: Codable, Sendable {
    public var version: String
}

struct UpdateReadingProgressRequest: Codable, Sendable {
    var pageIndex: Int
}

// App-specific types

/// Reading progress of a single book, stored locally so it is available offline
public struct ReadingProgress: Codable, Hashable, Sendable {
    public var pageIndex: Int
    public var completed: Bool
    public var lastRead: Date

    public init(pageIndex: Int, completed: Bool, lastRead: Date) {
        self.pageIndex = pageIndex
        self.completed = completed
        self.lastRead = lastRead
    }
}

/// Progress update that could not be sent to the server and must be synchronized later
public struct PendingProgressUpdate: Codable, Hashable, Sendable, Identifiable {
    public var id: UUID
    public var bookPath: String
    public var pageIndex: Int
    public var timestamp: Date

    public init(id: UUID = UUID(), bookPath: String, pageIndex: Int, timestamp: Date = Date()) {
        self.id = id
        self.bookPath = bookPath
        self.pageIndex = pageIndex
        self.timestamp = timestamp
    }
}

public struct CachedBook: Codable, Hashable, Sendable, Identifiable {
    public var book: Book
    public var cachedAt: Date
    public var fullyDownloaded: Bool

    public var id: String { book.path }
    public var path: String { book.path }

    public init(book: Book, cachedAt: Date, fullyDownloaded: Bool) {
        self.book = book
        self.cachedAt = cachedAt
        self.fullyDownloaded = fullyDownloaded
    }
}

public struct BookCacheStatus: Hashable, Sendable {
    public var isFullyDownloaded: Bool
    public var cachedPages: Int
    public var totalPages: Int

    /// A book is considered cached when at least one of its pages is available offline
    public var isCached: Bool { cachedPages > 0 }

    public init(isFullyDownloaded: Bool, cachedPages: Int, totalPages: Int) {
        self.isFullyDownloaded = isFullyDownloaded
        self.cachedPages = cachedPages
        self.totalPages = totalPages
    }
}

public struct CacheStatistics: Hashable, Sendable {
    public var books: Int
    public var covers: Int
    public var pages: Int
    public var totalSizeBytes: Int64

    public init(books: Int, covers: Int, pages: Int, totalSizeBytes: Int64) {
        self.books = books
        self.covers = covers
        self.pages = pages
        self.totalSizeBytes = totalSizeBytes
    }
}

public enum BookFilter: String, CaseIterable, Hashable, Sendable {
    case all
    case oneShot = "one-shot"
    case series

    public var displayName: String {
        switch self {
        case .all: "All"
        case .oneShot: "One Shot"
        case .series: "Series"
        }
    }

    public func includes(_ book: Book) -> Bool {
        switch self {
        case .all: true
        case .oneShot: book.directory == nil
        case .series: book.directory != nil
        }
    }
}
