import Foundation

public enum APIError: Error, LocalizedError, Equatable, Sendable {
    /// The server URL configured in the settings is not a valid http(s) URL
    case invalidServerURL(String)

    /// The server answered with a non-success status code
    case http(status: Int)

    /// The server cannot be reached (network failure or timeout)
    case network(server: String, isTimeout: Bool, timeoutSeconds: Int)

    /// The server answered with an unexpected payload
    case invalidResponse(String)

    public var errorDescription: String? {
        switch self {
        case .invalidServerURL(let url):
            "The server URL \"\(url)\" is invalid. Check the server URL in Settings."
        case .http(let status) where status == 401 || status == 403:
            "Authentication failed (\(Self.statusText(status))). Check the access token in Settings."
        case .http(let status):
            "Server error (\(Self.statusText(status)))"
        case .network(let server, true, let timeoutSeconds):
            "The server \(server) did not respond within \(timeoutSeconds) seconds."
        case .network(let server, false, _):
            "Unable to reach the server \(server)."
        case .invalidResponse(let message):
            "Invalid response from the server: \(message)"
        }
    }

    public var isNetworkError: Bool {
        if case .network = self {
            return true
        }

        return false
    }

    public var statusCode: Int? {
        if case .http(let status) = self {
            return status
        }

        return nil
    }

    private static func statusText(_ status: Int) -> String {
        "\(status) \(HTTPURLResponse.localizedString(forStatusCode: status).capitalized)"
    }
}

/// Operations exposed by the Comics Reader server
public protocol ComicsAPI: Sendable {
    func getBooks() async throws -> BooksResponse
    func getPage(path: String, pageIndex: Int) async throws -> Data
    func getCover(path: String) async throws -> Data
    func markAsRead(path: String) async throws
    func getReadingList(includeCompleted: Bool) async throws -> ReadingListResponse
    func getReadingListItem(path: String) async throws -> ReadingListItem?
    func updateReadingProgress(path: String, pageIndex: Int) async throws -> ReadingListResponse
    func removeFromReadingList(path: String) async throws -> ReadingListResponse
    func getIndexingStatus() async throws -> IndexingStatus
    func triggerReindex() async throws
    func getVersion() async throws -> VersionResponse
}

public final class APIClient: ComicsAPI {
    public static let defaultRequestTimeout: TimeInterval = 15
    public static let defaultImageRequestTimeout: TimeInterval = 60

    public let baseURL: URL
    private let token: String?
    private let session: URLSession
    private let requestTimeout: TimeInterval
    private let imageRequestTimeout: TimeInterval

    public init(
        serverURL: String,
        token: String?,
        session: URLSession = .shared,
        requestTimeout: TimeInterval = APIClient.defaultRequestTimeout,
        imageRequestTimeout: TimeInterval = APIClient.defaultImageRequestTimeout
    ) throws(APIError) {
        guard let baseURL = Self.normalizeServerURL(serverURL) else {
            throw .invalidServerURL(serverURL)
        }

        self.baseURL = baseURL
        self.token = token?.isEmpty == false ? token : nil
        self.session = session
        self.requestTimeout = requestTimeout
        self.imageRequestTimeout = imageRequestTimeout
    }

    /// Validates the server URL and removes trailing slashes
    public static func normalizeServerURL(_ value: String) -> URL? {
        var trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        while trimmed.hasSuffix("/") {
            trimmed.removeLast()
        }

        guard let url = URL(string: trimmed),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              url.host() != nil else {
            return nil
        }

        return url
    }

    /// Encodes a value the same way as JavaScript's encodeURIComponent, so slashes in book paths are escaped
    public static func encodePathComponent(_ value: String) -> String {
        var allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
        allowed.insert(charactersIn: "-_.!~*'()")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }

    func makeURL(_ path: String) -> URL {
        // The path is already percent-encoded, so build the URL from the string to keep %2F as-is
        URL(string: baseURL.absoluteString + "/api/v1" + path)!
    }

    private func bookURL(_ bookPath: String, _ suffix: String) -> URL {
        makeURL("/books/\(Self.encodePathComponent(bookPath))\(suffix)")
    }

