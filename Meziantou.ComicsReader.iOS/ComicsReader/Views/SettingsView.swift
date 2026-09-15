import ComicsReaderKit
import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var model

    @State private var serverURL = ""
    @State private var token = ""
    @State private var isSaving = false
    @State private var isReindexing = false
    @State private var message: StatusMessage?
    @State private var cachedBooks: [CachedBook] = []
    @State private var cachedPageCounts: [String: Int] = [:]
    @State private var statistics: CacheStatistics?
    @State private var serverVersion: String?
    @State private var pendingConfirmation: Confirmation?

    private var hasServerChanges: Bool {
        serverURL != model.settings.serverURL || token != model.settings.token
    }

    var body: some View {
        Form {
            if let message {
                Section {
                    Label(message.text, systemImage: message.isError ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                        .foregroundStyle(message.isError ? .red : .green)
                }
            }

            serverSection
            optionsSection
            serverActionsSection
            cacheManagementSection
            cachedBooksSection
            aboutSection
        }
        .navigationTitle("Settings")
        .onAppear {
            serverURL = model.settings.serverURL
            token = model.settings.token
        }
        .task(id: model.settings.autoDownloadNewBooks) {
            await loadCacheInfo()

            // Show the progress of the automatic downloads
            while model.settings.autoDownloadNewBooks && !Task.isCancelled {
                try? await Task.sleep(for: .seconds(2))
                await loadCacheInfo()
            }
        }
        .task(id: "\(model.settings.serverURL)|\(model.network.isOnline)") {
            await loadServerVersion()
        }
        .confirmationDialog(
            pendingConfirmation?.title ?? "",
            isPresented: Binding(get: { pendingConfirmation != nil }, set: { if !$0 { pendingConfirmation = nil } }),
            titleVisibility: .visible,
            presenting: pendingConfirmation
        ) { confirmation in
            Button(confirmation.actionTitle, role: .destructive) {
                Task { await clear(confirmation.scope) }
            }
        }
    }

    private var serverSection: some View {
        Section {
            TextField("Server URL", text: $serverURL, prompt: Text("https://comics-reader.example.com"))
                .keyboardType(.URL)
                .textContentType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .onSubmit(save)

            SecureField("Authentication Token", text: $token, prompt: Text("Optional authentication token"))
                .textContentType(.password)
                .onSubmit(save)

            Button(action: save) {
                if isSaving {
                    ProgressView()
                } else {
                    Text("Save Settings")
                }
            }
            .disabled(isSaving || serverURL.trimmingCharacters(in: .whitespaces).isEmpty || !hasServerChanges)
        } header: {
            Text("Server")
        }
    }

    private var optionsSection: some View {
        Section {
            Toggle("Auto-download new books for offline reading", isOn: settingBinding(\.autoDownloadNewBooks) { try await model.setAutoDownloadNewBooks($0) })
            Toggle("Large progress bar in fullscreen", isOn: settingBinding(\.largeFullscreenProgressBar) { try await model.setLargeFullscreenProgressBar($0) })
        } header: {
            Text("Reading")
        } footer: {
            Text("Books are downloaded automatically only on Wi-Fi when Low Data Mode is disabled. The large progress bar displays the page number in fullscreen mode.")
        }
    }

    private var serverActionsSection: some View {
        Section {
            Button {
                Task { await refreshCatalog() }
            } label: {
                HStack {
                    Text(isReindexing ? "Refreshing..." : "Refresh Catalog")
                    if isReindexing {
                        Spacer()
                        ProgressView()
                    }
                }
            }
            .disabled(isReindexing || !model.network.isOnline || !model.isConfigured)
        } header: {
            Text("Server Actions")
        } footer: {
            if !model.network.isOnline {
                Text("Catalog refresh not available while offline")
            }
        }
    }

    private var cacheManagementSection: some View {
        Section {
            if let statistics {
                LabeledContent("Books", value: statistics.books, format: .number)
                LabeledContent("Covers", value: statistics.covers, format: .number)
                LabeledContent("Pages", value: statistics.pages, format: .number)
                LabeledContent("Total", value: StringUtilities.formatFileSize(statistics.totalSizeBytes))
            }

            Button("Clear All Pages") {
                pendingConfirmation = .init(scope: .pages, title: "Clear all cached pages? Book information and covers are kept.", actionTitle: "Clear All Pages")
            }

            Button("Clear All Covers") {
                pendingConfirmation = .init(scope: .covers, title: "Clear all cached covers?", actionTitle: "Clear All Covers")
            }

            Button("Clear Everything", role: .destructive) {
                pendingConfirmation = .init(scope: .everything, title: "Clear all cached data? This includes books, covers, and pages.", actionTitle: "Clear Everything")
            }
        } header: {
            Text("Cache Management")
        } footer: {
            Text("Clear Pages removes cached page images but keeps book information and covers. Clear Covers removes cached cover images. Clear Everything removes all cached data.")
        }
    }

    private var cachedBooksSection: some View {
        Section {
            if cachedBooks.isEmpty {
                Text("No books cached for offline reading")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(cachedBooks) { cachedBook in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(cachedBook.book.title)
                            Text(cachedBookDetails(cachedBook))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        Spacer()

                        Button("Remove", role: .destructive) {
                            Task { await removeFromCache(cachedBook.path) }
                        }
                        .buttonStyle(.borderless)
                    }
                }
                .onDelete { offsets in
                    let paths = offsets.map { cachedBooks[$0].path }
                    Task {
                        for path in paths {
                            await removeFromCache(path)
                        }
                    }
                }
            }
        } header: {
            HStack {
                Text("Cached Books (\(cachedBooks.count))")
                Spacer()
                if !cachedBooks.isEmpty {
                    Button("Clear All Cache", role: .destructive) {
                        pendingConfirmation = .init(scope: .everything, title: "Clear all cached books?", actionTitle: "Clear All Cache")
                    }
                    .font(.caption)
                }
            }
        }
    }

    private var aboutSection: some View {
        Section("About") {
            LabeledContent("App Version", value: Self.appVersion)
            if let serverVersion {
                LabeledContent("Server Version", value: serverVersion)
            }
        }
    }

    private static var appVersion: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "dev"
        let build = info?["CFBundleVersion"] as? String ?? ""
        return build.isEmpty ? version : "\(version) (\(build))"
    }

    private func cachedBookDetails(_ cachedBook: CachedBook) -> String {
        let book = cachedBook.book
        let status = cachedBook.fullyDownloaded
            ? "Complete"
            : "\(cachedPageCounts[book.path] ?? 0)/\(book.pageCount) cached"
        return "\(StringUtilities.formatFileSize(book.fileSize)) • \(book.pageCount) pages • \(status)"
    }

    private func settingBinding(_ keyPath: KeyPath<AppSettings, Bool>, update: @escaping (Bool) async throws -> Void) -> Binding<Bool> {
        Binding(
            get: { model.settings[keyPath: keyPath] },
            set: { value in
                Task {
                    do {
                        try await update(value)
                    } catch {
                        message = StatusMessage(text: error.localizedDescription, isError: true)
                    }
                }
            })
    }

    private func save() {
        guard hasServerChanges, !isSaving else {
            return
        }

        var newSettings = model.settings
        newSettings.serverURL = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)
        newSettings.token = token
        isSaving = true
        message = nil

        Task {
            defer { isSaving = false }
            do {
                try await model.updateSettings(newSettings)
                serverURL = model.settings.serverURL
                message = StatusMessage(text: "Settings saved successfully", isError: false)
                await loadServerVersion()
            } catch {
                message = StatusMessage(text: error.localizedDescription, isError: true)
            }
        }
    }

    private func refreshCatalog() async {
        isReindexing = true
        message = nil
        defer { isReindexing = false }

        do {
            try await model.triggerReindex()
            message = StatusMessage(text: "Catalog refreshed successfully", isError: false)
        } catch {
            message = StatusMessage(text: error.localizedDescription, isError: true)
        }
    }

    private func loadServerVersion() async {
        guard model.network.isOnline, let api = model.api else {
            serverVersion = nil
            return
        }

        serverVersion = try? await api.getVersion().version
    }

    private func loadCacheInfo() async {
        let store = model.library.store
        let books = await store.cachedBooks()
        var counts: [String: Int] = [:]
        for cachedBook in books where !cachedBook.fullyDownloaded {
            counts[cachedBook.path] = await store.cachedPageCount(path: cachedBook.path)
        }

        cachedBooks = books
        cachedPageCounts = counts
        statistics = await store.statistics()
    }

    private func removeFromCache(_ path: String) async {
        await model.removeFromCache(path: path)
        await loadCacheInfo()
        message = StatusMessage(text: "Book removed from cache", isError: false)
    }

    private func clear(_ scope: CacheClearScope) async {
        await model.clearCache(scope)
        await loadCacheInfo()
        message = switch scope {
        case .pages: StatusMessage(text: "All cached pages removed", isError: false)
        case .covers: StatusMessage(text: "All cached covers removed", isError: false)
        case .everything: StatusMessage(text: "All cached data removed", isError: false)
        }
    }
}

private struct StatusMessage: Equatable {
    let text: String
    let isError: Bool
}

private struct Confirmation {
    let scope: CacheClearScope
    let title: String
    let actionTitle: String
}
