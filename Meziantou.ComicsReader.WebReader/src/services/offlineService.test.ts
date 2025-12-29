import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isOnline,
  isOnMeteredConnection,
  getCoverWithCache,
  getPageWithCache,
  updateReadingProgress,
  syncPendingUpdates,
  preloadCoverCache,
} from '../services/offlineService';
import { ApiClient } from '../services/apiClient';
import * as storage from '../services/storage';

vi.mock('../services/storage');

describe('Offline Service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('isOnline', () => {
    it('should return true when navigator.onLine is true', () => {
      Object.defineProperty(navigator, 'onLine', { value: true, writable: true });
      expect(isOnline()).toBe(true);
    });

    it('should return false when navigator.onLine is false', () => {
      Object.defineProperty(navigator, 'onLine', { value: false, writable: true });
      expect(isOnline()).toBe(false);
    });
  });

  describe('isOnMeteredConnection', () => {
    it('should return false when no connection info', () => {
      Object.defineProperty(navigator, 'connection', { value: undefined, writable: true });
      expect(isOnMeteredConnection()).toBe(false);
    });

    it('should return true when saveData is enabled', () => {
      Object.defineProperty(navigator, 'connection', {
        value: { saveData: true },
        writable: true,
      });
      expect(isOnMeteredConnection()).toBe(true);
    });

    it('should return false when saveData is disabled', () => {
      Object.defineProperty(navigator, 'connection', {
        value: { saveData: false },
        writable: true,
      });
      expect(isOnMeteredConnection()).toBe(false);
    });
  });

  describe('Offline Cover Loading', () => {
    let mockApiClient: ApiClient;

    beforeEach(() => {
      mockApiClient = {
        getCover: vi.fn(),
      } as unknown as ApiClient;
      URL.createObjectURL = vi.fn(() => `blob:mock-url-${Math.random()}`);
      URL.revokeObjectURL = vi.fn();
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    it('should load cover from cache when offline', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, writable: true });
      const mockBlob = new Blob(['mock-cover'], { type: 'image/jpeg' });
      vi.mocked(storage.getCachedCover).mockResolvedValue(mockBlob);

      const url = await getCoverWithCache(mockApiClient, 'test/offline-book.cbz');

      expect(url).toContain('blob:mock-url');
      expect(storage.getCachedCover).toHaveBeenCalledWith('test/offline-book.cbz');
      expect(mockApiClient.getCover).not.toHaveBeenCalled();
    });

    it('should return null when offline and cover not cached', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, writable: true });
      vi.mocked(storage.getCachedCover).mockResolvedValue(null);

      const url = await getCoverWithCache(mockApiClient, 'test/not-cached.cbz');

      expect(url).toBeNull();
      expect(mockApiClient.getCover).not.toHaveBeenCalled();
    });
  });

  describe('Offline Page Loading', () => {
    let mockApiClient: ApiClient;

    beforeEach(() => {
      mockApiClient = {
        getPage: vi.fn(),
      } as unknown as ApiClient;
      URL.createObjectURL = vi.fn(() => 'blob:mock-page-url');
    });

    it('should load page from cache when available', async () => {
      Object.defineProperty(navigator, 'onLine', { value: true, writable: true });
      const mockBlob = new Blob(['mock-page'], { type: 'image/jpeg' });
      vi.mocked(storage.getCachedPage).mockResolvedValue(mockBlob);

      const url = await getPageWithCache(mockApiClient, 'test/book.cbz', 0);

      expect(url).toBe('blob:mock-page-url');
      expect(storage.getCachedPage).toHaveBeenCalledWith('test/book.cbz', 0);
      expect(mockApiClient.getPage).not.toHaveBeenCalled();
    });

    it('should throw error when offline and page not cached', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, writable: true });
      vi.mocked(storage.getCachedPage).mockResolvedValue(null);

      await expect(getPageWithCache(null, 'test/book.cbz', 0))
        .rejects.toThrow('Page not cached and offline');
    });

    it('should fetch and cache page when online', async () => {
      Object.defineProperty(navigator, 'onLine', { value: true, writable: true });
      Object.defineProperty(navigator, 'connection', { value: undefined, writable: true });
      const mockBlob = new Blob(['mock-page'], { type: 'image/jpeg' });
      vi.mocked(storage.getCachedPage).mockResolvedValue(null);
      vi.mocked(mockApiClient.getPage).mockResolvedValue(mockBlob);
      vi.mocked(storage.cachePage).mockResolvedValue();

      const url = await getPageWithCache(mockApiClient, 'test/book.cbz', 0);

      expect(url).toBe('blob:mock-page-url');
      expect(mockApiClient.getPage).toHaveBeenCalledWith('test/book.cbz', 0);
      expect(storage.cachePage).toHaveBeenCalledWith('test/book.cbz', 0, mockBlob);
    });
  });

  describe('Offline Reading Progress', () => {
    let mockApiClient: ApiClient;

    beforeEach(() => {
      mockApiClient = {
        updateReadingProgress: vi.fn(),
      } as unknown as ApiClient;
    });

    it('should queue update when offline', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, writable: true });
      vi.mocked(storage.updateLocalReadingListItem).mockResolvedValue();
      vi.mocked(storage.addPendingUpdate).mockResolvedValue();

      await updateReadingProgress(mockApiClient, 'test/book.cbz', 5, 10);

      expect(storage.updateLocalReadingListItem).toHaveBeenCalledWith('test/book.cbz', 5, false);
      expect(storage.addPendingUpdate).toHaveBeenCalledWith('test/book.cbz', 5);
      expect(mockApiClient.updateReadingProgress).not.toHaveBeenCalled();
    });

    it('should update server when online', async () => {
      Object.defineProperty(navigator, 'onLine', { value: true, writable: true });
      vi.mocked(storage.updateLocalReadingListItem).mockResolvedValue();
      vi.mocked(mockApiClient.updateReadingProgress).mockResolvedValue({
        totalCount: 0,
        items: [],
      });

      await updateReadingProgress(mockApiClient, 'test/book.cbz', 5, 10);

      expect(storage.updateLocalReadingListItem).toHaveBeenCalledWith('test/book.cbz', 5, false);
      expect(mockApiClient.updateReadingProgress).toHaveBeenCalledWith('test/book.cbz', 5);
      expect(storage.addPendingUpdate).not.toHaveBeenCalled();
    });

    it('should queue update when server request fails', async () => {
      Object.defineProperty(navigator, 'onLine', { value: true, writable: true });
      vi.mocked(storage.updateLocalReadingListItem).mockResolvedValue();
      vi.mocked(mockApiClient.updateReadingProgress).mockRejectedValue(new Error('Network error'));
      vi.mocked(storage.addPendingUpdate).mockResolvedValue();

      await updateReadingProgress(mockApiClient, 'test/book.cbz', 5, 10);

      expect(storage.addPendingUpdate).toHaveBeenCalledWith('test/book.cbz', 5);
    });

    it('should mark book as completed when on last page', async () => {
      Object.defineProperty(navigator, 'onLine', { value: true, writable: true });
      vi.mocked(storage.updateLocalReadingListItem).mockResolvedValue();
      vi.mocked(mockApiClient.updateReadingProgress).mockResolvedValue({
        totalCount: 0,
        items: [],
      });

      await updateReadingProgress(mockApiClient, 'test/book.cbz', 9, 10);

      expect(storage.updateLocalReadingListItem).toHaveBeenCalledWith('test/book.cbz', 9, true);
    });
  });

  describe('Sync Pending Updates', () => {
    let mockApiClient: ApiClient;

    beforeEach(() => {
      mockApiClient = {
        getReadingListItem: vi.fn(),
        updateReadingProgress: vi.fn(),
      } as unknown as ApiClient;
      Object.defineProperty(navigator, 'onLine', { value: true, writable: true });
    });

    it('should not sync when offline', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, writable: true });

      await syncPendingUpdates(mockApiClient);

      expect(storage.getPendingUpdates).not.toHaveBeenCalled();
    });

    it('should sync pending updates when online', async () => {
      vi.mocked(storage.getPendingUpdates).mockResolvedValue([
        { id: '1', bookPath: 'test/book.cbz', pageIndex: 5, timestamp: '2025-01-01' },
      ]);
      vi.mocked(mockApiClient.getReadingListItem).mockResolvedValue({
        bookPath: 'test/book.cbz',
        pageIndex: 3,
        completed: false,
        lastRead: '2025-01-01',
        book: null,
      });
      vi.mocked(mockApiClient.updateReadingProgress).mockResolvedValue({
        totalCount: 0,
        items: [],
      });
      vi.mocked(storage.removePendingUpdate).mockResolvedValue();

      await syncPendingUpdates(mockApiClient);

      expect(mockApiClient.updateReadingProgress).toHaveBeenCalledWith('test/book.cbz', 5);
      expect(storage.removePendingUpdate).toHaveBeenCalledWith('1');
    });

    it('should not update server if local progress is lower', async () => {
      vi.mocked(storage.getPendingUpdates).mockResolvedValue([
        { id: '1', bookPath: 'test/book.cbz', pageIndex: 3, timestamp: '2025-01-01' },
      ]);
      vi.mocked(mockApiClient.getReadingListItem).mockResolvedValue({
        bookPath: 'test/book.cbz',
        pageIndex: 5,
        completed: false,
        lastRead: '2025-01-01',
        book: null,
      });
      vi.mocked(storage.removePendingUpdate).mockResolvedValue();

      await syncPendingUpdates(mockApiClient);

      expect(mockApiClient.updateReadingProgress).not.toHaveBeenCalled();
      expect(storage.removePendingUpdate).toHaveBeenCalledWith('1');
    });
  });

  describe('Preload Cover Cache', () => {
    beforeEach(() => {
      URL.createObjectURL = vi.fn(() => `blob:preload-${Math.random()}`);
    });

    it('should preload covers from IndexedDB in batches', async () => {
      const bookPaths = Array.from({ length: 25 }, (_, i) => `preload-book-${i}.cbz`);
      const mockBlob = new Blob(['cover'], { type: 'image/jpeg' });
      vi.mocked(storage.getCachedCover).mockResolvedValue(mockBlob);

      await preloadCoverCache(bookPaths);

      expect(storage.getCachedCover).toHaveBeenCalledTimes(25);
    });
  });
});
