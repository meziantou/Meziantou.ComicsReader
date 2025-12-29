import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context';
import {
  getCachedBooks,
  removeCachedBook,
  getCachedPageCount,
  clearAllCachedPages,
  clearAllCachedCovers,
  clearAllCachedBooks,
  getCacheSizeEstimates,
} from '../services/storage';
import { formatFileSize } from '../utils';
import type { AppSettings, BookResponse } from '../types';
import './SettingsPage.css';

export function SettingsPage() {
  const navigate = useNavigate();
  const { settings, updateSettings, triggerReindex, online } = useApp();

  const [formData, setFormData] = useState<AppSettings>(settings);
  const [isSaving, setIsSaving] = useState(false);
  const [isReindexing, setIsReindexing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [cachedBooks, setCachedBooks] = useState<Array<{ path: string; book: BookResponse; fullyDownloaded: boolean }>>([]);
  const [cachedPageCounts, setCachedPageCounts] = useState<Map<string, number>>(new Map());
  const [cacheStats, setCacheStats] = useState<{ books: number; covers: number; pages: number; totalSizeBytes?: number } | null>(null);
  const [serverVersion, setServerVersion] = useState<string | null>(null);
  const clientVersion = import.meta.env.VITE_APP_VERSION || 'dev';

  useEffect(() => {
    setFormData(settings);
  }, [settings]);

  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const { getApiClient } = await import('../services');
        const apiClient = getApiClient(settings.serverUrl, settings.token);
        const versionResponse = await apiClient.getVersion();
        setServerVersion(versionResponse.version);
      } catch (err) {
        console.error('Failed to fetch server version:', err);
      }
    };

    if (online && settings.serverUrl) {
      fetchVersion();
    }
  }, [online, settings.serverUrl, settings.token]);

  useEffect(() => {
    const loadCachedBooks = async () => {
      const books = await getCachedBooks();
      setCachedBooks(books);
      
      // Load page counts for books that aren't fully downloaded
      const counts = new Map<string, number>();
      for (const { path, fullyDownloaded } of books) {
        if (!fullyDownloaded) {
          const count = await getCachedPageCount(path);
          counts.set(path, count);
        }
      }
      setCachedPageCounts(counts);
      
      // Load cache statistics
      const stats = await getCacheSizeEstimates();
      setCacheStats(stats);
    };
    
    // Load initially
    loadCachedBooks();

    // Poll for updates every 2 seconds when auto-download is enabled
    const interval = setInterval(() => {
      if (settings.autoDownloadNewBooks) {
        loadCachedBooks();
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [settings.autoDownloadNewBooks]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setMessage(null);

    try {
      await updateSettings(formData);
      setMessage('Settings saved successfully');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReindex = async () => {
    if (!online) {
      setMessage('Cannot reindex while offline');
      return;
    }

    setIsReindexing(true);
    setMessage(null);

    try {
      await triggerReindex();
      setMessage('Reindex triggered successfully');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to trigger reindex');
    } finally {
      setIsReindexing(false);
    }
  };

  const handleRemoveFromCache = async (path: string) => {
    try {
      await removeCachedBook(path);
      setCachedBooks(books => books.filter(b => b.path !== path));
      setMessage('Book removed from cache');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to remove from cache');
    }
  };

  const handleClearAllCache = async () => {
    if (!confirm('Are you sure you want to clear all cached books?')) {
      return;
    }

    try {
      for (const book of cachedBooks) {
        await removeCachedBook(book.path);
      }
      setCachedBooks([]);
      const stats = await getCacheSizeEstimates();
      setCacheStats(stats);
      setMessage('All cached books removed');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to clear cache');
    }
  };

  const handleClearAllPages = async () => {
    if (!confirm('Are you sure you want to clear all cached pages? This will remove page cache but keep book metadata and covers.')) {
      return;
    }

    try {
      await clearAllCachedPages();
      const stats = await getCacheSizeEstimates();
      setCacheStats(stats);
      setMessage('All cached pages removed');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to clear pages');
    }
  };

  const handleClearAllCovers = async () => {
    if (!confirm('Are you sure you want to clear all cached covers?')) {
      return;
    }

    try {
      await clearAllCachedCovers();
      const stats = await getCacheSizeEstimates();
      setCacheStats(stats);
      setMessage('All cached covers removed');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to clear covers');
    }
  };

  const handleClearEverything = async () => {
    if (!confirm('Are you sure you want to clear ALL cached data? This includes books, covers, and pages.')) {
      return;
    }

    try {
      await clearAllCachedBooks();
      setCachedBooks([]);
      setCachedPageCounts(new Map());
      const stats = await getCacheSizeEstimates();
      setCacheStats(stats);
      setMessage('All cached data removed');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to clear all cache');
    }
  };

  return (
    <div className="settings-page">
      <div className="settings-header">
        <button className="back-button" onClick={() => navigate('/')}>
          ← Back
        </button>
        <h1>Settings</h1>
      </div>

      {message && (
        <div className={`settings-message ${message.includes('success') ? 'success' : 'error'}`}>
          {message}
        </div>
      )}

      <form onSubmit={handleSubmit} className="settings-form">
        <div className="form-group">
          <label htmlFor="serverUrl">Server URL</label>
          <input
            type="text"
            id="serverUrl"
            value={formData.serverUrl}
            onChange={(e) => setFormData({ ...formData, serverUrl: e.target.value })}
            placeholder="https://comics-reader.example.com or /"
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="token">Authentication Token</label>
          <input
            type="password"
            id="token"
            value={formData.token}
            onChange={(e) => setFormData({ ...formData, token: e.target.value })}
            placeholder="Optional authentication token"
          />
        </div>

        <div className="form-group checkbox-group">
          <label>
            <input
              type="checkbox"
              checked={formData.autoDownloadNewBooks}
              onChange={(e) => setFormData({ ...formData, autoDownloadNewBooks: e.target.checked })}
            />
            Auto-download new books for offline reading
          </label>
          <p className="form-help">
            Automatically download new books when on WiFi
          </p>
        </div>

        <div className="form-group checkbox-group">
          <label>
            <input
              type="checkbox"
              checked={formData.largeFullscreenProgressBar}
              onChange={(e) => setFormData({ ...formData, largeFullscreenProgressBar: e.target.checked })}
            />
            Large progress bar in fullscreen
          </label>
          <p className="form-help">
            Increases progress bar size in fullscreen mode to prevent status bar from covering content (useful on iPad)
          </p>
        </div>

        <button type="submit" className="save-button" disabled={isSaving}>
          {isSaving ? 'Saving...' : 'Save Settings'}
        </button>
      </form>

      <section className="settings-section">
        <h2>Server Actions</h2>
        <button
          onClick={handleReindex}
          disabled={isReindexing || !online}
          className="action-button"
        >
          {isReindexing ? 'Triggering...' : 'Trigger Rescan'}
        </button>
        {!online && <p className="form-help">Rescan not available while offline</p>}
      </section>

      <section className="settings-section version-info">
        <p className="form-help">
          Client: {clientVersion}
          {serverVersion && ` • Server: ${serverVersion}`}
        </p>
      </section>

      <section className="settings-section">
        <h2>Cache Management</h2>
        {cacheStats && (
          <div className="cache-stats">
            <p className="form-help">
              Books: {cacheStats.books} • Covers: {cacheStats.covers} • Pages: {cacheStats.pages}
              {cacheStats.totalSizeBytes !== undefined && ` • Total: ${formatFileSize(cacheStats.totalSizeBytes)}`}
            </p>
          </div>
        )}
        <div className="cache-actions">
          <button onClick={handleClearAllPages} className="action-button">
            Clear All Pages
          </button>
          <button onClick={handleClearAllCovers} className="action-button">
            Clear All Covers
          </button>
          <button onClick={handleClearEverything} className="action-button danger">
            Clear Everything
          </button>
        </div>
        <p className="form-help">
          Clear Pages: Removes cached page images but keeps book info and covers<br />
          Clear Covers: Removes cached cover images<br />
          Clear Everything: Removes all cached data (books, covers, and pages)
        </p>
      </section>

      <section className="settings-section">
        <h2>Cached Books ({cachedBooks.length})</h2>
        {cachedBooks.length > 0 ? (
          <>
            <button onClick={handleClearAllCache} className="action-button danger">
              Clear All Cache
            </button>
            <ul className="cached-books-list">
              {cachedBooks.map(({ path, book, fullyDownloaded }) => {
                const cachedPages = cachedPageCounts.get(path) || 0;
                return (
                  <li key={path} className="cached-book-item">
                    <div className="cached-book-info">
                      <span className="cached-book-title">{book.title}</span>
                      <span className="cached-book-meta">
                        {formatFileSize(book.fileSize)} • {book.pageCount} pages
                        {fullyDownloaded ? ' • ✓ Complete' : ` • ${cachedPages}/${book.pageCount} cached`}
                      </span>
                    </div>
                    <button
                      onClick={() => handleRemoveFromCache(path)}
                      className="remove-cache-button"
                    >
                      Remove
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <p className="form-help">No books cached for offline reading</p>
        )}
      </section>
    </div>
  );
}
