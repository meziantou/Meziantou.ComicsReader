import Foundation
import Testing
@testable import ComicsReaderKit

/// Intercepts the requests of a URLSession and answers with the registered handler
final class StubURLProtocol: URLProtocol, @unchecked Sendable {
    typealias Handler = @Sendable (URLRequest) async throws -> (Int, Data)

    private static let lock = NSLock()
    nonisolated(unsafe) private static var handlers: [String: Handler] = [:]
    nonisolated(unsafe) private static var requests: [String: [URLRequest]] = [:]

    private var loadingTask: Task<Void, Never>?

    /// Creates a session whose requests to the given host are answered by the handler
    static func makeSession(host: String, handler: @escaping Handler) -> URLSession {
        lock.withLock {
            handlers[host] = handler
            requests[host] = []
        }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        return URLSession(configuration: configuration)
    }

    static func recordedRequests(host: String) -> [URLRequest] {
        lock.withLock { requests[host] ?? [] }
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let request = self.request
        let host = request.url?.host() ?? ""
        let handler = Self.lock.withLock {
            Self.requests[host, default: []].append(request)
            return Self.handlers[host]
        }

        loadingTask = Task { @Sendable [protocolInstance = self] in
            do {
                guard let handler else {
                    throw URLError(.cannotConnectToHost)
                }

                let (status, data) = try await handler(request)
                let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil)!
                protocolInstance.client?.urlProtocol(protocolInstance, didReceive: response, cacheStoragePolicy: .notAllowed)
                protocolInstance.client?.urlProtocol(protocolInstance, didLoad: data)
                protocolInstance.client?.urlProtocolDidFinishLoading(protocolInstance)
            } catch {
                protocolInstance.client?.urlProtocol(protocolInstance, didFailWithError: error)
            }
        }
    }

    override func stopLoading() {
        loadingTask?.cancel()
    }
}

struct APIClientTests {
    private func makeClient(token: String? = nil, requestTimeout: TimeInterval = 15, handler: @escaping StubURLProtocol.Handler) throws -> (APIClient, String) {
        let host = "\(UUID().uuidString.lowercased()).example.com"
        let session = StubURLProtocol.makeSession(host: host, handler: handler)
        let client = try APIClient(serverURL: "https://\(host)/", token: token, session: session, requestTimeout: requestTimeout)
        return (client, host)
    }

    @Test(arguments: [
        ("https://example.com", "https://example.com"),
        ("https://example.com///", "https://example.com"),
        ("  http://192.168.1.2:8080/  ", "http://192.168.1.2:8080"),
        ("https://example.com/comics/", "https://example.com/comics"),
    ])
    func normalizesServerURL(value: String, expected: String) {
        #expect(APIClient.normalizeServerURL(value)?.absoluteString == expected)
    }

    @Test(arguments: ["", "/", "example.com", "ftp://example.com"])
    func rejectsInvalidServerURL(value: String) {
        #expect(throws: APIError.invalidServerURL(value)) {
            try APIClient(serverURL: value, token: nil)
        }
    }

    @Test func encodesPathComponentLikeEncodeURIComponent() {
        #expect(APIClient.encodePathComponent("foo/bar baz/t01 (1).cbz") == "foo%2Fbar%20baz%2Ft01%20(1).cbz")
        #expect(APIClient.encodePathComponent("é&?#") == "%C3%A9%26%3F%23")
    }

    @Test func getBooksDecodesResponseAndSendsToken() async throws {
        let json = """
            {"totalCount":1,"books":[{"path":"foo/t01.cbz","title":"t01","pageCount":42,"fileSize":1234,"coverImageFileName":"abc.jpg","directory":"foo","firstDirectory":"foo","currentPage":3,"isCompleted":false,"lastRead":"2025-01-02T10:11:12.1234567+00:00"}]}
            """
        let (client, host) = try makeClient(token: "secret") { _ in (200, Data(json.utf8)) }

        let response = try await client.getBooks()

        #expect(response.books.count == 1)
        #expect(response.books[0].path == "foo/t01.cbz")
        #expect(response.books[0].currentPage == 3)
        let lastRead = try #require(response.books[0].lastRead)
        #expect(abs(lastRead.timeIntervalSince(JSONCoding.parseDate("2025-01-02T10:11:12Z")!) - 0.1234567) < 0.001)

        let request = try #require(StubURLProtocol.recordedRequests(host: host).first)
        #expect(request.url?.absoluteString == "https://\(host)/api/v1/books")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer secret")
    }

    @Test func updateReadingProgressSendsEncodedPathAndBody() async throws {
        let (client, host) = try makeClient { _ in (200, Data(#"{"totalCount":0,"items":[]}"#.utf8)) }

        _ = try await client.updateReadingProgress(path: "foo/t 01.cbz", pageIndex: 5)

        let request = try #require(StubURLProtocol.recordedRequests(host: host).first)
        #expect(request.httpMethod == "PUT")
        #expect(request.url?.absoluteString == "https://\(host)/api/v1/reading-list/foo%2Ft%2001.cbz")
        #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
    }

    @Test func getReadingListItemReturnsNilWhenNotFound() async throws {
        let (client, _) = try makeClient { _ in (404, Data()) }

        #expect(try await client.getReadingListItem(path: "foo.cbz") == nil)
    }

    @Test func reportsAuthenticationFailures() async throws {
        let (client, _) = try makeClient { _ in (401, Data()) }

        let error = await #expect(throws: APIError.http(status: 401)) {
            try await client.getVersion()
        }
        #expect(error?.localizedDescription.contains("Check the access token in Settings") == true)
    }

    @Test func reportsUnreachableServer() async throws {
        let (client, _) = try makeClient { _ in throw URLError(.cannotConnectToHost) }

        let error = await #expect(throws: APIError.self) {
            try await client.getVersion()
        }
        #expect(error?.isNetworkError == true)
        #expect(error?.localizedDescription.contains("Unable to reach the server") == true)
    }

    @Test func reportsTimeout() async throws {
        let (client, _) = try makeClient(requestTimeout: 0.2) { _ in
            try await Task.sleep(for: .seconds(10))
            return (200, Data())
        }

        let error = await #expect(throws: APIError.self) {
            try await client.getVersion()
        }
        #expect(error?.isNetworkError == true)
        #expect(error?.localizedDescription.contains("did not respond within") == true)
    }
}
