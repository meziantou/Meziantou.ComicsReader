import { ApiClient } from './apiClient';
import {
  addPendingUpdate,
  getPendingUpdates,
  removePendingUpdate,
  getLocalReadingList,
  updateLocalReadingListItem,
  getCachedPage,
  cachePage,
  getCachedCover,
  cacheCover,
  cacheBook,
  updateBookDownloadStatus,
  getCachedBooks,
  cleanupRemovedBooks,
  cleanupCompletedBooks,
  isBookFullyDownloaded,
  getCachedPageCount,
  getCachedPageIndices,
} from './storage';
import type { BookResponse, ReadingListItemResponse } from '../types';

// In-memory cache for cover URLs to avoid repeated IndexedDB lookups
const coverUrlCache = new Map<string, string>();

// Preload cached cover URLs from IndexedDB into memory
export async function preloadCoverCache(bookPaths: string[]): Promise<void> {
  // Load cached covers in parallel (batched to avoid overwhelming IndexedDB)
  const batchSize = 20;
  for (let i = 0; i < bookPaths.length; i += batchSize) {
    const batch = bookPaths.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (path) => {
        if (!coverUrlCache.has(path)) {
          const cached = await getCachedCover(path);
          if (cached) {
            const url = URL.createObjectURL(cached);
            coverUrlCache.set(path, url);
          }
        }
      })
    );
  }
}

// Clean up cover URL cache entry
export function cleanupCoverUrlCache(bookPath: string): void {
  const url = coverUrlCache.get(bookPath);
  if (url) {
    URL.revokeObjectURL(url);
    coverUrlCache.delete(bookPath);
  }
}

// Check if we're on a metered connection (low data mode)
export function isOnMeteredConnection(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  // Check if Save Data mode (low data mode) is enabled
  return connection?.saveData ?? false;
}

// Check if online
export function isOnline(): boolean {
  return navigator.onLine;
}

// Sync pending progress updates to server
export async function syncPendingUpdates(apiClient: ApiClient): Promise<void> {
  if (!isOnline()) {
    return;
  }

  const pendingUpdates = await getPendingUpdates();

  // Group by book path, keeping only the highest page for each
  const latestByBook = new Map<string, { id: string; pageIndex: number }>();
  for (const update of pendingUpdates) {
    const existing = latestByBook.get(update.bookPath);
    if (!existing || update.pageIndex > existing.pageIndex) {
      latestByBook.set(update.bookPath, { id: update.id, pageIndex: update.pageIndex });
    }
  }

  for (const [bookPath, { pageIndex }] of latestByBook) {
    try {
      // Get current server state
      const serverItem = await apiClient.getReadingListItem(bookPath);

      // Conflict resolution: highest page number wins
      if (!serverItem || pageIndex > serverItem.pageIndex) {
        await apiClient.updateReadingProgress(bookPath, pageIndex);
      }

      // Remove all pending updates for this book
      for (const update of pendingUpdates) {
        if (update.bookPath === bookPath) {
          await removePendingUpdate(update.id);
        }
      }
    } catch (error) {
      // If it's a 400 error (Bad Request), the book probably doesn't exist anymore
      // Delete the pending updates instead of retrying
      if (error instanceof Error && 'status' in error && (error as any).status === 400) {
        console.warn(`Book not found (400), removing pending updates for ${bookPath}`);
        for (const update of pendingUpdates) {
          if (update.bookPath === bookPath) {
            await removePendingUpdate(update.id);
          }
        }
      } else {
        console.error(`Failed to sync progress for ${bookPath}:`, error);
        // Keep pending updates for retry on other errors
      }
    }
  }
}

// Update reading progress (works both online and offline)
export async function updateReadingProgress(
  apiClient: ApiClient | null,
  bookPath: string,
  pageIndex: number,
  pageCount: number
): Promise<void> {
  const completed = pageIndex >= pageCount - 1;

  // Always update local storage
  await updateLocalReadingListItem(bookPath, pageIndex, completed);

  if (isOnline() && apiClient) {
    try {
      await apiClient.updateReadingProgress(bookPath, pageIndex);
    } catch (error) {
      console.error('Failed to update progress online, queuing for later:', error);
      await addPendingUpdate(bookPath, pageIndex);
    }
  } else {
    // Queue for later sync
    await addPendingUpdate(bookPath, pageIndex);
  }
}

