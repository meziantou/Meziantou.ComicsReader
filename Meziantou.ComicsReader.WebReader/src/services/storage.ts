import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { AppSettings, BookResponse, PendingProgressUpdate } from '../types';

const DB_NAME = 'comics-reader-db';
const DB_VERSION = 1;

interface ComicsReaderDB extends DBSchema {
  settings: {
    key: string;
    value: AppSettings;
  };
  books: {
    key: string;
    value: {
      path: string;
      book: BookResponse;
      cachedAt: string;
      fullyDownloaded: boolean;
    };
    indexes: { 'by-cached-at': string };
  };
  covers: {
    key: string;
    value: {
      path: string;
      blob: Blob;
    };
  };
  pages: {
    key: [string, number];
    value: {
      bookPath: string;
      pageIndex: number;
      blob: Blob;
    };
    indexes: { 'by-book-path': string };
  };
  pendingUpdates: {
    key: string;
    value: PendingProgressUpdate;
    indexes: { 'by-timestamp': string };
  };
  readingList: {
    key: string;
    value: {
      bookPath: string;
      pageIndex: number;
      completed: boolean;
      lastRead: string;
    };
  };
}

let dbInstance: IDBPDatabase<ComicsReaderDB> | null = null;

async function getDB(): Promise<IDBPDatabase<ComicsReaderDB>> {
  if (dbInstance) {
    return dbInstance;
  }

  dbInstance = await openDB<ComicsReaderDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Settings store
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings');
      }

      // Books store
      if (!db.objectStoreNames.contains('books')) {
        const booksStore = db.createObjectStore('books', { keyPath: 'path' });
        booksStore.createIndex('by-cached-at', 'cachedAt');
      }

      // Covers store
      if (!db.objectStoreNames.contains('covers')) {
        db.createObjectStore('covers', { keyPath: 'path' });
      }

      // Pages store
      if (!db.objectStoreNames.contains('pages')) {
        const pagesStore = db.createObjectStore('pages', { keyPath: ['bookPath', 'pageIndex'] });
        pagesStore.createIndex('by-book-path', 'bookPath');
      }

      // Pending updates store
      if (!db.objectStoreNames.contains('pendingUpdates')) {
        const pendingStore = db.createObjectStore('pendingUpdates', { keyPath: 'id' });
        pendingStore.createIndex('by-timestamp', 'timestamp');
      }

      // Reading list store (local copy)
      if (!db.objectStoreNames.contains('readingList')) {
        db.createObjectStore('readingList', { keyPath: 'bookPath' });
      }
    },
  });

  return dbInstance;
}

// Settings
const DEFAULT_SETTINGS: AppSettings = {
  serverUrl: import.meta.env.DEV ? 'https://localhost:7183' : '/',
  token: '',
  autoDownloadNewBooks: false,
  largeFullscreenProgressBar: false,
};

export async function getSettings(): Promise<AppSettings> {
  const db = await getDB();
  const settings = await db.get('settings', 'app-settings');
  return settings ?? DEFAULT_SETTINGS;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const db = await getDB();
  await db.put('settings', settings, 'app-settings');
}

// Books cache
export async function getCachedBook(path: string): Promise<BookResponse | null> {
  const db = await getDB();
  const cached = await db.get('books', path);
  return cached?.book ?? null;
}

export async function getCachedBooks(): Promise<Array<{ path: string; book: BookResponse; fullyDownloaded: boolean }>> {
  const db = await getDB();
  return db.getAll('books');
}

export async function cacheBook(book: BookResponse, fullyDownloaded: boolean = false): Promise<void> {
  const db = await getDB();
  await db.put('books', {
    path: book.path,
    book,
    cachedAt: new Date().toISOString(),
    fullyDownloaded,
  });
}

export async function updateBookDownloadStatus(path: string, fullyDownloaded: boolean): Promise<void> {
  const db = await getDB();
  const existing = await db.get('books', path);
  if (existing) {
    await db.put('books', {
      ...existing,
      fullyDownloaded,
    });
  }
}

export async function isBookFullyDownloaded(path: string): Promise<boolean> {
  const db = await getDB();
  const cached = await db.get('books', path);
  return cached?.fullyDownloaded ?? false;
}

export async function removeCachedBook(path: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['books', 'covers', 'pages'], 'readwrite');

  await tx.objectStore('books').delete(path);
  await tx.objectStore('covers').delete(path);

  // Delete all pages for this book
  const pagesStore = tx.objectStore('pages');
  const pagesIndex = pagesStore.index('by-book-path');
  const pageKeys = await pagesIndex.getAllKeys(path);
  for (const key of pageKeys) {
    await pagesStore.delete(key);
  }

  await tx.done;

  // Note: We don't clean up the in-memory cover URL cache here because
  // the cover might still be displayed in the UI (e.g., in filtered views).
  // The blob URLs will be automatically cleaned up when the page is refreshed
  // or when the browser's garbage collector runs.
}

// Covers cache
export async function getCachedCover(path: string): Promise<Blob | null> {
  const db = await getDB();
  const cached = await db.get('covers', path);
  return cached?.blob ?? null;
}

