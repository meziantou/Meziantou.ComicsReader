import { useState, useMemo } from 'react';
import { useApp } from '../context';
import { usePullToRefresh } from '../hooks';
import { containsInsensitive } from '../utils';
import {
  BookCollection,
  FilterChips,
  SearchBar,
  PullToRefreshIndicator,
} from '../components';
import type { FilterType } from '../types';
import './HomePage.css';

export function HomePage() {
  const { books, readingList, nextToRead, isLoading, error, refreshData, online } = useApp();

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');

  const { containerRef, pullDistance, isRefreshing, handlers } = usePullToRefresh({
    onRefresh: refreshData,
  });

  // Reading list (in progress books, sorted by last read)
  const inProgressBooks = useMemo(() => {
    const bookPaths = new Set(books.map(b => b.path));
    const inProgress = readingList
      .filter(item => !item.completed && item.book && bookPaths.has(item.book.path))
      .sort((a, b) => new Date(b.lastRead).getTime() - new Date(a.lastRead).getTime())
      .map(item => item.book!);

    return inProgress;
  }, [readingList, books]);

  // Apply filters and search to catalog
  const filteredBooks = useMemo(() => {
    // Don't copy array, just filter and sort
    let result = books;

    // Apply filter
    if (filter === 'one-shot') {
      result = result.filter(book => !book.directory);
    } else if (filter === 'series') {
      result = result.filter(book => book.directory);
    }

    // Apply search
    if (search.trim()) {
      result = result.filter(
        book =>
          containsInsensitive(book.title, search) ||
          containsInsensitive(book.path, search)
      );
    }

    // Sort returns a new array, so we don't need to copy
    return result.slice().sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  }, [books, filter, search]);

  if (isLoading && books.length === 0) {
    return (
      <div className="home-page">
        <div className="loading">Loading...</div>
      </div>
    );
  }

  return (
    <div
      className="home-page"
      ref={containerRef}
      {...handlers}
    >
      <PullToRefreshIndicator
        pullDistance={pullDistance}
        isRefreshing={isRefreshing}
      />

      {!online && (
        <div className="offline-banner">
          You are offline. Some features may be limited.
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      {inProgressBooks.length > 0 && (
        <section className="section">
          <h2>Reading List</h2>
          <BookCollection books={inProgressBooks} />
        </section>
      )}

      {nextToRead.length > 0 && (
        <section className="section">
          <h2>Up Next</h2>
          <BookCollection books={nextToRead} showProgress={false} />
        </section>
      )}

      <section className="section">
        <h2>Catalog ({filteredBooks.length})</h2>
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Search books..."
        />
        <FilterChips currentFilter={filter} onFilterChange={setFilter} />
        <BookCollection books={filteredBooks} showProgress={false} />
      </section>
    </div>
  );
}
