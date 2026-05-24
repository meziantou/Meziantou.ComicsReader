import type { AppSettings, BookResponse, PendingProgressUpdate } from '../types';

const DB_NAME = 'comics-reader-db';
const DB_VERSION = 1;

type StoreName = 'settings' | 'books' | 'covers' | 'pages' | 'pendingUpdates' | 'readingList';

interface CachedBookRecord {
  path: string;
  book: BookResponse;
  cachedAt: string;
  fullyDownloaded: boolean;
}

interface CachedCoverRecord {
  path: string;
  blob: Blob;
}

interface CachedPageRecord {
  bookPath: string;
  pageIndex: number;
  blob: Blob;
}

interface ReadingListRecord {
  bookPath: string;
  pageIndex: number;
  completed: boolean;
  lastRead: string;
}

let dbInstance: IDBDatabase | null = null;

function requestToPromise<TResult>(request: IDBRequest<TResult>): Promise<TResult> {
  return new Promise<TResult>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings');
      }

      if (!db.objectStoreNames.contains('books')) {
        const booksStore = db.createObjectStore('books', { keyPath: 'path' });
        booksStore.createIndex('by-cached-at', 'cachedAt');
      }

      if (!db.objectStoreNames.contains('covers')) {
        db.createObjectStore('covers', { keyPath: 'path' });
      }

      if (!db.objectStoreNames.contains('pages')) {
        const pagesStore = db.createObjectStore('pages', { keyPath: ['bookPath', 'pageIndex'] });
        pagesStore.createIndex('by-book-path', 'bookPath');
      }

      if (!db.objectStoreNames.contains('pendingUpdates')) {
        const pendingStore = db.createObjectStore('pendingUpdates', { keyPath: 'id' });
        pendingStore.createIndex('by-timestamp', 'timestamp');
      }

      if (!db.objectStoreNames.contains('readingList')) {
        db.createObjectStore('readingList', { keyPath: 'bookPath' });
      }
    };
  });
}

async function getDB(): Promise<IDBDatabase> {
  if (dbInstance !== null) {
    return dbInstance;
  }

  dbInstance = await openDatabase();
  return dbInstance;
}

async function getFromStore<TValue>(storeName: StoreName, key: IDBValidKey): Promise<TValue | undefined> {
  const db = await getDB();
  const transaction = db.transaction(storeName, 'readonly');
  const store = transaction.objectStore(storeName);
  const request = store.get(key) as IDBRequest<TValue | undefined>;
  return requestToPromise(request);
}

async function getAllFromStore<TValue>(storeName: StoreName): Promise<TValue[]> {
  const db = await getDB();
  const transaction = db.transaction(storeName, 'readonly');
  const store = transaction.objectStore(storeName);
  const request = store.getAll() as IDBRequest<TValue[]>;
  return requestToPromise(request);
}

async function getAllFromStoreIndex<TValue>(
  storeName: StoreName,
  indexName: string,
  query?: IDBValidKey | IDBKeyRange,
): Promise<TValue[]> {
  const db = await getDB();
  const transaction = db.transaction(storeName, 'readonly');
  const store = transaction.objectStore(storeName);
  const index = store.index(indexName);
  const request = index.getAll(query) as IDBRequest<TValue[]>;
  return requestToPromise(request);
}

async function countFromStore(storeName: StoreName): Promise<number> {
  const db = await getDB();
  const transaction = db.transaction(storeName, 'readonly');
  const store = transaction.objectStore(storeName);
  return requestToPromise(store.count());
}

async function countFromStoreIndex(storeName: StoreName, indexName: string, query?: IDBValidKey | IDBKeyRange): Promise<number> {
  const db = await getDB();
  const transaction = db.transaction(storeName, 'readonly');
  const store = transaction.objectStore(storeName);
  const index = store.index(indexName);
  return requestToPromise(index.count(query));
}

async function putInStore(storeName: StoreName, value: unknown, key?: IDBValidKey): Promise<void> {
  const db = await getDB();
  const transaction = db.transaction(storeName, 'readwrite');
  const store = transaction.objectStore(storeName);
  if (key === undefined) {
    await requestToPromise(store.put(value));
  } else {
    await requestToPromise(store.put(value, key));
  }

  await transactionToPromise(transaction);
}