export async function cacheCover(path: string, blob: Blob): Promise<void> {
  const db = await getDB();
  await db.put('covers', { path, blob });
}

// Pages cache
export async function getCachedPage(bookPath: string, pageIndex: number): Promise<Blob | null> {
  const db = await getDB();
  const cached = await db.get('pages', [bookPath, pageIndex]);
  return cached?.blob ?? null;
}

export async function cachePage(bookPath: string, pageIndex: number, blob: Blob): Promise<void> {
  const db = await getDB();
  await db.put('pages', { bookPath, pageIndex, blob });
}

export async function getCachedPageCount(bookPath: string): Promise<number> {
  const db = await getDB();
  const index = db.transaction('pages').store.index('by-book-path');
  return index.count(bookPath);
}

export async function getCachedPageIndices(bookPath: string): Promise<number[]> {
  const db = await getDB();
  const index = db.transaction('pages').store.index('by-book-path');
  const pages = await index.getAll(bookPath);
  return pages.map(p => p.pageIndex).sort((a, b) => a - b);
}

// Pending updates (offline queue)
export async function addPendingUpdate(bookPath: string, pageIndex: number): Promise<void> {
  const db = await getDB();
  const id = `${bookPath}-${Date.now()}`;
  const update: PendingProgressUpdate = {
    id,
    bookPath,
    pageIndex,
    timestamp: new Date().toISOString(),
  };
  await db.put('pendingUpdates', update);
}

export async function getPendingUpdates(): Promise<PendingProgressUpdate[]> {
  const db = await getDB();
  return db.getAllFromIndex('pendingUpdates', 'by-timestamp');
}

export async function removePendingUpdate(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('pendingUpdates', id);
}

export async function clearPendingUpdatesForBook(bookPath: string): Promise<void> {
  const db = await getDB();
  const updates = await db.getAll('pendingUpdates');
  const tx = db.transaction('pendingUpdates', 'readwrite');
  for (const update of updates) {
    if (update.bookPath === bookPath) {
      await tx.store.delete(update.id);
    }
  }
  await tx.done;
}

// Local reading list (for offline access)
export async function getLocalReadingList(): Promise<Map<string, { pageIndex: number; completed: boolean; lastRead: string }>> {
  const db = await getDB();
  const items = await db.getAll('readingList');
  return new Map(items.map(item => [item.bookPath, { pageIndex: item.pageIndex, completed: item.completed, lastRead: item.lastRead }]));
}

export async function updateLocalReadingListItem(bookPath: string, pageIndex: number, completed: boolean): Promise<void> {
  const db = await getDB();
  await db.put('readingList', {
    bookPath,
    pageIndex,
    completed,
    lastRead: new Date().toISOString(),
  });
}

export async function removeLocalReadingListItem(bookPath: string): Promise<void> {
  const db = await getDB();
  await db.delete('readingList', bookPath);
}

export async function syncReadingListFromServer(
  items: Array<{ bookPath: string; pageIndex: number; completed: boolean; lastRead: string }>
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('readingList', 'readwrite');

  // Clear existing and add new
  await tx.store.clear();
  for (const item of items) {
    await tx.store.put(item);
  }

  await tx.done;
}

// Cleanup: remove books that are no longer available
export async function cleanupRemovedBooks(availableBookPaths: Set<string>): Promise<void> {
  const db = await getDB();
  const cachedBooks = await db.getAll('books');

  for (const cached of cachedBooks) {
    if (!availableBookPaths.has(cached.path)) {
      await removeCachedBook(cached.path);
    }
  }
}

// Cleanup: remove completed books from cache
export async function cleanupCompletedBooks(completedBookPaths: Set<string>): Promise<void> {
  for (const path of completedBookPaths) {
    await removeCachedBook(path);
  }
}

// Clear all cached pages
export async function clearAllCachedPages(): Promise<void> {
  const db = await getDB();
  await db.clear('pages');
}

// Clear all cached covers
export async function clearAllCachedCovers(): Promise<void> {
  const db = await getDB();
  await db.clear('covers');
}

// Clear all cached books (including covers and pages)
export async function clearAllCachedBooks(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['books', 'covers', 'pages'], 'readwrite');
  await tx.objectStore('books').clear();
  await tx.objectStore('covers').clear();
  await tx.objectStore('pages').clear();
  await tx.done;
}

// Get total size estimates for cached data
export async function getCacheSizeEstimates(): Promise<{
  books: number;
  covers: number;
  pages: number;
  totalSizeBytes?: number;
}> {
  const db = await getDB();
  const [books, covers, pages] = await Promise.all([
    db.count('books'),
    db.count('covers'),
    db.count('pages'),
  ]);
  
  // Get storage estimate if available
  let totalSizeBytes: number | undefined;
  if ('storage' in navigator && 'estimate' in navigator.storage) {
    try {
      const estimate = await navigator.storage.estimate();
      totalSizeBytes = estimate.usage;
    } catch {
      // Ignore if not available
    }
  }
  
  return { books, covers, pages, totalSizeBytes };
}

// For testing: reset the database instance
export function _resetDBInstance(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
