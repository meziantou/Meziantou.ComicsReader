import { describe, it, expect } from 'vitest';
import { computeNextBooksToRead } from './recommendations';
import type { BookResponse, ReadingListItemResponse } from '../types';

describe('computeNextBooksToRead', () => {
  function createBook(path: string, directory: string | null = null): BookResponse {
    const firstDirectory = path.includes('/') ? path.split('/')[0] : null;
    
    return {
      path,
      title: path,
      pageCount: 10,
      fileSize: 1000,
      coverImageFileName: null,
      directory,
      firstDirectory,
      currentPage: null,
      isCompleted: false,
      lastRead: null,
    };
  }

  function createReadingListItem(
    bookPath: string,
    completed: boolean,
    lastRead: string
  ): ReadingListItemResponse {
    return {
      bookPath,
      pageIndex: 0,
      completed,
      lastRead,
      book: null,
    };
  }

  it('should return empty array when no books are completed', () => {
    const books = [createBook('book1.cbz'), createBook('book2.cbz')];
    const readingList: ReadingListItemResponse[] = [];

    const result = computeNextBooksToRead(books, readingList);

    expect(result).toEqual([]);
  });

  it('should return empty array when completed book is not in a folder', () => {
    const books = [createBook('book1.cbz'), createBook('book2.cbz')];
    const readingList = [
      createReadingListItem('book1.cbz', true, '2025-01-01T00:00:00Z'),
    ];

    const result = computeNextBooksToRead(books, readingList);

    expect(result).toEqual([]);
  });

  it('should suggest next book in the same folder', () => {
    const books = [
      createBook('foo/t01.cbz', 'foo'),
      createBook('foo/t02.cbz', 'foo'),
      createBook('bar/t01.cbz', 'bar'),
      createBook('dummy.cbz'),
    ];
    const readingList = [
      {
        ...createReadingListItem('foo/t01.cbz', true, '2025-01-01T00:00:00Z'),
        book: books[0],
      },
    ];

    const result = computeNextBooksToRead(books, readingList);

    expect(result.map(b => b.path)).toEqual(['foo/t02.cbz']);
  });

  it('should exclude books already in progress', () => {
    const books = [
      createBook('foo/t01.cbz', 'foo'),
      createBook('foo/t02.cbz', 'foo'),
      createBook('foo/t03.cbz', 'foo'),
    ];
    const readingList = [
      {
        ...createReadingListItem('foo/t01.cbz', true, '2025-01-01T00:00:00Z'),
        book: books[0],
      },
      {
        ...createReadingListItem('foo/t02.cbz', false, '2025-01-02T00:00:00Z'),
        book: books[1],
      },
    ];

    const result = computeNextBooksToRead(books, readingList);

    expect(result.map(b => b.path)).toEqual(['foo/t03.cbz']);
  });

  it('should try child directories if no books in same directory', () => {
    const books = [
      createBook('foo/t01.cbz', 'foo'),
      createBook('foo/bar/t01.cbz', 'foo/bar'),
      createBook('foo/bar/t02.cbz', 'foo/bar'),
    ];
    const readingList = [
      {
        ...createReadingListItem('foo/t01.cbz', true, '2025-01-01T00:00:00Z'),
        book: books[0],
      },
    ];

    const result = computeNextBooksToRead(books, readingList);

    expect(result.map(b => b.path)).toEqual(['foo/bar/t01.cbz', 'foo/bar/t02.cbz']);
  });

  it('should try same first directory if no books in same or child directories', () => {
    const books = [
      createBook('foo/bar/t01.cbz', 'foo/bar'),
      createBook('foo/baz/t01.cbz', 'foo/baz'),
      createBook('bar/t01.cbz', 'bar'),
    ];
    const readingList = [
      {
        ...createReadingListItem('foo/bar/t01.cbz', true, '2025-01-01T00:00:00Z'),
        book: books[0],
      },
    ];

    const result = computeNextBooksToRead(books, readingList);

    expect(result.map(b => b.path)).toEqual(['foo/baz/t01.cbz']);
  });

  it('should sort results naturally by path', () => {
    const books = [
      createBook('foo/t10.cbz', 'foo'),
      createBook('foo/t02.cbz', 'foo'),
      createBook('foo/t01.cbz', 'foo'),
      createBook('foo/t20.cbz', 'foo'),
    ];
    const readingList = [
      {
        ...createReadingListItem('foo/t01.cbz', true, '2025-01-01T00:00:00Z'),
        book: books[2],
      },
    ];

    const result = computeNextBooksToRead(books, readingList);

    // Natural sort should order: t02, t10, t20
    expect(result.map(b => b.path)).toEqual(['foo/t02.cbz', 'foo/t10.cbz', 'foo/t20.cbz']);
  });

  it('should process completed books in order of most recent first', () => {
    const books = [
      createBook('series1/t01.cbz', 'series1'),
      createBook('series1/t02.cbz', 'series1'),
      createBook('series2/t01.cbz', 'series2'),
      createBook('series2/t02.cbz', 'series2'),
    ];
    const readingList = [
      {
        ...createReadingListItem('series1/t01.cbz', true, '2025-01-01T00:00:00Z'),
        book: books[0],
      },
      {
        ...createReadingListItem('series2/t01.cbz', true, '2025-01-02T00:00:00Z'),
        book: books[2],
      },
    ];

    const result = computeNextBooksToRead(books, readingList);

    // Results should be sorted naturally by path, regardless of completion order
    expect(result.map(b => b.path)).toEqual(['series1/t02.cbz', 'series2/t02.cbz']);
  });

  it('should not suggest completed books', () => {
    const books = [
      createBook('foo/t01.cbz', 'foo'),
      createBook('foo/t02.cbz', 'foo'),
      createBook('foo/t03.cbz', 'foo'),
    ];
    const readingList = [
      {
        ...createReadingListItem('foo/t01.cbz', true, '2025-01-01T00:00:00Z'),
        book: books[0],
      },
      {
        ...createReadingListItem('foo/t02.cbz', true, '2025-01-02T00:00:00Z'),
        book: books[1],
      },
    ];

    const result = computeNextBooksToRead(books, readingList);

    expect(result.map(b => b.path)).toEqual(['foo/t03.cbz']);
  });
});
