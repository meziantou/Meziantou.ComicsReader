import Foundation
import Security

struct AppSettings: Equatable {
    var serverURL = ""
    var token = ""
    var autoDownloadNewBooks = false
    var largeFullscreenProgressBar = false
}

/// Persists the settings in the user defaults, except the token which is stored in the keychain
struct SettingsStore {
    private enum Keys {
        static let serverURL = "serverUrl"
        static let autoDownloadNewBooks = "autoDownloadNewBooks"
        static let largeFullscreenProgressBar = "largeFullscreenProgressBar"
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
            largeFullscreenProgressBar: defaults.bool(forKey: Keys.largeFullscreenProgressBar))
    }

    func save(_ settings: AppSettings) throws {
        defaults.set(settings.serverURL, forKey: Keys.serverURL)
        defaults.set(settings.autoDownloadNewBooks, forKey: Keys.autoDownloadNewBooks)
        defaults.set(settings.largeFullscreenProgressBar, forKey: Keys.largeFullscreenProgressBar)
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
