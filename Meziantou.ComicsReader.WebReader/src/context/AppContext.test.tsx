import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { AppProvider, useApp } from './AppContext';
import type { ApiClient } from '../services/apiClient';
import type { AppSettings, BookResponse, ReadingListItemResponse } from '../types';

const settings: AppSettings = {
  serverUrl: 'https://example.com',
  token: 'token',
  autoDownloadNewBooks: false,
  largeFullscreenProgressBar: false,
  useNativeFullscreen: false,
};

const mocks = vi.hoisted(() => ({
  client: {
    getBooks: vi.fn(),
    getReadingList: vi.fn(),
    removeFromReadingList: vi.fn(),
  },
  performCleanup: vi.fn(),
}));

vi.mock('../services/apiClient', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/apiClient')>()),
  getApiClient: () => mocks.client as unknown as ApiClient,
}));

vi.mock('../services/storage', () => ({
  getSettings: () => Promise.resolve(settings),
  saveSettings: () => Promise.resolve(),
  getCachedBooks: () => Promise.resolve([]),
  getLocalReadingList: () => Promise.resolve(new Map()),
}));

vi.mock('../services/offlineService', () => ({
  syncPendingUpdates: () => Promise.resolve(),
  performCleanup: mocks.performCleanup,
  isOnline: () => true,
  getAllCachedBooksInfo: () => Promise.resolve(new Map()),
  preloadCoverCache: () => Promise.resolve(),
  autoDownloadAllBooks: () => Promise.resolve(),
  cancelAutoDownload: () => {},
}));

function createBook(path: string, directory: string): BookResponse {
  return {
    path,
    title: path,
    pageCount: 10,
    fileSize: 1000,
    coverImageFileName: null,
    directory,
    firstDirectory: directory,
    currentPage: null,
    isCompleted: false,
    lastRead: null,
  };
}

function createReadingListItem(book: BookResponse, completed: boolean, lastRead: string): ReadingListItemResponse {
  return {
    bookPath: book.path,
    pageIndex: completed ? book.pageCount - 1 : 3,
    completed,
    lastRead,
    book,
  };
}

const t01 = createBook('foo/t01.cbz', 'foo');
const t02 = createBook('foo/t02.cbz', 'foo');
const t03 = createBook('foo/t03.cbz', 'foo');
const bar = createBook('bar/t01.cbz', 'bar');

function Consumer() {
  const { readingList, nextToRead, removeFromReadingList } = useApp();

  return (
    <div>
      <div data-testid="reading-list">{readingList.map(item => `${item.bookPath}:${item.completed}`).join(',')}</div>
      <div data-testid="next-to-read">{nextToRead.map(book => book.path).join(',')}</div>
      <button onClick={() => removeFromReadingList(bar.path)}>remove</button>
    </div>
  );
}

describe('AppProvider', () => {
  beforeEach(() => {
    mocks.client.getBooks.mockResolvedValue({ books: [t01, t02, t03, bar] });
    mocks.client.getReadingList.mockImplementation((includeCompleted: boolean = false) => {
      const items = [
        createReadingListItem(bar, false, '2025-01-02T00:00:00Z'),
        createReadingListItem(t01, true, '2025-01-01T00:00:00Z'),
      ].filter(item => includeCompleted || !item.completed);
      return Promise.resolve({ totalCount: items.length, items });
    });
    mocks.performCleanup.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it('should fetch the reading list including completed items', async () => {
    render(<AppProvider><Consumer /></AppProvider>);

    await waitFor(() => expect(screen.getByTestId('reading-list').textContent).toBe('bar/t01.cbz:false,foo/t01.cbz:true'));
    expect(mocks.client.getReadingList).toHaveBeenCalledWith(true);
  });

  it('should compute next books to read from completed items', async () => {
    render(<AppProvider><Consumer /></AppProvider>);

    await waitFor(() => expect(screen.getByTestId('next-to-read').textContent).toBe('foo/t02.cbz,foo/t03.cbz'));
  });

  it('should pass completed items to the offline cache cleanup', async () => {
    render(<AppProvider><Consumer /></AppProvider>);

    await waitFor(() => expect(mocks.performCleanup).toHaveBeenCalled());
    const [, readingList] = mocks.performCleanup.mock.calls[0] as [BookResponse[], ReadingListItemResponse[]];
    expect(readingList.filter(item => item.completed).map(item => item.bookPath)).toEqual([t01.path]);
  });

  it('should keep completed items when removing a book from the reading list', async () => {
    mocks.client.removeFromReadingList.mockResolvedValue({ totalCount: 0, items: [] });
    render(<AppProvider><Consumer /></AppProvider>);
    await waitFor(() => expect(screen.getByTestId('reading-list').textContent).toBe('bar/t01.cbz:false,foo/t01.cbz:true'));

    await act(async () => {
      screen.getByText('remove').click();
    });

    expect(mocks.client.removeFromReadingList).toHaveBeenCalledWith(bar.path);
    expect(screen.getByTestId('reading-list').textContent).toBe('foo/t01.cbz:true');
    expect(screen.getByTestId('next-to-read').textContent).toBe('foo/t02.cbz,foo/t03.cbz');
  });
});
