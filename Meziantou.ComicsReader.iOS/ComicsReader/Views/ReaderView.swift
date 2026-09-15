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
    private static let pageSpacing: CGFloat = 16
    private static let pageAnimationDuration = 0.3
    private static let flickVelocity: CGFloat = 500
    private static let edgeResistance: CGFloat = 0.3

    @Bindable var viewModel: ReaderViewModel

    @Environment(\.dismiss) private var dismiss
    @FocusState private var isKeyboardFocused: Bool
    @FocusState private var isPageFieldFocused: Bool
    @State private var pageInput = 1
    @State private var pageWidth: CGFloat = 0
    @State private var dragOffset: CGFloat = 0
    @State private var isHorizontalDrag: Bool?
    @State private var pendingPage: Int?
    @State private var pageAnimationId = 0

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

    /// The current page moves with the finger, and the adjacent page slides in next to it
    private var pageContent: some View {
        ZStack {
            if dragOffset != 0, let neighborPage = viewModel.swipeTargetPage(dragOffset < 0 ? .left : .right) {
                pagePreview(neighborPage)
                    .offset(x: dragOffset < 0 ? dragOffset + pageDistance : dragOffset - pageDistance)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }

            currentPageContent
                .offset(x: dragOffset)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
        .onGeometryChange(for: CGFloat.self) { geometry in
            geometry.size.width
        } action: { width in
            pageWidth = width
        }
    }

    @ViewBuilder
    private var currentPageContent: some View {
        if viewModel.isAtEnd {
            CompletionView(title: viewModel.book.title) {
                Task {
                    if await viewModel.markAsCompleted() {
                        dismiss()
                    }
                }
            }
            .gesture(pageDragGesture)
        } else if let image = viewModel.image {
            ZoomableImageView(
                image: image,
                onHorizontalDragChanged: updatePageDrag,
                onHorizontalDragEnded: endPageDrag,
                onVerticalSwipe: { viewModel.toggleFullscreen() },
                onTap: viewModel.isFullscreen ? { animatePageChange(.left) } : nil,
                onDoubleTap: viewModel.isFullscreen ? nil : { viewModel.toggleFullscreen() })
            .accessibilityLabel("Page \(viewModel.currentPage + 1)")
        } else {
            ZStack {
                if viewModel.showLoadingIndicator {
                    loadingIndicator
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(Rectangle())
            .gesture(pageDragGesture)
        }
    }

    @ViewBuilder
    private func pagePreview(_ page: Int) -> some View {
        if page >= viewModel.book.pageCount {
            CompletionView(title: viewModel.book.title) {}
        } else if let image = viewModel.loadedImage(page: page) {
            Image(uiImage: image)
                .resizable()
                .scaledToFit()
                .accessibilityIgnoresInvertColors()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            loadingIndicator
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var loadingIndicator: some View {
        ProgressView("Loading page...")
            .tint(viewModel.isFullscreen ? .white : nil)
            .foregroundStyle(viewModel.isFullscreen ? .white : .primary)
    }

    /// Drag gesture for the views that are not handled by the zoomable image view
    private var pageDragGesture: some Gesture {
        // Use the global coordinates, as the view moves with the finger
        DragGesture(minimumDistance: 10, coordinateSpace: .global)
            .onChanged { value in
                if isHorizontalDrag == nil {
                    isHorizontalDrag = abs(value.translation.width) >= abs(value.translation.height)
                }

                if isHorizontalDrag == true {
                    updatePageDrag(translation: value.translation.width)
                }
            }
            .onEnded { value in
                if isHorizontalDrag == true {
                    endPageDrag(translation: value.translation.width, velocity: value.velocity.width)
                } else if abs(value.translation.height) > ZoomingImageScrollView.verticalSwipeDistance {
                    viewModel.toggleFullscreen()
                }

                isHorizontalDrag = nil
            }
    }

    @ViewBuilder
    private var pageControls: some View {
        Button("First", systemImage: "backward.end") {
            goToPage(0)
        }
        .disabled(viewModel.currentPage == 0)

        Button("Previous", systemImage: "chevron.backward") {
            animatePageChange(.right)
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
            animatePageChange(.left)
        }
        .disabled(viewModel.isAtEnd)

        Button("Last", systemImage: "forward.end") {
            goToPage(viewModel.book.pageCount - 1)
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

    // Page navigation

    /// Distance between the positions of two adjacent pages
    private var pageDistance: CGFloat {
        pageWidth + Self.pageSpacing
    }

    private func updatePageDrag(translation: CGFloat) {
        completePendingPageChange()

        // Resist the drag when there is no page in this direction
        let hasTargetPage = viewModel.swipeTargetPage(translation < 0 ? .left : .right) != nil
        dragOffset = hasTargetPage ? translation : translation * Self.edgeResistance
    }

    private func endPageDrag(translation: CGFloat, velocity: CGFloat) {
        let direction: SwipeDirection = translation < 0 ? .left : .right
        let isFlick = abs(velocity) > Self.flickVelocity && (velocity < 0) == (translation < 0)
        let isPastHalfPage = abs(translation) > pageWidth / 2
        if translation != 0 && (isFlick || isPastHalfPage) && viewModel.swipeTargetPage(direction) != nil {
            animatePageChange(direction, velocity: velocity)
        } else {
            withAnimation(.interpolatingSpring(duration: Self.pageAnimationDuration, bounce: 0.1)) {
                dragOffset = 0
            }
        }
    }

    /// Slides the current page out of the screen, and then displays the target page
    private func animatePageChange(_ direction: SwipeDirection, velocity: CGFloat = 0) {
        completePendingPageChange()
        guard let targetPage = viewModel.swipeTargetPage(direction) else {
            return
        }

        guard pageWidth > 0 else {
            viewModel.goToPage(targetPage)
            return
        }

        let targetOffset = direction == .left ? -pageDistance : pageDistance
        let remainingDistance = targetOffset - dragOffset

        // The spring velocity is relative to the animated distance, so the page keeps the speed of the finger
        let relativeVelocity = remainingDistance == 0 ? 0 : min(max(velocity / remainingDistance, 0), 20)

        pendingPage = targetPage
        pageAnimationId += 1
        let animationId = pageAnimationId
        withAnimation(.interpolatingSpring(duration: Self.pageAnimationDuration, bounce: 0, initialVelocity: relativeVelocity)) {
            dragOffset = targetOffset
        } completion: {
            if pageAnimationId == animationId {
                completePendingPageChange()
            }
        }
    }

    /// Displays the page of the running page animation without waiting for the end of the animation
    private func completePendingPageChange() {
        guard let page = pendingPage else {
            return
        }

        pendingPage = nil
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            viewModel.goToPage(page)
            dragOffset = 0
        }
    }

    private func goToPage(_ page: Int) {
        completePendingPageChange()
        viewModel.goToPage(page)
    }

    private func commitPageInput() {
        let targetPage = min(max(pageInput, 1), viewModel.book.pageCount)
        pageInput = targetPage
        if targetPage - 1 != viewModel.currentPage {
            goToPage(targetPage - 1)
        }
    }

    private func handleKeyPress(_ key: KeyEquivalent) -> KeyPress.Result {
        guard !isPageFieldFocused else {
            return .ignored
        }

        switch key {
        case .rightArrow, .pageDown:
            animatePageChange(.left)
        case .leftArrow, .pageUp:
            animatePageChange(.right)
        case .escape:
            viewModel.isFullscreen = false
        default:
            viewModel.toggleFullscreen()
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
