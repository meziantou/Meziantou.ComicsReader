import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { ApiClient, getApiClient } from '../services/apiClient';
import {
  getSettings,
  saveSettings,
  getCachedBooks,
  getLocalReadingList,
} from '../services/storage';
import {
  syncPendingUpdates,
  performCleanup,
  isOnline,
  getAllCachedBooksInfo,
  preloadCoverCache,
  autoDownloadAllBooks,
  cancelAutoDownload,
} from '../services/offlineService';
import { computeNextBooksToRead } from '../utils';
import type { AppSettings, BookResponse, ReadingListItemResponse } from '../types';

// Deep equality check for arrays of objects
function areArraysEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;

  // Sort both arrays to ensure consistent comparison
  const sortedA = [...a].sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
  const sortedB = [...b].sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));

  return sortedA.every((item, index) => {
    const aStr = JSON.stringify(item);
    const bStr = JSON.stringify(sortedB[index]);
    return aStr === bStr;
  });
}

// Compare books arrays but ignore lastRead timestamps during background refresh
function areBooksEqualIgnoringTimestamp(a: BookResponse[], b: BookResponse[]): boolean {
  if (a.length !== b.length) return false;

  // Create sorted copies without lastRead field
  const stripLastRead = (book: BookResponse) => {
    const { lastRead, ...rest } = book;
    return rest;
  };

  const sortedA = [...a].map(stripLastRead).sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
  const sortedB = [...b].map(stripLastRead).sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));

  return sortedA.every((item, index) => {
    const aStr = JSON.stringify(item);
    const bStr = JSON.stringify(sortedB[index]);
    return aStr === bStr;
  });
}

interface AppContextValue {
  // Settings
  settings: AppSettings;
  updateSettings: (settings: AppSettings) => Promise<void>;

  // API client
  apiClient: ApiClient | null;

  // Data
  books: BookResponse[];
  readingList: ReadingListItemResponse[];
  nextToRead: BookResponse[];
  isLoading: boolean;
  error: string | null;

  // Cache info
  cachedBooksInfo: Map<string, { fullyDownloaded: boolean }>;

  // Actions
  refreshData: (isBackgroundRefresh?: boolean) => Promise<void>;
  triggerReindex: () => Promise<void>;
  updateReadingList: (readingList: ReadingListItemResponse[]) => void;

  // Online status
  online: boolean;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
}

interface AppProviderProps {
  children: ReactNode;
}

