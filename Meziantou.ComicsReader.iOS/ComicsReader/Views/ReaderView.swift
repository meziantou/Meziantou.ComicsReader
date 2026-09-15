import ComicsReaderKit
import SwiftUI

struct ReaderView: View {
    let path: String

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var viewModel: ReaderViewModel?

    var body: some View {
        Group {
            if let viewModel {
                ReaderContentView(viewModel: viewModel)
            } else if !model.hasLoaded || model.isLoading {
                ProgressView("Loading...")
            } else {
                ContentUnavailableView {
                    Label("Book not found", systemImage: "book.closed")
                } description: {
                    Text(model.errorMessage ?? path)
                } actions: {
                    Button("Back to Library") {
                        dismiss()
                    }
                }
            }
        }
        .onChange(of: model.books.count, initial: true) {
            // Keep the first resolved book, so progress updates don't reset the reader
            if viewModel == nil, let book = model.book(path: path) {
                viewModel = ReaderViewModel(model: model, book: book)
            }
        }
    }
}

private struct ReaderContentView: View {
    @Bindable var viewModel: ReaderViewModel

    @Environment(\.dismiss) private var dismiss
    @FocusState private var isKeyboardFocused: Bool
    @FocusState private var isPageFieldFocused: Bool
    @State private var pageInput = 1

    var body: some View {
        ZStack(alignment: .top) {
            (viewModel.isFullscreen ? Color.black : Color(.systemBackground))
                .ignoresSafeArea()

            VStack(spacing: 0) {
                ReadingProgressBar(
                    progress: viewModel.progress,
                    isLarge: viewModel.largeProgressBar,
                    text: "\(viewModel.displayedPageNumber) / \(viewModel.book.pageCount)")

                pageContent
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .ignoresSafeArea(edges: viewModel.isFullscreen ? .all : [])

            if let errorMessage = viewModel.errorMessage {
                Banner(message: errorMessage, systemImage: "exclamationmark.triangle.fill", tint: .red) {
                    Button("Dismiss", systemImage: "xmark") {
                        viewModel.errorMessage = nil
                    }
                    .labelStyle(.iconOnly)
                }
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                .padding()
                .frame(maxWidth: 600)
            }
        }
        .navigationTitle(viewModel.book.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(viewModel.isFullscreen ? .hidden : .visible, for: .navigationBar, .bottomBar)
        .statusBarHidden(viewModel.isFullscreen)
        .persistentSystemOverlays(viewModel.isFullscreen ? .hidden : .automatic)
        .animation(.easeInOut(duration: 0.2), value: viewModel.isFullscreen)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button("Fullscreen", systemImage: "arrow.up.left.and.arrow.down.right") {
                    viewModel.toggleFullscreen()
                }

                actionsMenu
            }

            ToolbarItemGroup(placement: .bottomBar) {
                pageControls
            }
        }
        .focusable()
        .focused($isKeyboardFocused)
        .focusEffectDisabled()
        .onKeyPress(keys: [.rightArrow, .pageDown, .leftArrow, .pageUp, .escape, "f"]) { keyPress in
            handleKeyPress(keyPress.key)
        }
        .onAppear {
            viewModel.start()
            isKeyboardFocused = true
        }
        .onDisappear {
            viewModel.stop()
        }
        .onChange(of: viewModel.currentPage, initial: true) {
            pageInput = viewModel.displayedPageNumber
        }
    }

