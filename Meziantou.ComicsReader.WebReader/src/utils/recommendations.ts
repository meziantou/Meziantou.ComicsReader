import type { BookResponse, ReadingListItemResponse } from '../types';

/**
 * Natural sort comparison function for strings (case-insensitive)
 * Handles numeric segments properly (e.g., "t01", "t02", "t10")
 */
function naturalSort(a: string, b: string): number {
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();

  // Split into segments of text and numbers
  const regex = /(\d+)|(\D+)/g;
  const aParts = aLower.match(regex) || [];
  const bParts = bLower.match(regex) || [];

  const maxLength = Math.max(aParts.length, bParts.length);

  for (let i = 0; i < maxLength; i++) {
    const aPart = aParts[i];
    const bPart = bParts[i];

    // If one string is shorter, it comes first
    if (aPart === undefined) return -1;
    if (bPart === undefined) return 1;

    const aIsNumber = /^\d+$/.test(aPart);
    const bIsNumber = /^\d+$/.test(bPart);

    // Both are numbers - compare numerically
    if (aIsNumber && bIsNumber) {
      const diff = parseInt(aPart, 10) - parseInt(bPart, 10);
      if (diff !== 0) return diff;
    }
    // One is a number, numbers come before text
    else if (aIsNumber) {
      return -1;
    } else if (bIsNumber) {
      return 1;
    }
    // Both are text - compare lexicographically
    else {
      const cmp = aPart.localeCompare(bPart);
      if (cmp !== 0) return cmp;
    }
  }

  return 0;
}

/**
 * Computes the next books to read based on completed books and their directories.
 * This is the client-side implementation of the server's GetNextBooksToRead logic.
 * 
 * The algorithm:
 * 1. For each completed book (ordered by most recently read):
 *    a. Find books in the same directory that aren't completed
 *    b. If none found, find books in child directories
 *    c. If none found, find books in the same first directory
 * 2. Exclude books that are already in progress
 * 3. Return distinct results sorted naturally by path
 * 
 * @param books - All books in the catalog
 * @param readingList - All reading list items
 * @returns Array of books recommended to read next
 */
export function computeNextBooksToRead(
  books: BookResponse[],
  readingList: ReadingListItemResponse[]
): BookResponse[] {
  const result: BookResponse[] = [];
  const resultPaths = new Set<string>();

  // Get completed books ordered by most recent
  const completedBooks = readingList
    .filter(item => item.completed)
    .sort((a, b) => new Date(b.lastRead).getTime() - new Date(a.lastRead).getTime());

  // Create a set of completed book paths for quick lookup
  const completedPaths = new Set(completedBooks.map(item => item.bookPath));

  // Create a set of in-progress book paths for quick lookup
  const inProgressPaths = new Set(
    readingList
      .filter(item => !item.completed)
      .map(item => item.bookPath)
  );

  const addBook = (book: BookResponse): void => {
    // Don't add books that are already in progress
    if (inProgressPaths.has(book.path)) {
      return;
    }

    // Don't add duplicates
    if (resultPaths.has(book.path)) {
      return;
    }

    result.push(book);
    resultPaths.add(book.path);
  };

  for (const completedBook of completedBooks) {
    const directory = completedBook.book?.directory;
    if (!directory) {
      continue;
    }

    // Find books in the same directory that aren't completed
    const booksInSameDirectory = books.filter(
      book => book.directory === directory && !completedPaths.has(book.path)
    );

    for (const book of booksInSameDirectory) {
      addBook(book);
    }

    // If no books found, try child directories
    if (result.length === 0) {
      const booksInChildDirectories = books.filter(
        book =>
          book.directory?.startsWith(directory + '/') &&
          !completedPaths.has(book.path)
      );

      for (const book of booksInChildDirectories) {
        addBook(book);
      }
    }

    // If still no books, try same first directory
    if (result.length === 0) {
      const firstDirectory = completedBook.book?.firstDirectory;
      if (firstDirectory) {
        const booksInSameFirstDirectory = books.filter(
          book =>
            book.firstDirectory === firstDirectory &&
            !completedPaths.has(book.path)
        );

        for (const book of booksInSameFirstDirectory) {
          addBook(book);
        }
      }
    }
  }

  // Remove duplicates and sort naturally by path
  const uniqueBooks = Array.from(new Map(result.map(book => [book.path, book])).values());
  return uniqueBooks.sort((a, b) => naturalSort(a.path, b.path));
}