async function deleteFromStore(storeName: StoreName, key: IDBValidKey): Promise<void> {
  const db = await getDB();
  const transaction = db.transaction(storeName, 'readwrite');
  const store = transaction.objectStore(storeName);
  await requestToPromise(store.delete(key));
  await transactionToPromise(transaction);
}

async function clearStore(storeName: StoreName): Promise<void> {
  const db = await getDB();
  const transaction = db.transaction(storeName, 'readwrite');
  const store = transaction.objectStore(storeName);
  await requestToPromise(store.clear());
  await transactionToPromise(transaction);
}

const DEFAULT_SETTINGS: AppSettings = {
  serverUrl: import.meta.env.DEV ? 'https://localhost:7183' : '/',
  token: '',
  autoDownloadNewBooks: false,
  largeFullscreenProgressBar: false,
};

export async function getSettings(): Promise<AppSettings> {
  const settings = await getFromStore<AppSettings>('settings', 'app-settings');
  return settings ?? DEFAULT_SETTINGS;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await putInStore('settings', settings, 'app-settings');
}

export async function getCachedBook(path: string): Promise<BookResponse | null> {
  const cached = await getFromStore<CachedBookRecord>('books', path);
  return cached?.book ?? null;
}

export async function getCachedBooks(): Promise<Array<{ path: string; book: BookResponse; fullyDownloaded: boolean }>> {
  return getAllFromStore<CachedBookRecord>('books');
}

export async function cacheBook(book: BookResponse, fullyDownloaded: boolean = false): Promise<void> {
  await putInStore('books', {
    path: book.path,
    book,
    cachedAt: new Date().toISOString(),
    fullyDownloaded,
  } satisfies CachedBookRecord);
}

export async function updateBookDownloadStatus(path: string, fullyDownloaded: boolean): Promise<void> {
  const existing = await getFromStore<CachedBookRecord>('books', path);
  if (existing !== undefined) {
    await putInStore('books', {
      ...existing,
      fullyDownloaded,
    } satisfies CachedBookRecord);
  }
}

export async function isBookFullyDownloaded(path: string): Promise<boolean> {
  const cached = await getFromStore<CachedBookRecord>('books', path);
  return cached?.fullyDownloaded ?? false;
}

export async function removeCachedBook(path: string): Promise<void> {
  const db = await getDB();
  const transaction = db.transaction(['books', 'covers', 'pages'], 'readwrite');
  const booksStore = transaction.objectStore('books');
  const coversStore = transaction.objectStore('covers');
  const pagesStore = transaction.objectStore('pages');

  await requestToPromise(booksStore.delete(path));
  await requestToPromise(coversStore.delete(path));

  const pagesIndex = pagesStore.index('by-book-path');
  const pageKeys = await requestToPromise(pagesIndex.getAllKeys(path));
  for (const key of pageKeys) {
    await requestToPromise(pagesStore.delete(key));
  }

  await transactionToPromise(transaction);
}

export async function getCachedCover(path: string): Promise<Blob | null> {
  const cached = await getFromStore<CachedCoverRecord>('covers', path);
  return cached?.blob ?? null;
}

export async function cacheCover(path: string, blob: Blob): Promise<void> {
  await putInStore('covers', { path, blob } satisfies CachedCoverRecord);
}

export async function getCachedPage(bookPath: string, pageIndex: number): Promise<Blob | null> {
  const cached = await getFromStore<CachedPageRecord>('pages', [bookPath, pageIndex]);
  return cached?.blob ?? null;
}

export async function cachePage(bookPath: string, pageIndex: number, blob: Blob): Promise<void> {
  await putInStore('pages', { bookPath, pageIndex, blob } satisfies CachedPageRecord);
}

export async function getCachedPageCount(bookPath: string): Promise<number> {
  return countFromStoreIndex('pages', 'by-book-path', bookPath);
}