    @ViewBuilder
    private var pageContent: some View {
        if viewModel.isAtEnd {
            CompletionView(title: viewModel.book.title) {
                Task {
                    if await viewModel.markAsCompleted() {
                        dismiss()
                    }
                }
            }
            .gesture(swipeGesture)
            .transition(pageTransition)
        } else if let image = viewModel.image {
            ZoomableImageView(
                image: image,
                onSwipe: handleSwipe,
                onTap: viewModel.isFullscreen ? { viewModel.goToNextPage() } : nil,
                onDoubleTap: viewModel.isFullscreen ? nil : { viewModel.toggleFullscreen() })
            .id(viewModel.currentPage)
            .transition(pageTransition)
            .accessibilityLabel("Page \(viewModel.currentPage + 1)")
        } else {
            ZStack {
                if viewModel.showLoadingIndicator {
                    ProgressView("Loading page...")
                        .tint(viewModel.isFullscreen ? .white : nil)
                        .foregroundStyle(viewModel.isFullscreen ? .white : .primary)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(Rectangle())
            .gesture(swipeGesture)
        }
    }

    private var pageTransition: AnyTransition {
        .push(from: viewModel.isMovingForward ? .trailing : .leading)
    }

    /// Swipe gesture for the views that are not handled by the zoomable image view
    private var swipeGesture: some Gesture {
        DragGesture(minimumDistance: 50)
            .onEnded { value in
                let horizontal = value.translation.width
                let vertical = value.translation.height
                if abs(horizontal) > abs(vertical) {
                    handleSwipe(horizontal < 0 ? .left : .right)
                } else {
                    handleSwipe(vertical < 0 ? .up : .down)
                }
            }
    }

    @ViewBuilder
    private var pageControls: some View {
        Button("First", systemImage: "backward.end") {
            viewModel.goToFirstPage()
        }
        .disabled(viewModel.currentPage == 0)

        Button("Previous", systemImage: "chevron.backward") {
            viewModel.goToPreviousPage()
        }
        .disabled(viewModel.currentPage == 0)

        Spacer()

        HStack(spacing: 6) {
            TextField("Page", value: $pageInput, format: .number)
                .keyboardType(.numberPad)
                .multilineTextAlignment(.center)
                .textFieldStyle(.roundedBorder)
                .frame(width: 70)
                .focused($isPageFieldFocused)
                .onSubmit(commitPageInput)
                .accessibilityLabel("Page number")
            Text("/ \(viewModel.book.pageCount)")
                .monospacedDigit()
        }
        .onChange(of: isPageFieldFocused) { _, isFocused in
            if !isFocused {
                commitPageInput()
                isKeyboardFocused = true
            }
        }

        Spacer()

        Button("Next", systemImage: "chevron.forward") {
            viewModel.goToNextPage()
        }
        .disabled(viewModel.isAtEnd)

        Button("Last", systemImage: "forward.end") {
            viewModel.goToLastPage()
        }
        .disabled(viewModel.currentPage == viewModel.book.pageCount - 1)
    }

    private var actionsMenu: some View {
        Menu("Actions", systemImage: "ellipsis.circle") {
            Button("Remove from Reading List", systemImage: "minus.circle") {
                Task {
                    if await viewModel.removeFromReadingList() {
                        dismiss()
                    }
                }
            }

            if viewModel.isOnline && viewModel.cacheStatus?.isFullyDownloaded != true {
                Button(viewModel.isDownloading ? "Downloading \(Int(viewModel.downloadProgress * 100))%" : "Download", systemImage: "arrow.down.circle") {
                    Task { await viewModel.download() }
                }
                .disabled(viewModel.isDownloading)
            }

            if viewModel.cacheStatus?.isCached == true {
                Button("Remove from Cache", systemImage: "trash", role: .destructive) {
                    Task { await viewModel.removeFromCache() }
                }
            }
        }
    }

    private func handleSwipe(_ direction: SwipeDirection) {
        withAnimation(.easeOut(duration: 0.2)) {
            viewModel.handleSwipe(direction)
        }
    }

    private func commitPageInput() {
        let targetPage = min(max(pageInput, 1), viewModel.book.pageCount)
        pageInput = targetPage
        viewModel.goToPage(targetPage - 1)
    }

    private func handleKeyPress(_ key: KeyEquivalent) -> KeyPress.Result {
        guard !isPageFieldFocused else {
            return .ignored
        }

        withAnimation(.easeOut(duration: 0.2)) {
            switch key {
            case .rightArrow, .pageDown:
                viewModel.goToNextPage()
            case .leftArrow, .pageUp:
                viewModel.goToPreviousPage()
            case .escape:
                viewModel.isFullscreen = false
            default:
                viewModel.toggleFullscreen()
            }
        }

        return .handled
    }
}

private struct ReadingProgressBar: View {
    let progress: Double
    let isLarge: Bool
    let text: String

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Rectangle()
                    .fill(Color.gray.opacity(0.3))
                Rectangle()
                    .fill(Color.accentColor)
                    .frame(width: geometry.size.width * progress)

                if isLarge {
                    Text(text)
                        .font(.caption.bold().monospacedDigit())
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                }
            }
        }
        .frame(height: isLarge ? 24 : 4)
        .accessibilityElement()
        .accessibilityLabel("Reading progress")
        .accessibilityValue(text)
    }
}

private struct CompletionView: View {
    let title: String
    let markAsCompleted: () -> Void

    var body: some View {
        VStack {
            Button(action: markAsCompleted) {
                VStack(spacing: 8) {
                    Label("Mark as completed", systemImage: "checkmark.circle.fill")
                        .font(.title.bold())
                    Text(title)
                        .font(.title3)
                }
                .padding(.horizontal, 32)
                .padding(.vertical, 24)
            }
            .buttonStyle(.borderedProminent)
            .tint(.green)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .contentShape(Rectangle())
    }
}
