import Foundation

public enum Recommendations {
    /// Natural sort comparison (case-insensitive) handling numeric segments (e.g. "t01", "t02", "t10")
    public static func naturalCompare(_ a: String, _ b: String) -> ComparisonResult {
        let aParts = segments(a.lowercased())
        let bParts = segments(b.lowercased())

        for index in 0..<max(aParts.count, bParts.count) {
            // If one string is shorter, it comes first
            guard index < aParts.count else { return .orderedAscending }
            guard index < bParts.count else { return .orderedDescending }

            switch (aParts[index], bParts[index]) {
            case (.number(let aValue), .number(let bValue)):
                if aValue != bValue {
                    return aValue < bValue ? .orderedAscending : .orderedDescending
                }
            case (.number, .text):
                return .orderedAscending
            case (.text, .number):
                return .orderedDescending
            case (.text(let aText), .text(let bText)):
                let result = aText.compare(bText)
                if result != .orderedSame {
                    return result
                }
            }
        }

        return .orderedSame
    }

    /// Computes the next books to read based on completed books and their directories.
    ///
    /// For each completed book (most recently read first):
    /// 1. Find books in the same directory that aren't completed
    /// 2. If none found, find books in child directories
    /// 3. If none found, find books in the same first directory
    ///
    /// Books already in progress are excluded, and the result is sorted naturally by path.
    public static func nextBooksToRead(books: [Book], readingList: [ReadingListItem]) -> [Book] {
        var result: [Book] = []
        var resultPaths = Set<String>()

        let completedItems = readingList
            .filter(\.completed)
            .sorted { $0.lastRead > $1.lastRead }
        let completedPaths = Set(completedItems.map(\.bookPath))
        let inProgressPaths = Set(readingList.filter { !$0.completed }.map(\.bookPath))
        let booksByPath = Dictionary(books.map { ($0.path, $0) }, uniquingKeysWith: { first, _ in first })

        func add(_ candidates: [Book]) {
            for book in candidates where !inProgressPaths.contains(book.path) && !resultPaths.contains(book.path) {
                result.append(book)
                resultPaths.insert(book.path)
            }
        }

        for item in completedItems {
            let completedBook = item.book ?? booksByPath[item.bookPath]
            guard let directory = completedBook?.directory else {
                continue
            }

            add(books.filter { $0.directory == directory && !completedPaths.contains($0.path) })

            if result.isEmpty {
                add(books.filter { $0.directory?.hasPrefix(directory + "/") == true && !completedPaths.contains($0.path) })
            }

            if result.isEmpty, let firstDirectory = completedBook?.firstDirectory {
                add(books.filter { $0.firstDirectory == firstDirectory && !completedPaths.contains($0.path) })
            }
        }

        return result.sorted { naturalCompare($0.path, $1.path) == .orderedAscending }
    }

    private enum Segment {
        case number(Decimal)
        case text(String)
    }

    private static func segments(_ value: String) -> [Segment] {
        var result: [Segment] = []
        var current = ""
        var currentIsNumber = false

        func flush() {
            guard !current.isEmpty else {
                return
            }

            result.append(currentIsNumber ? .number(Decimal(string: current) ?? 0) : .text(current))
            current = ""
        }

        for character in value {
            let isNumber = character.isASCII && character.isNumber
            if !current.isEmpty && isNumber != currentIsNumber {
                flush()
            }

            currentIsNumber = isNumber
            current.append(character)
        }

        flush()
        return result
    }
}
