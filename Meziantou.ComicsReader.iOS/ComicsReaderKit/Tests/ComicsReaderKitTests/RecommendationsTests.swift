import Foundation
import Testing
@testable import ComicsReaderKit

struct RecommendationsTests {
    private func makeBook(_ path: String, directory: String? = nil) -> Book {
        let firstDirectory = path.contains("/") ? String(path.split(separator: "/")[0]) : nil
        return Book(path: path, title: path, pageCount: 10, fileSize: 1000, directory: directory, firstDirectory: firstDirectory)
    }

    private func makeItem(_ book: Book, completed: Bool, lastRead: String, includeBook: Bool = true) -> ReadingListItem {
        ReadingListItem(bookPath: book.path, pageIndex: 0, completed: completed, lastRead: JSONCoding.parseDate(lastRead)!, book: includeBook ? book : nil)
    }

    @Test func returnsEmptyWhenNoBooksAreCompleted() {
        let books = [makeBook("book1.cbz"), makeBook("book2.cbz")]

        #expect(Recommendations.nextBooksToRead(books: books, readingList: []).isEmpty)
    }

    @Test func returnsEmptyWhenCompletedBookIsNotInAFolder() {
        let books = [makeBook("book1.cbz"), makeBook("book2.cbz")]
        let readingList = [makeItem(books[0], completed: true, lastRead: "2025-01-01T00:00:00Z")]

        #expect(Recommendations.nextBooksToRead(books: books, readingList: readingList).isEmpty)
    }

    @Test func suggestsNextBookInTheSameFolder() {
        let books = [
            makeBook("foo/t01.cbz", directory: "foo"),
            makeBook("foo/t02.cbz", directory: "foo"),
            makeBook("bar/t01.cbz", directory: "bar"),
            makeBook("dummy.cbz"),
        ]
        let readingList = [makeItem(books[0], completed: true, lastRead: "2025-01-01T00:00:00Z")]

        #expect(Recommendations.nextBooksToRead(books: books, readingList: readingList).map(\.path) == ["foo/t02.cbz"])
    }

    @Test func usesCatalogBookWhenReadingListItemHasNoBook() {
        let books = [
            makeBook("foo/t01.cbz", directory: "foo"),
            makeBook("foo/t02.cbz", directory: "foo"),
        ]
        let readingList = [makeItem(books[0], completed: true, lastRead: "2025-01-01T00:00:00Z", includeBook: false)]

        #expect(Recommendations.nextBooksToRead(books: books, readingList: readingList).map(\.path) == ["foo/t02.cbz"])
    }

    @Test func excludesBooksAlreadyInProgress() {
        let books = [
            makeBook("foo/t01.cbz", directory: "foo"),
            makeBook("foo/t02.cbz", directory: "foo"),
            makeBook("foo/t03.cbz", directory: "foo"),
        ]
        let readingList = [
            makeItem(books[0], completed: true, lastRead: "2025-01-01T00:00:00Z"),
            makeItem(books[1], completed: false, lastRead: "2025-01-02T00:00:00Z"),
        ]

        #expect(Recommendations.nextBooksToRead(books: books, readingList: readingList).map(\.path) == ["foo/t03.cbz"])
    }

    @Test func triesChildDirectoriesWhenNoBooksInSameDirectory() {
        let books = [
            makeBook("foo/t01.cbz", directory: "foo"),
            makeBook("foo/bar/t01.cbz", directory: "foo/bar"),
            makeBook("foo/bar/t02.cbz", directory: "foo/bar"),
        ]
        let readingList = [makeItem(books[0], completed: true, lastRead: "2025-01-01T00:00:00Z")]

        #expect(Recommendations.nextBooksToRead(books: books, readingList: readingList).map(\.path) == ["foo/bar/t01.cbz", "foo/bar/t02.cbz"])
    }

    @Test func triesSameFirstDirectoryWhenNoBooksInSameOrChildDirectories() {
        let books = [
            makeBook("foo/bar/t01.cbz", directory: "foo/bar"),
            makeBook("foo/baz/t01.cbz", directory: "foo/baz"),
            makeBook("bar/t01.cbz", directory: "bar"),
        ]
        let readingList = [makeItem(books[0], completed: true, lastRead: "2025-01-01T00:00:00Z")]

        #expect(Recommendations.nextBooksToRead(books: books, readingList: readingList).map(\.path) == ["foo/baz/t01.cbz"])
    }

    @Test func sortsResultsNaturallyByPath() {
        let books = [
            makeBook("foo/t10.cbz", directory: "foo"),
            makeBook("foo/t02.cbz", directory: "foo"),
            makeBook("foo/t01.cbz", directory: "foo"),
            makeBook("foo/t20.cbz", directory: "foo"),
        ]
        let readingList = [makeItem(books[2], completed: true, lastRead: "2025-01-01T00:00:00Z")]

        #expect(Recommendations.nextBooksToRead(books: books, readingList: readingList).map(\.path) == ["foo/t02.cbz", "foo/t10.cbz", "foo/t20.cbz"])
    }

    @Test func processesAllCompletedBooks() {
        let books = [
            makeBook("series1/t01.cbz", directory: "series1"),
            makeBook("series1/t02.cbz", directory: "series1"),
            makeBook("series2/t01.cbz", directory: "series2"),
            makeBook("series2/t02.cbz", directory: "series2"),
        ]
        let readingList = [
            makeItem(books[0], completed: true, lastRead: "2025-01-01T00:00:00Z"),
            makeItem(books[2], completed: true, lastRead: "2025-01-02T00:00:00Z"),
        ]

        #expect(Recommendations.nextBooksToRead(books: books, readingList: readingList).map(\.path) == ["series1/t02.cbz", "series2/t02.cbz"])
    }

    @Test func doesNotSuggestCompletedBooks() {
        let books = [
            makeBook("foo/t01.cbz", directory: "foo"),
            makeBook("foo/t02.cbz", directory: "foo"),
            makeBook("foo/t03.cbz", directory: "foo"),
        ]
        let readingList = [
            makeItem(books[0], completed: true, lastRead: "2025-01-01T00:00:00Z"),
            makeItem(books[1], completed: true, lastRead: "2025-01-02T00:00:00Z"),
        ]

        #expect(Recommendations.nextBooksToRead(books: books, readingList: readingList).map(\.path) == ["foo/t03.cbz"])
    }

    @Test(arguments: [
        ("t01", "t02", ComparisonResult.orderedAscending),
        ("t2", "t10", .orderedAscending),
        ("T10", "t2", .orderedDescending),
        ("abc", "ABC", .orderedSame),
        ("1abc", "abc", .orderedAscending),
        ("foo", "foo/bar", .orderedAscending),
    ])
    func naturalCompare(a: String, b: String, expected: ComparisonResult) {
        #expect(Recommendations.naturalCompare(a, b) == expected)
    }
}
