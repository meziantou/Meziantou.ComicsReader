import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '../context';
import { usePinchZoom, useSwipe } from '../hooks';
import { restoreStateAfterUpdate } from '../hooks/usePWAUpdate';
import {
  getPageWithCache,
  updateReadingProgress,
  downloadBookForOffline,
  getBookCacheStatus,
  isOnline,
  isOnMeteredConnection,
} from '../services';
import { removeCachedBook } from '../services/storage';
import type { BookResponse } from '../types';
import './ReaderPage.css';

export function ReaderPage() {
  const { path } = useParams<{ path: string }>();
  const navigate = useNavigate();
  const { apiClient, books, refreshData, updateReadingList, settings } = useApp();

  const [book, setBook] = useState<BookResponse | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [pageUrl, setPageUrl] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showLoading, setShowLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [cacheStatus, setCacheStatus] = useState<{
    isCached: boolean;
    isFullyDownloaded: boolean;
    cachedPages: number;
    totalPages: number;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const previousPageUrl = useRef<string | null>(null);
  const hasRestoredState = useRef(false);

  const { containerRef: zoomContainerRef, scale, translateX, translateY, resetZoom, isZoomed, isInteracting } = usePinchZoom();

  // Restore state after PWA update
  useEffect(() => {
    if (hasRestoredState.current) return;

    const savedState = restoreStateAfterUpdate();
    if (savedState?.isFullscreen && containerRef.current) {
      hasRestoredState.current = true;

      // Request fullscreen after a short delay to ensure the page is fully loaded
      setTimeout(() => {
        containerRef.current?.requestFullscreen().then(() => {
          setIsFullscreen(true);
        }).catch(err => {
          console.warn('Could not restore fullscreen:', err);
        });
      }, 100);
    }
  }, []);

  // Find book from state
  useEffect(() => {
    if (!path) {
      navigate('/');
      return;
    }

    const decodedPath = decodeURIComponent(path);
    const foundBook = books.find(b => b.path === decodedPath);

    if (foundBook) {
      // Only update if book is not set yet or if meaningful properties changed
      setBook(prevBook => {
        if (!prevBook ||
            prevBook.path !== foundBook.path ||
            prevBook.pageCount !== foundBook.pageCount) {
          // Start from saved progress or page 0
          const startPage = foundBook.currentPage ?? 0;
          setCurrentPage(Math.min(startPage, foundBook.pageCount - 1));
          return foundBook;
        }
        // Update book progress properties only if they changed meaningfully
        // Don't return a new object if only lastRead timestamp changed to prevent flickering
        const progressChanged = prevBook.currentPage !== foundBook.currentPage ||
                                prevBook.isCompleted !== foundBook.isCompleted;

        if (progressChanged) {
          return foundBook;
        }

        // Keep the previous book object to avoid triggering dependent effects
        return prevBook;
      });
    } else if (books.length > 0) {
      // Book not found and we have books loaded
      setError('Book not found');
    }
  }, [path, books, navigate]);

  // Delayed loading indicator
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    if (isLoading) {
      // Show loading indicator after 750ms
      timeoutId = setTimeout(() => {
        setShowLoading(true);
      }, 750);
    } else {
      // Hide loading indicator immediately when loading completes
      setShowLoading(false);
    }

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [isLoading]);

  // Extract book properties to avoid reloading when book object reference changes
  const bookPath = book?.path;
  const bookPageCount = book?.pageCount;

  // Update cache status
  useEffect(() => {
    if (!bookPath || bookPageCount === undefined) return;

    const updateStatus = async () => {
      const status = await getBookCacheStatus(bookPath, bookPageCount);
      setCacheStatus(status);
    };

    updateStatus();
  }, [bookPath, bookPageCount]);

  // Load current page
  useEffect(() => {
    if (!bookPath || bookPageCount === undefined) return;

    // Don't load page if we're at the completion screen
    if (currentPage >= bookPageCount) {
      setIsLoading(false);
      setPageUrl(null);
      return;
    }

    let cancelled = false;

    const loadPage = async () => {
      setIsLoading(true);
      setError(null);

      // Revoke previous URL
      if (previousPageUrl.current) {
        URL.revokeObjectURL(previousPageUrl.current);
        previousPageUrl.current = null;
      }

      try {
        const url = await getPageWithCache(apiClient, bookPath, currentPage, settings.autoDownloadNewBooks);
        if (!cancelled) {
          setPageUrl(url);
          previousPageUrl.current = url;

          // Update cache status after loading page (pages may be auto-cached)
          const status = await getBookCacheStatus(bookPath, bookPageCount);
          setCacheStatus(status);
        }
      } catch (err) {
        if (!cancelled) {
          const errMsg = err instanceof Error ? err.message : String(err);
          setError(`Failed to load page: ${errMsg}`);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadPage();

    return () => {
      cancelled = true;
    };
  }, [bookPath, bookPageCount, currentPage, apiClient, settings.autoDownloadNewBooks]);

  // Save progress when page changes
  useEffect(() => {
    if (!bookPath || bookPageCount === undefined) return;

    updateReadingProgress(apiClient, bookPath, currentPage, bookPageCount);
  }, [bookPath, bookPageCount, currentPage, apiClient]);

  // Preload next pages
  useEffect(() => {
    if (!bookPath || bookPageCount === undefined || !apiClient) return;

    const preloadPages = async () => {
      for (let i = 1; i <= 3; i++) {
        const nextPage = currentPage + i;
        if (nextPage < bookPageCount) {
          try {
            await getPageWithCache(apiClient, bookPath, nextPage, settings.autoDownloadNewBooks);
          } catch {
            // Ignore preload errors
          }
        }
      }
    };

    preloadPages();
  }, [bookPath, bookPageCount, currentPage, apiClient, settings.autoDownloadNewBooks]);

  const goToPage = useCallback((page: number) => {
    if (!book) return;

    const newPage = Math.max(0, Math.min(page, book.pageCount));
    setCurrentPage(newPage);
    resetZoom();
  }, [book, resetZoom]);

  const goToPreviousPage = useCallback(() => {
    goToPage(currentPage - 1);
  }, [currentPage, goToPage]);

  const goToNextPage = useCallback(() => {
    goToPage(currentPage + 1);
  }, [currentPage, goToPage]);

  const toggleFullscreen = useCallback(() => {
    if (isFullscreen) {
      document.exitFullscreen?.();
    } else {
      containerRef.current?.requestFullscreen?.();
    }
    setIsFullscreen(!isFullscreen);
  }, [isFullscreen]);

  const exitFullscreen = useCallback(() => {
    if (isFullscreen) {
      document.exitFullscreen?.();
      setIsFullscreen(false);
    }
  }, [isFullscreen]);

  const markAsCompleted = useCallback(async () => {
    if (!book || !apiClient) return;

    try {
      await apiClient.markAsRead(book.path);
      await refreshData();
      navigate('/');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setError(`Failed to mark as completed: ${errMsg}`);
    }
  }, [book, apiClient, refreshData, navigate]);

  const removeFromReadingList = useCallback(async () => {
    if (!book || !apiClient) return;

    try {
      const readingListResponse = await apiClient.removeFromReadingList(book.path);
      updateReadingList(readingListResponse.items);
      navigate('/');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setError(`Failed to remove from reading list: ${errMsg}`);
    }
  }, [book, apiClient, updateReadingList, navigate]);

  const downloadBook = useCallback(async () => {
    if (!book || !apiClient) return;

    if (isOnMeteredConnection()) {
      setError('Cannot download on metered connection');
      return;
    }

    setIsDownloading(true);
    setDownloadProgress(0);

    try {
      await downloadBookForOffline(apiClient, book, (downloaded, total) => {
        setDownloadProgress((downloaded / total) * 100);
      });
      const status = await getBookCacheStatus(book.path, book.pageCount);
      setCacheStatus(status);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setError(`Failed to download book: ${errMsg}`);
    } finally {
      setIsDownloading(false);
    }
  }, [book, apiClient]);

  const removeFromCache = useCallback(async () => {
    if (!book) return;

    try {
      await removeCachedBook(book.path);
      const status = await getBookCacheStatus(book.path, book.pageCount);
      setCacheStatus(status);
      // Update the global cache info so the indicator is removed
      await refreshData();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setError(`Failed to remove from cache: ${errMsg}`);
    }
  }, [book, refreshData]);

  // Swipe handlers
  const { handleTouchStart, handleTouchMove, handleTouchEnd } = useSwipe({
    onSwipeLeft: () => {
      if (!isZoomed && !isInteracting) goToNextPage();
    },
    onSwipeRight: () => {
      if (!isZoomed && !isInteracting) goToPreviousPage();
    },
    onSwipeUp: exitFullscreen,
    onSwipeDown: exitFullscreen,
  });

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowRight':
        case 'PageDown':
          e.preventDefault();
          goToNextPage();
          break;
        case 'ArrowLeft':
        case 'PageUp':
          e.preventDefault();
          goToPreviousPage();
          break;
        case 'Escape':
          e.preventDefault();
          exitFullscreen();
          break;
        case 'f':
          e.preventDefault();
          toggleFullscreen();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goToNextPage, goToPreviousPage, exitFullscreen, toggleFullscreen]);

  // Fullscreen change listener
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Touch handlers for swipe - only enable when not zoomed and attach to outer container
  useEffect(() => {
    if (isZoomed || isInteracting) return;

    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: true });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd, isZoomed, isInteracting]);

  if (!book) {
    return (
      <div className="reader-page">
        <div className="reader-loading">
          {error || 'Loading...'}
        </div>
      </div>
    );
  }

  const isAtEnd = currentPage >= book.pageCount;
  const progressPercent = ((currentPage + 1) / book.pageCount) * 100;

  return (
    <div
      className={`reader-page ${isFullscreen ? 'fullscreen' : ''} ${settings.largeFullscreenProgressBar ? 'large-progress' : ''}`}
      ref={containerRef}
    >
      {!isFullscreen && (
        <div className="reader-header">
          <button className="back-button" onClick={() => navigate('/')}>
            ← Back
          </button>
          <h1 className="reader-title">{book.title}</h1>
        </div>
      )}

      {error && <div className="reader-error">{error}</div>}

      {!isFullscreen && (
        <div className="reader-controls">
          <button onClick={() => goToPage(0)} disabled={currentPage === 0}>
            First
          </button>
          <button onClick={goToPreviousPage} disabled={currentPage === 0}>
            Previous
          </button>
          <span className="page-info">
            {currentPage + 1} / {book.pageCount}
          </span>
          <button onClick={goToNextPage} disabled={isAtEnd}>
            Next
          </button>
          <button onClick={() => goToPage(book.pageCount - 1)} disabled={currentPage === book.pageCount - 1}>
            Last
          </button>
        </div>
      )}

      {!isFullscreen && (
        <div className="reader-actions">
          <button onClick={toggleFullscreen}>
            Fullscreen
          </button>
          <button onClick={removeFromReadingList}>
            Remove from list
          </button>
          {isOnline() && !cacheStatus?.isFullyDownloaded && (
            <button onClick={downloadBook} disabled={isDownloading}>
              {isDownloading ? `Downloading ${downloadProgress.toFixed(0)}%` : 'Download'}
            </button>
          )}
          {cacheStatus?.isCached && (
            <button onClick={removeFromCache}>
              Remove from cache
            </button>
          )}
        </div>
      )}

      <div className="reader-viewer">
        <div className="reading-progress-container">
          <div
            className="reading-progress"
            role="progressbar"
            aria-valuenow={currentPage + 1}
            aria-valuemin={1}
            aria-valuemax={book.pageCount}
            title={`${progressPercent.toFixed(0)}%`}
          >
            <div
              className="reading-progress-fill"
              style={{ width: `${progressPercent}%` }}
            />
            {settings.largeFullscreenProgressBar && isFullscreen && (
              <div className="reading-progress-text">
                {currentPage + 1} / {book.pageCount}
              </div>
            )}
          </div>
        </div>

        {isAtEnd ? (
          <div className="reader-completed">
            <button className="mark-completed-button" onClick={markAsCompleted}>
              Mark as completed
              <br />
              <span className="completed-title">{book.title}</span>
            </button>
          </div>
        ) : (
          <div
            className="page-container"
            ref={zoomContainerRef}
            onClick={isFullscreen ? goToNextPage : undefined}
          >
            {showLoading && <div className="page-loading">Loading page...</div>}
            {!isLoading && pageUrl && (
              <img
                src={pageUrl}
                alt={`Page ${currentPage + 1}`}
                className="page-image"
                draggable={false}
                onDoubleClick={!isFullscreen ? toggleFullscreen : undefined}
                style={{
                  transform: `scale(${scale}) translate(${translateX}px, ${translateY}px)`,
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
