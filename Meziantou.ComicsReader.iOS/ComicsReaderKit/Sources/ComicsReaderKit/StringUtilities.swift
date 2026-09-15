import Foundation

public enum StringUtilities {
    /// Normalizes a string for accent-insensitive and case-insensitive comparison
    public static func normalize(_ value: String) -> String {
        value.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil)
    }

    /// Checks if a string contains another string (accent and case insensitive)
    public static func containsInsensitive(_ text: String, _ search: String) -> Bool {
        let search = normalize(search)
        return search.isEmpty || normalize(text).contains(search)
    }

    /// Formats a file size to a human readable format (e.g. "1.5 KB")
    public static func formatFileSize(_ bytes: Int64) -> String {
        guard bytes > 0 else {
            return "0 B"
        }

        let units = ["B", "KB", "MB", "GB", "TB"]
        let exponent = min(Int(log(Double(bytes)) / log(1024)), units.count - 1)
        let value = Double(bytes) / pow(1024, Double(exponent))
        let rounded = (value * 10).rounded() / 10
        let formatted = rounded == rounded.rounded() ? String(Int(rounded)) : String(format: "%.1f", locale: Locale(identifier: "en_US_POSIX"), rounded)
        return "\(formatted) \(units[exponent])"
    }
}
