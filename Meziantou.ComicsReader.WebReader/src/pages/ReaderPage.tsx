import { useState, useEffect, useCallback, useRef, type FormEvent } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
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
import type { BookResponse, ReaderLocationState } from '../types';
import './ReaderPage.css';

const iconPaths = {
  first: 'M6 5v14M18 5l-9 7 9 7z',
  previous: 'M16 5l-9 7 9 7z',
  next: 'M8 5l9 7-9 7z',
  last: 'M18 5v14M6 5l9 7-9 7z',
  fullscreen: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  more: 'M4 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0M11 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0M18 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
};

function Icon({ name }: { name: keyof typeof iconPaths }) {
  return (
    <svg className="reader-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={iconPaths[name]} />
    </svg>
  );
}

export function ReaderPage() {
  const { path } = useParams<{ path: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { apiClient, books, isLoading: isAppLoading, error: appError, refreshData, removeFromReadingList: removeBookFromReadingList, settings } = useApp();

  const [book, setBook] = useState<BookResponse | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [pageUrl, setPageUrl] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(() => !!document.fullscreenElement || !!(location.state as ReaderLocationState | null)?.fullscreen);
  const [isLoading, setIsLoading] = useState(true);
  const [showLoading, setShowLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [pageInput, setPageInput] = useState('1');
  const [cacheStatus, setCacheStatus] = useState<{
    isCached: boolean;
    isFullyDownloaded: boolean;
    cachedPages: number;
    totalPages: number;
  } | null>(null);

  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const previousPageUrl = useRef<string | null>(null);
  const hasRestoredState = useRef(false);
  const useNativeFullscreenRef = useRef(settings.useNativeFullscreen);

  useEffect(() => {
    useNativeFullscreenRef.current = settings.useNativeFullscreen;
  }, [settings.useNativeFullscreen]);

  const { containerRef: zoomContainerRef, scale, translateX, translateY, resetZoom, isZoomed, isInteracting } = usePinchZoom();

  // Restore state after PWA update
  useEffect(() => {
    if (hasRestoredState.current) return;

    const savedState = restoreStateAfterUpdate();
    if (savedState?.isFullscreen && containerRef.current) {
      hasRestoredState.current = true;

      if (!useNativeFullscreenRef.current) {
        setIsFullscreen(true);
        return;
      }

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

  // Keep the page number input in sync with the displayed page
  useEffect(() => {
    if (bookPageCount === undefined) return;

    setPageInput(String(Math.min(currentPage, bookPageCount - 1) + 1));
  }, [currentPage, bookPageCount]);

  const commitPageInput = useCallback(() => {
    if (bookPageCount === undefined) return;

    const displayedPage = Math.min(currentPage, bookPageCount - 1) + 1;
    const parsedPage = Number.parseInt(pageInput, 10);
    if (Number.isNaN(parsedPage)) {
      setPageInput(String(displayedPage));
      return;
    }

    const targetPage = Math.max(0, Math.min(parsedPage - 1, bookPageCount - 1));
    setPageInput(String(targetPage + 1));
    goToPage(targetPage);
  }, [bookPageCount, currentPage, pageInput, goToPage]);

  const handlePageInputSubmit = useCallback((e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    commitPageInput();
  }, [commitPageInput]);

  const exitNativeFullscreen = useCallback(() => {
    // Always leave native fullscreen, even if the setting was disabled while it was active
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {
        // Ignore failures (for example when the document already left fullscreen)
      });
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (isFullscreen) {
      exitNativeFullscreen();
    } else if (settings.useNativeFullscreen) {
      containerRef.current?.requestFullscreen?.().catch(() => {
        // Ignore failures and fall back to the in-app fullscreen (for example on iPhone)
      });
    }
    setIsFullscreen(!isFullscreen);
  }, [isFullscreen, exitNativeFullscreen, settings.useNativeFullscreen]);

  const exitFullscreen = useCallback(() => {
    if (isFullscreen) {
      exitNativeFullscreen();
      setIsFullscreen(false);
    }
  }, [isFullscreen, exitNativeFullscreen]);

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
      await removeBookFromReadingList(book.path);
      navigate('/');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setError(`Failed to remove from reading list: ${errMsg}`);
    }
  }, [book, apiClient, removeBookFromReadingList, navigate]);

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
    onSwipeUp: toggleFullscreen,
    onSwipeDown: toggleFullscreen,
  });

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't hijack keys while the user is typing in a field (e.g. the page number input)
      const target = e.target;
      if (target instanceof Element && target.closest('input, textarea, [contenteditable="true"]')) return;

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

  // Close the actions menu when clicking outside of it or pressing Escape
  useEffect(() => {
    if (!isMenuOpen) return;

    const handlePointerDown = (e: PointerEvent) => {
      if (e.target instanceof Node && menuRef.current?.contains(e.target)) return;
      setIsMenuOpen(false);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMenuOpen]);

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
        <div className="reader-loading" role={isAppLoading ? undefined : 'alert'}>
          <span>{isAppLoading ? 'Loading...' : (appError ?? error ?? 'Book not found')}</span>
          {!isAppLoading && (
            <button className="back-button" onClick={() => navigate('/')}>
              ← Back to library
            </button>
          )}
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
          <button className="reader-first-page" onClick={() => goToPage(0)} disabled={currentPage === 0} aria-label="First page" title="First page">
            <Icon name="first" />
          </button>
          <button onClick={goToPreviousPage} disabled={currentPage === 0} aria-label="Previous page" title="Previous page">
            <Icon name="previous" />
          </button>
          <form className="page-info" onSubmit={handlePageInputSubmit}>
            <input
              type="number"
              inputMode="numeric"
              className="page-input"
              min={1}
              max={book.pageCount}
              value={pageInput}
              aria-label="Page number"
              onChange={e => setPageInput(e.target.value)}
              onFocus={e => e.target.select()}
              onBlur={commitPageInput}
            />
            <span className="page-count">/ {book.pageCount}</span>
          </form>
          <button onClick={goToNextPage} disabled={isAtEnd} aria-label="Next page" title="Next page">
            <Icon name="next" />
          </button>
          <button className="reader-last-page" onClick={() => goToPage(book.pageCount - 1)} disabled={currentPage === book.pageCount - 1} aria-label="Last page" title="Last page">
            <Icon name="last" />
          </button>
          <span className="reader-controls-separator" aria-hidden="true" />
          <button onClick={toggleFullscreen} aria-label="Fullscreen" title="Fullscreen">
            <Icon name="fullscreen" />
          </button>
          {isOnline() && !cacheStatus?.isFullyDownloaded && (
            <button onClick={downloadBook} disabled={isDownloading} aria-label="Download" title="Download">
              {isDownloading ? `${downloadProgress.toFixed(0)}%` : <Icon name="download" />}
            </button>
          )}
          <div className="reader-menu" ref={menuRef}>
            <button
              onClick={() => setIsMenuOpen(open => !open)}
              aria-label="More actions"
              title="More actions"
              aria-haspopup="menu"
              aria-expanded={isMenuOpen}
            >
              <Icon name="more" />
            </button>
            {isMenuOpen && (
              <div className="reader-menu-items" role="menu">
                <button role="menuitem" onClick={() => { setIsMenuOpen(false); removeFromReadingList(); }}>
                  Remove from list
                </button>
                {cacheStatus?.isCached && (
                  <button role="menuitem" onClick={() => { setIsMenuOpen(false); removeFromCache(); }}>
                    Remove from cache
                  </button>
                )}
              </div>
            )}
          </div>
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