// Get page with caching
export async function getPageWithCache(
  apiClient: ApiClient | null,
  bookPath: string,
  pageIndex: number,
  autoCachePages: boolean = true
): Promise<string> {
  // Try cache first
  const cached = await getCachedPage(bookPath, pageIndex);
  if (cached) {
    return URL.createObjectURL(cached);
  }

  // Fetch from server
  if (!apiClient || !isOnline()) {
    throw new Error('Page not cached and offline');
  }

  const blob = await apiClient.getPage(bookPath, pageIndex);

  // Cache if auto-caching is enabled and not on metered connection
  if (autoCachePages && !isOnMeteredConnection()) {
    await cachePage(bookPath, pageIndex, blob);
  }

  return URL.createObjectURL(blob);
}

// Get cover with caching
export async function getCoverWithCache(
  apiClient: ApiClient | null,
  bookPath: string
): Promise<string | null> {
  // Check in-memory cache first
  if (coverUrlCache.has(bookPath)) {
    return coverUrlCache.get(bookPath)!;
  }

  // If offline, check IndexedDB
  if (!isOnline()) {
    const cached = await getCachedCover(bookPath);
    if (cached) {
      const url = URL.createObjectURL(cached);
      coverUrlCache.set(bookPath, url);
      return url;
    }
    return null;
  }

  // If we have an API client and online, fetch directly
  if (apiClient) {
    try {
      const coverBlob = await apiClient.getCover(bookPath);
      const url = URL.createObjectURL(coverBlob);
      coverUrlCache.set(bookPath, url);
      // Cache in background for offline use
      cacheCover(bookPath, coverBlob).catch(err => 
        console.error('Failed to cache cover:', err)
      );
      return url;
    } catch (error) {
      console.error('Failed to fetch cover:', error);
      // Fallback to IndexedDB if fetch fails
      const cached = await getCachedCover(bookPath);
      if (cached) {
        const url = URL.createObjectURL(cached);
        coverUrlCache.set(bookPath, url);
        return url;
      }
      return null;
    }
  }

  return null;
}

// Download entire book for offline access
export async function downloadBookForOffline(
  apiClient: ApiClient,
  book: BookResponse,
  onProgress?: (downloaded: number, total: number) => void,
  signal?: AbortSignal
): Promise<void> {
  if (!isOnline()) {
    throw new Error('Cannot download while offline');
  }

  if (isOnMeteredConnection()) {
    throw new Error('Cannot download on metered connection');
  }

  // Check if aborted before starting
  if (signal?.aborted) {
    throw new Error('Download cancelled');
  }

  // Cache book info
  await cacheBook(book, false);

  // Download cover
  if (book.coverImageFileName) {
    if (signal?.aborted) {
      throw new Error('Download cancelled');
    }
    try {
      const coverBlob = await apiClient.getCover(book.path);
      await cacheCover(book.path, coverBlob);
    } catch (error) {
      console.error('Failed to download cover:', error);
    }
  }

  // Download all pages
  for (let i = 0; i < book.pageCount; i++) {
    // Check if aborted before each page download
    if (signal?.aborted) {
      throw new Error('Download cancelled');
    }
    
    const existingPage = await getCachedPage(book.path, i);
    if (!existingPage) {
      const pageBlob = await apiClient.getPage(book.path, i);
      await cachePage(book.path, i, pageBlob);
    }
    onProgress?.(i + 1, book.pageCount);
  }

  // Mark as fully downloaded
  await updateBookDownloadStatus(book.path, true);
}

// Auto-download state management
let autoDownloadAbortController: AbortController | null = null;

