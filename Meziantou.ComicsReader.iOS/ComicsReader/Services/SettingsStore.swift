import Foundation
import Security

struct AppSettings: Equatable {
    var serverURL = ""
    var token = ""
    var autoDownloadNewBooks = false
    var largeFullscreenProgressBar = false
    var keepScreenAwakeTimeoutMinutes = KeepScreenAwakeTimeout.fifteenMinutes.rawValue
}

/// Duration without user interaction after which the screen is allowed to sleep again while the app is open
enum KeepScreenAwakeTimeout: Int, CaseIterable, Identifiable {
    case off = 0
    case twoMinutes = 2
    case fiveMinutes = 5
    case tenMinutes = 10
    case fifteenMinutes = 15

    var id: Int { rawValue }

    var label: String {
        switch self {
        case .off: "Off"
        case .twoMinutes: "2 minutes"
        case .fiveMinutes: "5 minutes"
        case .tenMinutes: "10 minutes"
        case .fifteenMinutes: "15 minutes"
        }
    }
}

/// Persists the settings in the user defaults, except the token which is stored in the keychain
struct SettingsStore {
    private enum Keys {
        static let serverURL = "serverUrl"
        static let autoDownloadNewBooks = "autoDownloadNewBooks"
        static let largeFullscreenProgressBar = "largeFullscreenProgressBar"
        static let keepScreenAwakeTimeoutMinutes = "keepScreenAwakeTimeoutMinutes"
    }

    private let defaults: UserDefaults
    private let keychainService = "net.meziantou.comicsreader"
    private let keychainAccount = "token"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func load() -> AppSettings {
        AppSettings(
            serverURL: defaults.string(forKey: Keys.serverURL) ?? "",
            token: readToken() ?? "",
            autoDownloadNewBooks: defaults.bool(forKey: Keys.autoDownloadNewBooks),
            largeFullscreenProgressBar: defaults.bool(forKey: Keys.largeFullscreenProgressBar),
            keepScreenAwakeTimeoutMinutes: defaults.object(forKey: Keys.keepScreenAwakeTimeoutMinutes) as? Int ?? KeepScreenAwakeTimeout.fifteenMinutes.rawValue)
    }

    func save(_ settings: AppSettings) throws {
        defaults.set(settings.serverURL, forKey: Keys.serverURL)
        defaults.set(settings.autoDownloadNewBooks, forKey: Keys.autoDownloadNewBooks)
        defaults.set(settings.largeFullscreenProgressBar, forKey: Keys.largeFullscreenProgressBar)
        defaults.set(settings.keepScreenAwakeTimeoutMinutes, forKey: Keys.keepScreenAwakeTimeoutMinutes)
        try saveToken(settings.token)
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
        ]
    }

    private func readToken() -> String? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else {
            return nil
        }

        return String(data: data, encoding: .utf8)
    }

    private func saveToken(_ token: String) throws {
        SecItemDelete(baseQuery as CFDictionary)
        guard !token.isEmpty else {
            return
        }

        var query = baseQuery
        query[kSecValueData as String] = Data(token.utf8)
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock

        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(status), userInfo: [NSLocalizedDescriptionKey: "Unable to save the token in the keychain (\(status))"])
        }
    }
}
