import ComicsReaderKit
import SwiftUI

struct BookGrid: View {
    let books: [Book]
    let showProgress: Bool

    private let columns = [GridItem(.adaptive(minimum: 160, maximum: 200), spacing: 16, alignment: .top)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: 20) {
            ForEach(books) { book in
                NavigationLink(value: Route.reader(path: book.path)) {
                    BookCell(book: book, showProgress: showProgress)
                }
                .buttonStyle(.plain)
                .contextMenu {
                    BookContextMenu(book: book)
                }
            }
        }
    }
}

struct BookCell: View {
    @Environment(AppModel.self) private var model
    let book: Book
    let showProgress: Bool

    private var progress: Int? {
        guard showProgress, let currentPage = book.currentPage, currentPage >= 0 else {
            return nil
        }

        return currentPage
    }

    var body: some View {
        VStack(spacing: 6) {
            BookCoverView(book: book)
                .frame(width: 150, height: 200)
                .overlay(alignment: .bottomLeading) {
                    if let progress {
                        GeometryReader { geometry in
                            Rectangle()
                                .fill(Color.accentColor)
                                .frame(width: geometry.size.width * Double(progress + 1) / Double(max(book.pageCount, 1)), height: 8)
                                .frame(maxHeight: .infinity, alignment: .bottom)
                        }
                    }
                }
                .overlay(alignment: .topTrailing) {
                    if let fullyDownloaded = model.cachedBooksInfo[book.path] {
                        CacheBadge(fullyDownloaded: fullyDownloaded)
                            .padding(4)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .shadow(color: .black.opacity(0.2), radius: 4, y: 2)

            VStack(spacing: 2) {
                if let directory = book.directory {
                    Text("\(directory)/")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Text(book.title)
                    .font(.subheadline.weight(.semibold))

                Group {
                    if let progress {
                        Text("page \(progress + 1) / \(book.pageCount)")
                    } else {
                        Text("\(book.pageCount) pages")
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            .multilineTextAlignment(.center)
            .frame(width: 150)
        }
        .frame(maxWidth: .infinity)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

struct BookCoverView: View {
    @Environment(AppModel.self) private var model
    let book: Book
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            if let image = image ?? model.covers.cachedImage(for: book.path) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                Rectangle()
                    .fill(.fill.secondary)
                    .overlay {
                        Image(systemName: "book.closed")
                            .font(.largeTitle)
                            .foregroundStyle(.secondary)
                    }
            }
        }
        .task(id: book.path) {
            image = await model.covers.image(for: book, api: model.api, network: model.networkConditions, library: model.library)
        }
    }
}

private struct CacheBadge: View {
    let fullyDownloaded: Bool

    var body: some View {
        Image(systemName: fullyDownloaded ? "checkmark.circle.fill" : "circle.lefthalf.filled")
            .font(.system(size: 18, weight: .bold))
            .foregroundStyle(.white, fullyDownloaded ? .green : .orange)
            .background(Circle().fill(fullyDownloaded ? .green : .orange))
            .accessibilityLabel(fullyDownloaded ? "Available offline" : "Partially available offline")
    }
}

private struct BookContextMenu: View {
    @Environment(AppModel.self) private var model
    let book: Book

    var body: some View {
        if model.network.isOnline && model.cachedBooksInfo[book.path] != true {
            Button("Download", systemImage: "arrow.down.circle") {
                Task { try? await model.downloadBook(book) { _, _ in } }
            }
        }

        if model.cachedBooksInfo[book.path] != nil {
            Button("Remove from Cache", systemImage: "trash") {
                Task { await model.removeFromCache(path: book.path) }
            }
        }

        if book.currentPage != nil && !book.isCompleted {
            Button("Remove from Reading List", systemImage: "minus.circle") {
                Task { try? await model.removeFromReadingList(book: book) }
            }
        }
    }
}