export async function getCachedPageIndices(bookPath: string): Promise<number[]> {
  const pages = await getAllFromStoreIndex<CachedPageRecord>('pages', 'by-book-path', bookPath);
  return pages.map(p => p.pageIndex).sort((a, b) => a - b);
}

export async function addPendingUpdate(bookPath: string, pageIndex: number): Promise<void> {
  const id = `${bookPath}-${Date.now()}`;
  const update: PendingProgressUpdate = {
    id,
    bookPath,
    pageIndex,
    timestamp: new Date().toISOString(),
  };
  await putInStore('pendingUpdates', update);
}

export async function getPendingUpdates(): Promise<PendingProgressUpdate[]> {
  return getAllFromStoreIndex<PendingProgressUpdate>('pendingUpdates', 'by-timestamp');
}

export async function removePendingUpdate(id: string): Promise<void> {
  await deleteFromStore('pendingUpdates', id);
}

export async function clearPendingUpdatesForBook(bookPath: string): Promise<void> {
  const updates = await getAllFromStore<PendingProgressUpdate>('pendingUpdates');
  const db = await getDB();
  const transaction = db.transaction('pendingUpdates', 'readwrite');
  const store = transaction.objectStore('pendingUpdates');
  for (const update of updates) {
    if (update.bookPath === bookPath) {
      await requestToPromise(store.delete(update.id));
    }
  }

  await transactionToPromise(transaction);
}

export async function getLocalReadingList(): Promise<Map<string, { pageIndex: number; completed: boolean; lastRead: string }>> {
  const items = await getAllFromStore<ReadingListRecord>('readingList');
  return new Map(items.map(item => [item.bookPath, { pageIndex: item.pageIndex, completed: item.completed, lastRead: item.lastRead }]));
}

export async function updateLocalReadingListItem(bookPath: string, pageIndex: number, completed: boolean): Promise<void> {
  await putInStore('readingList', {
    bookPath,
    pageIndex,
    completed,
    lastRead: new Date().toISOString(),
  } satisfies ReadingListRecord);
}

export async function removeLocalReadingListItem(bookPath: string): Promise<void> {
  await deleteFromStore('readingList', bookPath);
}

export async function syncReadingListFromServer(
  items: Array<{ bookPath: string; pageIndex: number; completed: boolean; lastRead: string }>
): Promise<void> {
  const db = await getDB();
  const transaction = db.transaction('readingList', 'readwrite');
  const store = transaction.objectStore('readingList');

  await requestToPromise(store.clear());
  for (const item of items) {
    await requestToPromise(store.put(item));
  }

  await transactionToPromise(transaction);
}

export async function cleanupRemovedBooks(availableBookPaths: Set<string>): Promise<void> {
  const cachedBooks = await getAllFromStore<CachedBookRecord>('books');

  for (const cached of cachedBooks) {
    if (!availableBookPaths.has(cached.path)) {
      await removeCachedBook(cached.path);
    }
  }
}

export async function cleanupCompletedBooks(completedBookPaths: Set<string>): Promise<void> {
  for (const path of completedBookPaths) {
    await removeCachedBook(path);
  }
}

export async function clearAllCachedPages(): Promise<void> {
  await clearStore('pages');
}

export async function clearAllCachedCovers(): Promise<void> {
  await clearStore('covers');
}

export async function clearAllCachedBooks(): Promise<void> {
  const db = await getDB();
  const transaction = db.transaction(['books', 'covers', 'pages'], 'readwrite');
  await requestToPromise(transaction.objectStore('books').clear());
  await requestToPromise(transaction.objectStore('covers').clear());
  await requestToPromise(transaction.objectStore('pages').clear());
  await transactionToPromise(transaction);
}

export async function getCacheSizeEstimates(): Promise<{
  books: number;
  covers: number;
  pages: number;
  totalSizeBytes?: number;
}> {
  const [books, covers, pages] = await Promise.all([
    countFromStore('books'),
    countFromStore('covers'),
    countFromStore('pages'),
  ]);

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

export function _resetDBInstance(): void {
  if (dbInstance !== null) {
    dbInstance.close();
    dbInstance = null;
  }
}
