import ComicsReaderKit
import SwiftUI

struct LibraryView: View {
    @Environment(AppModel.self) private var model
    @State private var search = ""
    @State private var filter = BookFilter.all

    private var filteredBooks: [Book] {
        LibraryService.filterCatalog(model.books, search: search, filter: filter)
    }

    var body: some View {
        content
            .navigationTitle("Comics Reader")
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    if !model.network.isOnline {
                        Label("Offline", systemImage: "wifi.slash")
                            .labelStyle(.titleAndIcon)
                            .foregroundStyle(.orange)
                    }

                    if model.networkConditions.isConstrained {
                        Image(systemName: "arrow.down.circle.dotted")
                            .foregroundStyle(.orange)
                            .accessibilityLabel("Low Data Mode enabled")
                    }

                    NavigationLink(value: Route.settings) {
                        Label("Settings", systemImage: "gearshape")
                    }
                    .keyboardShortcut(",", modifiers: .command)
                }
            }
    }

    @ViewBuilder
    private var content: some View {
        if !model.isConfigured {
            ContentUnavailableView {
                Label("Welcome to Comics Reader", systemImage: "books.vertical")
            } description: {
                Text("Configure the URL of your Comics Reader server to browse your library.")
            } actions: {
                NavigationLink("Open Settings", value: Route.settings)
                    .buttonStyle(.borderedProminent)
            }
        } else if !model.hasLoaded && model.books.isEmpty {
            ProgressView("Loading...")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 32) {
                    banners

                    if !model.inProgressBooks.isEmpty {
                        LibrarySection(title: "Reading List") {
                            BookGrid(books: model.inProgressBooks, showProgress: true)
                        }
                    }

                    if !model.nextToRead.isEmpty {
                        LibrarySection(title: "Up Next") {
                            BookGrid(books: model.nextToRead, showProgress: false)
                        }
                    }

                    let catalog = filteredBooks
                    LibrarySection(title: "Catalog (\(catalog.count))") {
                        Picker("Filter", selection: $filter) {
                            ForEach(BookFilter.allCases, id: \.self) { filter in
                                Text(filter.displayName).tag(filter)
                            }
                        }
                        .pickerStyle(.segmented)
                        .frame(maxWidth: 400)

                        BookGrid(books: catalog, showProgress: false)
                    }
                }
                .padding()
            }
            .searchable(text: $search, prompt: "Search books...")
            .refreshable {
                await model.refresh()
            }
        }
    }

    @ViewBuilder
    private var banners: some View {
        if !model.network.isOnline {
            Banner(message: "You are offline. Some features may be limited.", systemImage: "wifi.slash", tint: .orange)
        }

        if let errorMessage = model.errorMessage {
            Banner(message: errorMessage, systemImage: "exclamationmark.triangle.fill", tint: .red) {
                Button("Retry") {
                    Task { await model.refresh() }
                }
                .buttonStyle(.bordered)
                .disabled(model.isLoading)
            }
        }
    }
}

private struct LibrarySection<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.title2.bold())
            content
        }
    }
}

struct Banner<Actions: View>: View {
    let message: String
    let systemImage: String
    let tint: Color
    @ViewBuilder let actions: Actions

    init(message: String, systemImage: String, tint: Color, @ViewBuilder actions: () -> Actions = { EmptyView() }) {
        self.message = message
        self.systemImage = systemImage
        self.tint = tint
        self.actions = actions()
    }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: systemImage)
                .foregroundStyle(tint)
            Text(message)
                .frame(maxWidth: .infinity, alignment: .leading)
            actions
        }
        .padding()
        .background(tint.opacity(0.15), in: RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .combine)
    }
}
