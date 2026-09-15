import Foundation
import Testing
@testable import ComicsReaderKit

struct StringUtilitiesTests {
    @Test(arguments: [
        ("HELLO", "hello"),
        ("Hello World", "hello world"),
        ("café", "cafe"),
        ("résumé", "resume"),
        ("Ñoño", "nono"),
        ("Über", "uber"),
        ("CAFÉ", "cafe"),
        ("Éléphant", "elephant"),
    ])
    func normalize(value: String, expected: String) {
        #expect(StringUtilities.normalize(value) == expected)
    }

    @Test(arguments: [
        ("Hello World", "hello", true),
        ("Hello World", "WORLD", true),
        ("Hello World", "xyz", false),
        ("café", "cafe", true),
        ("cafe", "café", true),
        ("RÉSUMÉ", "resume", true),
        ("The quick brown fox", "quick", true),
        ("Comics/Vol1", "vol", true),
    ])
    func containsInsensitive(text: String, search: String, expected: Bool) {
        #expect(StringUtilities.containsInsensitive(text, search) == expected)
    }

    @Test(arguments: [
        (Int64(0), "0 B"),
        (500, "500 B"),
        (1024, "1 KB"),
        (1536, "1.5 KB"),
        (1_048_576, "1 MB"),
        (5_242_880, "5 MB"),
        (1_073_741_824, "1 GB"),
    ])
    func formatFileSize(bytes: Int64, expected: String) {
        #expect(StringUtilities.formatFileSize(bytes) == expected)
    }
}