// Auto-download all books from catalog (respects metered connection check)
export async function autoDownloadAllBooks(
  apiClient: ApiClient,
  books: BookResponse[]
): Promise<void> {
  if (!isOnline() || isOnMeteredConnection()) {
    return;
  }

  // Cancel any existing download
  if (autoDownloadAbortController) {
    autoDownloadAbortController.abort();
  }

  // Create new abort controller for this download session
  autoDownloadAbortController = new AbortController();
  const signal = autoDownloadAbortController.signal;

  // Filter out already downloaded books
  const cachedBooksInfo = await getCachedBooks();
  const downloadedPaths = new Set(
    cachedBooksInfo.filter(b => b.fullyDownloaded).map(b => b.path)
  );

  const booksToDownload = books.filter(book => !downloadedPaths.has(book.path));

  if (booksToDownload.length === 0) {
    autoDownloadAbortController = null;
    return;
  }

  console.log(`Auto-downloading ${booksToDownload.length} books from catalog`);

  // Download books sequentially to avoid overwhelming the connection
  for (const book of booksToDownload) {
    // Check if download was cancelled
    if (signal.aborted) {
      console.log('Auto-download cancelled');
      autoDownloadAbortController = null;
      return;
    }

    try {
      await downloadBookForOffline(apiClient, book, undefined, signal);
      console.log(`Downloaded ${book.title}`);
    } catch (error) {
      if (error instanceof Error && error.message === 'Download cancelled') {
        console.log('Auto-download cancelled');
        autoDownloadAbortController = null;
        return;
      }
      console.error(`Failed to auto-download ${book.title}:`, error);
      // Continue with next book even if one fails
    }
  }

  console.log('Auto-download completed');
  autoDownloadAbortController = null;
}

// Cancel ongoing auto-download
export function cancelAutoDownload(): void {
  if (autoDownloadAbortController) {
    autoDownloadAbortController.abort();
    autoDownloadAbortController = null;
    console.log('Auto-download cancelled by user');
  }
}

// Clean up stale data
export async function performCleanup(
  currentBooks: BookResponse[],
  readingList: ReadingListItemResponse[]
): Promise<void> {
  // Remove books that are no longer available
  const availablePaths = new Set(currentBooks.map(b => b.path));
  await cleanupRemovedBooks(availablePaths);

  // Remove completed books from cache
  const completedPaths = new Set(
    readingList.filter(item => item.completed).map(item => item.bookPath)
  );
  await cleanupCompletedBooks(completedPaths);
}

// Get download status for a book
export async function getBookCacheStatus(bookPath: string, pageCount: number): Promise<{
  isCached: boolean;
  isFullyDownloaded: boolean;
  cachedPages: number;
  totalPages: number;
}> {
  const isFullyDownloaded = await isBookFullyDownloaded(bookPath);
  const cachedPages = await getCachedPageCount(bookPath);
  const isCached = cachedPages > 0;

  // Debug logging
  if (isCached) {
    const cachedPageIndices = await getCachedPageIndices(bookPath);
    console.debug('[Cache Debug]', {
      bookPath,
      isCached,
      isFullyDownloaded,
      cachedPages,
      totalPages: pageCount,
      cachedPageIndices,
    });
  }

  // Book is considered cached if it has cached pages
  // (covers are always cached when viewed, so they don't count)
  return {
    isCached,
    isFullyDownloaded,
    cachedPages,
    totalPages: pageCount,
  };
}

// Get all cached books info
export async function getAllCachedBooksInfo(): Promise<Map<string, { fullyDownloaded: boolean }>> {
  const books = await getCachedBooks();
  return new Map(books.map(b => [b.path, { fullyDownloaded: b.fullyDownloaded }]));
}

// Merge local and server reading lists (for offline/online sync)
export async function mergeReadingLists(
  serverItems: ReadingListItemResponse[]
): Promise<Map<string, { pageIndex: number; completed: boolean; lastRead: string }>> {
  const localList = await getLocalReadingList();
  const merged = new Map<string, { pageIndex: number; completed: boolean; lastRead: string }>();

  // Add server items
  for (const item of serverItems) {
    const local = localList.get(item.bookPath);
    if (local) {
      // Conflict resolution: highest page number wins
      if (local.pageIndex > item.pageIndex) {
        merged.set(item.bookPath, local);
      } else {
        merged.set(item.bookPath, {
          pageIndex: item.pageIndex,
          completed: item.completed,
          lastRead: item.lastRead,
        });
      }
    } else {
      merged.set(item.bookPath, {
        pageIndex: item.pageIndex,
        completed: item.completed,
        lastRead: item.lastRead,
      });
    }
  }

  // Add local-only items (not yet synced)
  for (const [path, item] of localList) {
    if (!merged.has(path)) {
      merged.set(path, item);
    }
  }

  return merged;
}