export function AppProvider({ children }: AppProviderProps) {
  const [settings, setSettings] = useState<AppSettings>({
    serverUrl: import.meta.env.DEV ? 'https://localhost:7183' : '/',
    token: '',
    autoDownloadNewBooks: false,
    largeFullscreenProgressBar: false,
  });
  const [apiClient, setApiClient] = useState<ApiClient | null>(null);
  const [books, setBooks] = useState<BookResponse[]>([]);
  const [readingList, setReadingList] = useState<ReadingListItemResponse[]>([]);
  const [nextToRead, setNextToRead] = useState<BookResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(isOnline());
  const [cachedBooksInfo, setCachedBooksInfo] = useState<Map<string, { fullyDownloaded: boolean }>>(new Map());

  // Use refs to track previous data and avoid unnecessary re-renders during background refreshes
  const previousBooksRef = useRef<BookResponse[]>([]);
  const previousReadingListRef = useRef<ReadingListItemResponse[]>([]);

  // Update cached books info
  const updateCachedBooksInfo = useCallback(async () => {
    const info = await getAllCachedBooksInfo();
    setCachedBooksInfo(info);
  }, []);

  // Load data from local cache (for offline mode)
  const loadCachedData = useCallback(async () => {
    try {
      const cachedBooksData = await getCachedBooks();
      const localReadingListMap = await getLocalReadingList();

      if (cachedBooksData.length === 0) {
        return false;
      }

      // Convert local reading list map to array of ReadingListItemResponse
      const readingListItems: ReadingListItemResponse[] = Array.from(localReadingListMap.entries()).map(
        ([bookPath, item]) => ({
          bookPath,
          pageIndex: item.pageIndex,
          completed: item.completed,
          lastRead: item.lastRead,
          book: null,
        })
      );

      // Apply reading list progress to cached books
      const booksWithProgress = cachedBooksData.map(({ book }) => {
        const progress = localReadingListMap.get(book.path);
        if (progress) {
          return {
            ...book,
            currentPage: progress.pageIndex,
            isCompleted: progress.completed,
            lastRead: progress.lastRead,
          };
        }
        return book;
      });

      setBooks(booksWithProgress);
      setReadingList(readingListItems);

      // Compute next books to read on the client
      const nextBooks = computeNextBooksToRead(booksWithProgress, readingListItems);
      setNextToRead(nextBooks);

      // Preload cover cache in background
      preloadCoverCache(booksWithProgress.map(b => b.path)).catch(err => 
        console.error('Failed to preload cover cache:', err)
      );

      return true;
    } catch (err) {
      console.error('Failed to load cached data:', err);
      return false;
    }
  }, []);

  // Fetch data from server
  const fetchData = useCallback(async (client: ApiClient, isBackgroundRefresh = false) => {
    try {
      const [booksResponse, readingListResponse] = await Promise.all([
        client.getBooks(),
        client.getReadingList(),
      ]);

      // Create a map of server reading list for quick lookups
      const serverReadingMap = new Map(
        readingListResponse.items.map(item => [
          item.bookPath,
          {
            pageIndex: item.pageIndex,
            completed: item.completed,
            lastRead: item.lastRead,
          }
        ])
      );

      // Apply server reading list to books immediately
      const booksWithProgress = booksResponse.books.map(book => {
        const progress = serverReadingMap.get(book.path);
        if (progress) {
          return {
            ...book,
            currentPage: progress.pageIndex,
            isCompleted: progress.completed,
            lastRead: progress.lastRead,
          };
        }
        return book;
      });

      // For background refreshes, only update state if data has actually changed
      // Ignore lastRead timestamp changes during background refresh to prevent flickering while reading
      const shouldUpdate = !isBackgroundRefresh || (
        !areBooksEqualIgnoringTimestamp(booksWithProgress, previousBooksRef.current) ||
        !areArraysEqual(readingListResponse.items, previousReadingListRef.current)
      );

      if (shouldUpdate) {
        previousBooksRef.current = booksWithProgress;
        previousReadingListRef.current = readingListResponse.items;

        setBooks(booksWithProgress);
        setReadingList(readingListResponse.items);

        // Compute next books to read on the client
        const nextBooks = computeNextBooksToRead(booksWithProgress, readingListResponse.items);
        setNextToRead(nextBooks);
      }

      // Preload cover cache and run cleanup in background to not delay rendering
      Promise.all([
        preloadCoverCache(booksResponse.books.map(b => b.path)),
        performCleanup(booksResponse.books, readingListResponse.items),
        updateCachedBooksInfo(),
      ]).catch(err => console.error('Background tasks failed:', err));

      // Auto-download all books if enabled (runs in background)
      const currentSettings = await getSettings();
      if (currentSettings.autoDownloadNewBooks) {
        autoDownloadAllBooks(client, booksResponse.books).catch(err => 
          console.error('Auto-download failed:', err)
        );
      }

      return true;
    } catch (err) {
      console.error('Failed to fetch data:', err);
      throw err;
    }
  }, [updateCachedBooksInfo]);

  // Refresh data
  const refreshData = useCallback(async (isBackgroundRefresh = false) => {
    if (!apiClient) return;

    // Only show loading indicator for user-initiated refreshes
    if (!isBackgroundRefresh) {
      setIsLoading(true);
    }
    setError(null);

    try {
      // Sync pending updates in background to not block data fetching
      syncPendingUpdates(apiClient).catch(err => 
        console.error('Failed to sync pending updates:', err)
      );
      
      await fetchData(apiClient, isBackgroundRefresh);
      
      if (!isBackgroundRefresh) {
        setIsLoading(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh data');
      if (!isBackgroundRefresh) {
        setIsLoading(false);
      }
    }
  }, [apiClient, fetchData]);

  // Update settings
  const updateSettings = useCallback(async (newSettings: AppSettings) => {
    const previousSettings = settings;
    await saveSettings(newSettings);
    setSettings(newSettings);

    // Create new API client with updated settings
    const client = getApiClient(newSettings.serverUrl, newSettings.token || null);
    setApiClient(client);

    // If auto-download was just enabled, trigger download of all books
    if (!previousSettings.autoDownloadNewBooks && newSettings.autoDownloadNewBooks && books.length > 0) {
      autoDownloadAllBooks(client, books).catch(err => 
        console.error('Failed to start auto-download:', err)
      );
    }
    // If auto-download was just disabled, cancel ongoing download
    else if (previousSettings.autoDownloadNewBooks && !newSettings.autoDownloadNewBooks) {
      cancelAutoDownload();
    }
  }, [settings, books]);

  // Trigger reindex
  const triggerReindex = useCallback(async () => {
    if (!apiClient) return;
    await apiClient.triggerReindex();
  }, [apiClient]);

  // Initialize
  useEffect(() => {
    const init = async () => {
      try {
        const loadedSettings = await getSettings();
        setSettings(loadedSettings);

        const client = getApiClient(loadedSettings.serverUrl, loadedSettings.token || null);
        setApiClient(client);

        if (isOnline()) {
          await syncPendingUpdates(client);
          await fetchData(client, false);
        } else {
          // When offline, load cached data from IndexedDB
          await loadCachedData();
        }

        await updateCachedBooksInfo();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to initialize');
      } finally {
        setIsLoading(false);
      }
    };

    init();
  }, [fetchData, loadCachedData, updateCachedBooksInfo]);

  // Auto-refresh every minute
  useEffect(() => {
    if (!apiClient) return;

    const interval = setInterval(() => {
      if (isOnline()) {
        refreshData(true); // Pass true to indicate background refresh
      }
    }, 60000);

    return () => clearInterval(interval);
  }, [apiClient, refreshData]);

  // Online/offline listener
  useEffect(() => {
    const handleOnline = async () => {
      setOnline(true);
      if (apiClient) {
        try {
          await refreshData();
        } catch (err) {
          console.error('Failed to refresh data when coming online, using cached data:', err);
          await loadCachedData();
        }
      }
    };

    const handleOffline = async () => {
      setOnline(false);
      // Load cached data when going offline
      await loadCachedData();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [apiClient, refreshData, loadCachedData]);

  const updateReadingList = useCallback((newReadingList: ReadingListItemResponse[]) => {
    setReadingList(newReadingList);
  }, []);

  const value: AppContextValue = {
    settings,
    updateSettings,
    apiClient,
    books,
    readingList,
    nextToRead,
    isLoading,
    error,
    cachedBooksInfo,
    refreshData,
    triggerReindex,
    updateReadingList,
    online,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
