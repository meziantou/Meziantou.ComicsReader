import ComicsReaderKit
import Observation
import UIKit

@Observable
final class ReaderViewModel {
    private static let preloadedPageCount = 3
    private static let loadingIndicatorDelay = Duration.milliseconds(750)

    let book: Book
    private(set) var currentPage: Int
    private(set) var image: UIImage?
    private(set) var showLoadingIndicator = false
    private(set) var isDownloading = false
    private(set) var downloadProgress = 0.0
    private(set) var cacheStatus: BookCacheStatus?
    private(set) var isMovingForward = true
    var errorMessage: String?
    var isFullscreen = true

    @ObservationIgnored private let model: AppModel
    @ObservationIgnored private var images: [Int: UIImage] = [:]
    @ObservationIgnored private var pageTasks: [Int: Task<UIImage, any Error>] = [:]
    @ObservationIgnored private var loadTask: Task<Void, Never>?
    @ObservationIgnored private var preloadTask: Task<Void, Never>?
    @ObservationIgnored private var progressTask: Task<Void, Never>?
    @ObservationIgnored private var isStarted = false

    init(model: AppModel, book: Book) {
        self.model = model
        self.book = book
        currentPage = min(max(book.currentPage ?? 0, 0), max(book.pageCount - 1, 0))
    }

    /// The completion screen is displayed after the last page
    var isAtEnd: Bool { currentPage >= book.pageCount }

    var displayedPageNumber: Int { min(currentPage, book.pageCount - 1) + 1 }

    var progress: Double {
        guard book.pageCount > 0 else {
            return 0
        }

        return min(1, Double(currentPage + 1) / Double(book.pageCount))
    }

    var largeProgressBar: Bool { model.settings.largeFullscreenProgressBar && isFullscreen }
    var isOnline: Bool { model.network.isOnline }

    func start() {
        guard !isStarted else {
            return
        }

        isStarted = true
        loadCurrentPage()
        saveProgress()
        Task { await refreshCacheStatus() }
    }

    func stop() {
        loadTask?.cancel()
        preloadTask?.cancel()
        for task in pageTasks.values {
            task.cancel()
        }

        pageTasks.removeAll()
        images.removeAll()
    }

    // Navigation

    func goToPage(_ page: Int) {
        let newPage = min(max(page, 0), book.pageCount)
        guard newPage != currentPage else {
            return
        }

        isMovingForward = newPage > currentPage
        currentPage = newPage
        loadCurrentPage()
        saveProgress()
    }

    func goToNextPage() {
        goToPage(currentPage + 1)
    }

    func goToPreviousPage() {
        goToPage(currentPage - 1)
    }

    func goToFirstPage() {
        goToPage(0)
    }

    func goToLastPage() {
        goToPage(book.pageCount - 1)
    }

    func toggleFullscreen() {
        isFullscreen.toggle()
    }

    func handleSwipe(_ direction: SwipeDirection) {
        switch direction {
        case .left: goToNextPage()
        case .right: goToPreviousPage()
        case .up, .down: toggleFullscreen()
        }
    }

    // Pages

    private func saveProgress() {
        // Chain the updates so the server receives them in order
        let previousTask = progressTask
        let book = book
        let page = currentPage
        progressTask = Task { [model] in
            await previousTask?.value
            await model.updateReadingProgress(book: book, pageIndex: page)
        }
    }

    private func loadCurrentPage() {
        loadTask?.cancel()
        showLoadingIndicator = false

        guard !isAtEnd else {
            image = nil
            return
        }

        let page = currentPage
        trimImageCache()
        if let cached = images[page] {
            image = cached
            errorMessage = nil
            preloadNextPages()
            return
        }

        image = nil
        loadTask = Task {
            let indicatorTask = Task {
                try? await Task.sleep(for: Self.loadingIndicatorDelay)
                if !Task.isCancelled && currentPage == page && image == nil {
                    showLoadingIndicator = true
                }
            }

            defer {
                indicatorTask.cancel()
            }

            do {
                let pageImage = try await loadImage(page)
                guard !Task.isCancelled, currentPage == page else {
                    return
                }

                image = pageImage
                errorMessage = nil
                showLoadingIndicator = false
                preloadNextPages()
                await refreshCacheStatus()
            } catch {
                guard !Task.isCancelled, currentPage == page, !(error is CancellationError) else {
                    return
                }

                showLoadingIndicator = false
                errorMessage = "Failed to load page: \(error.localizedDescription)"
            }
        }
    }

    private func preloadNextPages() {
        preloadTask?.cancel()
        let startPage = currentPage
        preloadTask = Task {
            for page in (startPage + 1)...(startPage + Self.preloadedPageCount) where page < book.pageCount {
                guard !Task.isCancelled else {
                    return
                }

                _ = try? await loadImage(page)
            }
        }
    }

    private func loadImage(_ page: Int) async throws -> UIImage {
        if let cached = images[page] {
            return cached
        }

        if let task = pageTasks[page] {
            return try await task.value
        }

        let book = book
        let library = model.library
        let api = model.api
        let network = model.networkConditions
        let cachePage = model.settings.autoDownloadNewBooks
        let task = Task<UIImage, any Error> {
            let data = try await library.pageData(api: api, network: network, book: book, pageIndex: page, cacheDownloadedPage: cachePage)
            guard let image = await Self.decodeImage(data) else {
                throw ReaderError.invalidImage
            }

            return image
        }

        pageTasks[page] = task
        defer {
            pageTasks[page] = nil
        }

        let image = try await task.value
        images[page] = image
        return image
    }

    /// Keeps only the images around the current page in memory
    private func trimImageCache() {
        let range = (currentPage - 2)...(currentPage + Self.preloadedPageCount + 1)
        images = images.filter { range.contains($0.key) }
    }

    @concurrent
    private static func decodeImage(_ data: Data) async -> UIImage? {
        guard let image = UIImage(data: data) else {
            return nil
        }

        return await image.byPreparingForDisplay() ?? image
    }

    // Actions

    func markAsCompleted() async -> Bool {
        do {
            try await model.markAsRead(book: book)
            return true
        } catch {
            errorMessage = "Failed to mark as completed: \(error.localizedDescription)"
            return false
        }
    }

    func removeFromReadingList() async -> Bool {
        do {
            // Wait for pending progress updates, otherwise the book would be added again to the reading list
            await progressTask?.value
            try await model.removeFromReadingList(book: book)
            return true
        } catch {
            errorMessage = "Failed to remove from reading list: \(error.localizedDescription)"
            return false
        }
    }

    func download() async {
        isDownloading = true
        downloadProgress = 0
        defer {
            isDownloading = false
        }

        do {
            try await model.downloadBook(book) { downloaded, total in
                Task { @MainActor in
                    self.downloadProgress = Double(downloaded) / Double(max(total, 1))
                }
            }
        } catch is CancellationError {
        } catch {
            errorMessage = "Failed to download book: \(error.localizedDescription)"
        }

        await refreshCacheStatus()
    }

    func removeFromCache() async {
        await model.removeFromCache(path: book.path)
        await refreshCacheStatus()
    }

    private func refreshCacheStatus() async {
        cacheStatus = await model.library.store.cacheStatus(path: book.path, pageCount: book.pageCount)
    }
}

enum ReaderError: Error, LocalizedError {
    case invalidImage

    var errorDescription: String? {
        switch self {
        case .invalidImage: "The page is not a valid image"
        }
    }
}