    private func readingListURL(_ bookPath: String) -> URL {
        makeURL("/reading-list/\(Self.encodePathComponent(bookPath))")
    }

    // Books

    public func getBooks() async throws -> BooksResponse {
        try await sendJSON(makeURL("/books"))
    }

    public func getBookPages(path: String) async throws -> PagesResponse {
        try await sendJSON(bookURL(path, "/pages"))
    }

    public func getPage(path: String, pageIndex: Int) async throws -> Data {
        try await send(bookURL(path, "/pages/\(pageIndex)"), timeout: imageRequestTimeout)
    }

    public func getCover(path: String) async throws -> Data {
        try await send(bookURL(path, "/cover"), timeout: imageRequestTimeout)
    }

    public func markAsRead(path: String) async throws {
        _ = try await send(bookURL(path, "/mark-as-read"), method: "POST", timeout: requestTimeout)
    }

    // Reading progress

    public func getReadingList(includeCompleted: Bool = false) async throws -> ReadingListResponse {
        try await sendJSON(makeURL("/reading-list?includeCompleted=\(includeCompleted)"))
    }

    public func getReadingListItem(path: String) async throws -> ReadingListItem? {
        do {
            return try await sendJSON(readingListURL(path))
        } catch APIError.http(status: 404) {
            return nil
        }
    }

    public func updateReadingProgress(path: String, pageIndex: Int) async throws -> ReadingListResponse {
        let body = try JSONCoding.makeEncoder().encode(UpdateReadingProgressRequest(pageIndex: pageIndex))
        return try await sendJSON(readingListURL(path), method: "PUT", body: body)
    }

    public func removeFromReadingList(path: String) async throws -> ReadingListResponse {
        try await sendJSON(readingListURL(path), method: "DELETE")
    }

    // Indexing

    public func getIndexingStatus() async throws -> IndexingStatus {
        try await sendJSON(makeURL("/indexing/status"))
    }

    public func triggerReindex() async throws {
        _ = try await send(makeURL("/indexing/reindex"), method: "POST", timeout: requestTimeout)
    }

    // Version

    public func getVersion() async throws -> VersionResponse {
        try await sendJSON(makeURL("/version"))
    }

    // Transport

    private func sendJSON<T: Decodable & Sendable>(_ url: URL, method: String = "GET", body: Data? = nil) async throws -> T {
        let data = try await send(url, method: method, body: body, timeout: requestTimeout)
        do {
            return try JSONCoding.makeDecoder().decode(T.self, from: data)
        } catch {
            throw APIError.invalidResponse(String(describing: error))
        }
    }

    private func send(_ url: URL, method: String = "GET", body: Data? = nil, timeout: TimeInterval) async throws -> Data {
        var request = URLRequest(url: url, timeoutInterval: timeout)
        request.httpMethod = method
        request.httpBody = body
        if body != nil {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await withTimeout(timeout) { [session, request] in
            try await session.data(for: request)
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse("Not an HTTP response")
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            throw APIError.http(status: httpResponse.statusCode)
        }

        return data
    }

    // Abort the whole operation (not only when the connection is idle) if it exceeds the timeout
    private func withTimeout<T: Sendable>(_ timeout: TimeInterval, operation: @escaping @Sendable () async throws -> T) async throws -> T {
        let serverName = baseURL.absoluteString
        let timeoutError = APIError.network(server: serverName, isTimeout: true, timeoutSeconds: Int(timeout.rounded()))

        do {
            return try await withThrowingTaskGroup(of: T.self) { group in
                group.addTask {
                    try await operation()
                }
                group.addTask {
                    try await Task.sleep(for: .seconds(timeout))
                    throw timeoutError
                }

                defer { group.cancelAll() }
                return try await group.next()!
            }
        } catch let error as URLError {
            switch error.code {
            case .cancelled:
                throw CancellationError()
            case .timedOut:
                throw timeoutError
            default:
                throw APIError.network(server: serverName, isTimeout: false, timeoutSeconds: Int(timeout.rounded()))
            }
        }
    }
}
