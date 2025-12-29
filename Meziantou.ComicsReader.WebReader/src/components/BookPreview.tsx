import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../context';
import { getCoverWithCache } from '../services';
import type { BookResponse } from '../types';
import './BookPreview.css';

interface BookPreviewProps {
  book: BookResponse;
  showProgress?: boolean;
  eager?: boolean;
}

export function BookPreview({ book, showProgress = true, eager = false }: BookPreviewProps) {
  const { apiClient, cachedBooksInfo } = useApp();
  const [coverUrl, setCoverUrl] = useState<string | null>(null);

  const isCached = cachedBooksInfo.has(book.path);
  const isFullyDownloaded = cachedBooksInfo.get(book.path)?.fullyDownloaded ?? false;

  useEffect(() => {
    let cancelled = false;

    const loadCover = async () => {
      if (!book.coverImageFileName || !apiClient) return;
      
      const url = await getCoverWithCache(apiClient, book.path);
      if (!cancelled && url) {
        setCoverUrl(url);
      }
    };

    loadCover();

    return () => {
      cancelled = true;
      // Don't revoke the blob URL - it's managed by the cache
      // and might be shared by multiple components
    };
  }, [book.path, book.coverImageFileName, apiClient]);

  const progressPercent = book.currentPage !== null && book.currentPage !== undefined
    ? ((book.currentPage + 1) / book.pageCount) * 100
    : 0;

  return (
    <Link to={`/reader/${encodeURIComponent(book.path)}`} className="book-preview">
      <div className="book-cover-container">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={book.title}
            className="book-cover"
            loading={eager ? "eager" : "lazy"}
          />
        ) : (
          <div className="book-cover-placeholder">
            <span>📖</span>
          </div>
        )}
        {showProgress && book.currentPage !== null && book.currentPage !== undefined && (
          <div className="reading-progress-bar" style={{ width: `${progressPercent}%` }} />
        )}
        {isCached && (
          <div className={`cache-indicator ${isFullyDownloaded ? 'fully-cached' : 'partial-cached'}`}>
            {isFullyDownloaded ? '✓' : '◐'}
          </div>
        )}
      </div>
      <div className="book-info">
        {book.directory && (
          <span className="book-directory">{book.directory}/</span>
        )}
        <span className="book-title">{book.title}</span>
        {showProgress && book.currentPage !== null && book.currentPage !== undefined ? (
          <span className="book-progress">
            page {book.currentPage + 1} / {book.pageCount}
          </span>
        ) : (
          <span className="book-progress">{book.pageCount} pages</span>
        )}
      </div>
    </Link>
  );
}
