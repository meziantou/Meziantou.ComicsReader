import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient, ApiError, ApiNetworkError, DEFAULT_REQUEST_TIMEOUT_MS } from '../services/apiClient';

describe('ApiClient', () => {
  let client: ApiClient;
  const baseUrl = 'https://test-server.example.com';
  const token = 'test-token';

  beforeEach(() => {
    client = new ApiClient(baseUrl, token);
    vi.resetAllMocks();
  });

  describe('getBooks', () => {
    it('should fetch books from the API', async () => {
      const mockResponse = {
        totalCount: 2,
        books: [
          { path: 'book1', title: 'Book 1', pageCount: 10, fileSize: 1000, coverImageFileName: 'cover1.jpg', directory: null, firstDirectory: null, currentPage: null, isCompleted: false, lastRead: null },
          { path: 'book2', title: 'Book 2', pageCount: 20, fileSize: 2000, coverImageFileName: 'cover2.jpg', directory: 'series', firstDirectory: 'series', currentPage: 5, isCompleted: false, lastRead: '2025-01-01' },
        ],
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      }) as unknown as typeof fetch;

      const result = await client.getBooks();

      expect(fetch).toHaveBeenCalledWith(
        `${baseUrl}/api/v1/books`,
        expect.objectContaining({
          headers: expect.any(Headers),
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it('should include search and filter params', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ totalCount: 0, books: [] })),
      }) as unknown as typeof fetch;

      await client.getBooks('test search', 'series');

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('search=test+search'),
        expect.anything()
      );
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('filter=series'),
        expect.anything()
      );
    });

    it('should throw ApiError on failed request', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      }) as unknown as typeof fetch;

      await expect(client.getBooks()).rejects.toThrow(ApiError);
    });

    it('should report authentication failures with an actionable message', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: '',
      }) as unknown as typeof fetch;

      await expect(client.getBooks()).rejects.toThrow('Authentication failed (401). Check the access token in Settings.');
    });

    it('should throw ApiNetworkError when the server is unreachable', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Load failed')) as unknown as typeof fetch;

      const error = await client.getBooks().catch((err: unknown) => err);

      expect(error).toBeInstanceOf(ApiNetworkError);
      expect((error as ApiNetworkError).isTimeout).toBe(false);
      expect((error as ApiNetworkError).message).toBe(`Unable to reach the server ${baseUrl}.`);
    });
  });

  describe('timeout', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    function mockHangingFetch() {
      globalThis.fetch = vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
      })) as unknown as typeof fetch;
    }

    it('should abort JSON requests that exceed the timeout', async () => {
      vi.useFakeTimers();
      mockHangingFetch();
      const clientWithTimeout = new ApiClient(baseUrl, token, { requestTimeoutMs: 5000 });

      const promise = clientWithTimeout.getBooks().catch((err: unknown) => err);
      await vi.advanceTimersByTimeAsync(5000);
      const error = await promise;

      expect(error).toBeInstanceOf(ApiNetworkError);
      expect((error as ApiNetworkError).isTimeout).toBe(true);
      expect((error as ApiNetworkError).message).toBe(`The server ${baseUrl} did not respond within 5 seconds.`);
    });

    it('should abort image requests that exceed the image timeout', async () => {
      vi.useFakeTimers();
      mockHangingFetch();
      const clientWithTimeout = new ApiClient(baseUrl, token, { requestTimeoutMs: 1000, imageRequestTimeoutMs: 3000 });

      let settled = false;
      const promise = clientWithTimeout.getPage('test/book', 1).catch((err: unknown) => err).finally(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(1000);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(2000);
      const error = await promise;

      expect(error).toBeInstanceOf(ApiNetworkError);
      expect((error as ApiNetworkError).isTimeout).toBe(true);
    });

    it('should abort when reading the response body exceeds the timeout', async () => {
      vi.useFakeTimers();
      globalThis.fetch = vi.fn((_url: string, init: RequestInit) => Promise.resolve({
        ok: true,
        text: () => new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
        }),
      })) as unknown as typeof fetch;
      const clientWithTimeout = new ApiClient(baseUrl, token, { requestTimeoutMs: 2000 });

      const promise = clientWithTimeout.getReadingList().catch((err: unknown) => err);
      await vi.advanceTimersByTimeAsync(2000);

      expect(await promise).toBeInstanceOf(ApiNetworkError);
    });

    it('should use the default timeout', async () => {
      vi.useFakeTimers();
      mockHangingFetch();

      const promise = client.getBooks().catch((err: unknown) => err);
      await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS);

      expect(await promise).toBeInstanceOf(ApiNetworkError);
    });
  });

  describe('getBookInfo', () => {
    it('should fetch book info', async () => {
      const mockBook = {
        path: 'test/book',
        title: 'Test Book',
        pageCount: 15,
        fileSize: 1500,
        coverImageFileName: 'cover.jpg',
        directory: 'test',
        firstDirectory: 'test',
        currentPage: null,
        isCompleted: false,
        lastRead: null,
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockBook)),
      }) as unknown as typeof fetch;

      const result = await client.getBookInfo('test/book');

      expect(fetch).toHaveBeenCalledWith(
        `${baseUrl}/api/v1/books/${encodeURIComponent('test/book')}/info`,
        expect.anything()
      );
      expect(result).toEqual(mockBook);
    });
  });

  describe('getCoverUrl', () => {
    it('should return cover URL with token', () => {
      const url = client.getCoverUrl('test/book');

      expect(url).toBe(`${baseUrl}/api/v1/books/${encodeURIComponent('test/book')}/cover?token=${encodeURIComponent(token)}`);
    });

    it('should return cover URL without token when not set', () => {
      const clientWithoutToken = new ApiClient(baseUrl, null);
      const url = clientWithoutToken.getCoverUrl('test/book');

      expect(url).toBe(`${baseUrl}/api/v1/books/${encodeURIComponent('test/book')}/cover`);
    });
  });

  describe('getPageUrl', () => {
    it('should return page URL with token', () => {
      const url = client.getPageUrl('test/book', 5);

      expect(url).toBe(`${baseUrl}/api/v1/books/${encodeURIComponent('test/book')}/pages/5?token=${encodeURIComponent(token)}`);
    });
  });

  describe('updateReadingProgress', () => {
    it('should send PUT request and return reading list', async () => {
      const mockResponse = {
        totalCount: 1,
        items: [{ bookPath: 'test/book', pageIndex: 10, completed: false, lastRead: '2024-01-01', book: null }],
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      }) as unknown as typeof fetch;

      const result = await client.updateReadingProgress('test/book', 10);

      expect(fetch).toHaveBeenCalledWith(
        `${baseUrl}/api/v1/reading-list/${encodeURIComponent('test/book')}`,
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ pageIndex: 10 }),
        })
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getReadingList', () => {
    it('should fetch reading list', async () => {
      const mockResponse = {
        totalCount: 1,
        items: [
          { bookPath: 'book1', pageIndex: 5, completed: false, lastRead: '2025-01-01', book: null },
        ],
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      }) as unknown as typeof fetch;

      const result = await client.getReadingList();

      expect(fetch).toHaveBeenCalledWith(
        `${baseUrl}/api/v1/reading-list?includeCompleted=false`,
        expect.anything()
      );
      expect(result).toEqual(mockResponse);
    });

    it('should include completed books when requested', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ totalCount: 0, items: [] })),
      }) as unknown as typeof fetch;

      await client.getReadingList(true);

      expect(fetch).toHaveBeenCalledWith(
        `${baseUrl}/api/v1/reading-list?includeCompleted=true`,
        expect.anything()
      );
    });
  });

  describe('triggerReindex', () => {
    it('should send POST request to trigger reindex', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(''),
      }) as unknown as typeof fetch;

      await client.triggerReindex();

      expect(fetch).toHaveBeenCalledWith(
        `${baseUrl}/api/v1/indexing/reindex`,
        expect.objectContaining({
          method: 'POST',
        })
      );
    });
  });

  describe('baseUrl normalization', () => {
    it('should handle baseUrl with trailing slash', async () => {
      const clientWithSlash = new ApiClient('https://test.com/', token);

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ totalCount: 0, books: [] })),
      }) as unknown as typeof fetch;

      await clientWithSlash.getBooks();

      expect(fetch).toHaveBeenCalledWith(
        'https://test.com/api/v1/books',
        expect.anything()
      );
    });

    it('should handle baseUrl as "/" correctly', async () => {
      const clientWithRootPath = new ApiClient('/', token);

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ totalCount: 0, books: [] })),
      }) as unknown as typeof fetch;

      await clientWithRootPath.getBooks();

      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/books',
        expect.anything()
      );
    });

    it('should handle baseUrl with multiple trailing slashes', async () => {
      const clientWithMultipleSlashes = new ApiClient('https://test.com///', token);

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ totalCount: 0, books: [] })),
      }) as unknown as typeof fetch;

      await clientWithMultipleSlashes.getBooks();

      expect(fetch).toHaveBeenCalledWith(
        'https://test.com/api/v1/books',
        expect.anything()
      );
    });

    it('should construct correct page URLs when baseUrl is "/"', () => {
      const clientWithRootPath = new ApiClient('/', token);
      const pageUrl = clientWithRootPath.getPageUrl('test/book', 5);

      expect(pageUrl).toBe(`/api/v1/books/${encodeURIComponent('test/book')}/pages/5?token=${encodeURIComponent(token)}`);
    });

    it('should construct correct cover URLs when baseUrl is "/"', () => {
      const clientWithRootPath = new ApiClient('/', token);
      const coverUrl = clientWithRootPath.getCoverUrl('test/book');

      expect(coverUrl).toBe(`/api/v1/books/${encodeURIComponent('test/book')}/cover?token=${encodeURIComponent(token)}`);
    });
  });
});
