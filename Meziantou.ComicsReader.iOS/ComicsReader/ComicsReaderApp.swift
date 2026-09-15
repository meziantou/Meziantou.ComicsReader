import SwiftUI

@main
struct ComicsReaderApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
        }
    }
}

enum Route: Hashable {
    case reader(path: String)
    case settings
}

struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase
    @State private var path: [Route] = []

    var body: some View {
        NavigationStack(path: $path) {
            LibraryView()
                .navigationDestination(for: Route.self) { route in
                    switch route {
                    case .reader(let bookPath):
                        ReaderView(path: bookPath)
                    case .settings:
                        SettingsView()
                    }
                }
        }
        .task {
            await model.start()
        }
        .task(id: scenePhase) {
            guard scenePhase == .active else {
                return
            }

            await model.runBackgroundRefreshLoop()
        }
        .onChange(of: scenePhase) { oldPhase, newPhase in
            if oldPhase == .background && newPhase != .background {
                Task { await model.refresh(isBackgroundRefresh: true) }
            }
        }
    }
}
