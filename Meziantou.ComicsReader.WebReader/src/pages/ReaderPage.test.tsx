import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ReaderPage } from './ReaderPage';
import type { AppSettings, BookResponse } from '../types';

const book: BookResponse = {
  path: 'comics/book.cbz',
  title: 'Test Book',
  pageCount: 10,
  fileSize: 1024,
  coverImageFileName: null,
  directory: null,
  firstDirectory: null,
  currentPage: 0,
  isCompleted: false,
  lastRead: null,
};

const settings: AppSettings = {
  serverUrl: 'https://example.com',
  token: 'token',
  autoDownloadNewBooks: false,
  largeFullscreenProgressBar: false,
};

vi.mock('../context', () => ({
  useApp: () => ({
    apiClient: {},
    books: [book],
    refreshData: vi.fn(),
    updateReadingList: vi.fn(),
    settings,
  }),
}));

vi.mock('../hooks', () => ({
  usePinchZoom: () => ({
    containerRef: { current: null },
    scale: 1,
    translateX: 0,
    translateY: 0,
    resetZoom: vi.fn(),
    isZoomed: false,
    isInteracting: false,
  }),
  useSwipe: () => ({
    handleTouchStart: vi.fn(),
    handleTouchMove: vi.fn(),
    handleTouchEnd: vi.fn(),
  }),
}));

vi.mock('../hooks/usePWAUpdate', () => ({
  restoreStateAfterUpdate: () => null,
}));

vi.mock('../services', () => ({
  getPageWithCache: vi.fn(() => Promise.resolve('blob:page')),
  updateReadingProgress: vi.fn(() => Promise.resolve()),
  downloadBookForOffline: vi.fn(() => Promise.resolve()),
  getBookCacheStatus: vi.fn(() => Promise.resolve({
    isCached: false,
    isFullyDownloaded: false,
    cachedPages: 0,
    totalPages: book.pageCount,
  })),
  isOnline: () => true,
  isOnMeteredConnection: () => false,
}));

vi.mock('../services/storage', () => ({
  removeCachedBook: vi.fn(() => Promise.resolve()),
}));

function renderReader() {
  return render(
    <MemoryRouter initialEntries={[`/read/${encodeURIComponent(book.path)}`]}>
      <Routes>
        <Route path="/read/:path" element={<ReaderPage />} />
      </Routes>
    </MemoryRouter>
  );
}

async function getPageInput() {
  const input = await screen.findByLabelText<HTMLInputElement>('Page number');
  return input;
}

function submitPage(input: HTMLInputElement, value: string) {
  fireEvent.change(input, { target: { value } });
  fireEvent.submit(input.form!);
}

describe('ReaderPage page number navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('should display the current page number in the input', async () => {
    renderReader();

    const input = await getPageInput();
    expect(input).toHaveValue(1);
    expect(screen.getByText('/ 10')).toBeInTheDocument();
  });

  it('should navigate to the page entered by the user', async () => {
    renderReader();

    const input = await getPageInput();
    submitPage(input, '5');

    expect(await screen.findByAltText('Page 5')).toBeInTheDocument();
    expect(input).toHaveValue(5);
  });

  it('should navigate when the input loses focus', async () => {
    renderReader();

    const input = await getPageInput();
    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.blur(input);

    expect(await screen.findByAltText('Page 3')).toBeInTheDocument();
  });

  it('should clamp a page number greater than the page count to the last page', async () => {
    renderReader();

    const input = await getPageInput();
    submitPage(input, '999');

    expect(await screen.findByAltText('Page 10')).toBeInTheDocument();
    expect(input).toHaveValue(10);
  });

  it('should clamp a page number lower than one to the first page', async () => {
    renderReader();

    const input = await getPageInput();
    submitPage(input, '5');
    expect(await screen.findByAltText('Page 5')).toBeInTheDocument();

    submitPage(input, '0');

    expect(await screen.findByAltText('Page 1')).toBeInTheDocument();
    expect(input).toHaveValue(1);
  });

  it('should restore the current page when the input is not a number', async () => {
    renderReader();

    const input = await getPageInput();
    submitPage(input, '5');
    expect(await screen.findByAltText('Page 5')).toBeInTheDocument();

    submitPage(input, '');

    await waitFor(() => expect(input).toHaveValue(5));
    expect(screen.getByAltText('Page 5')).toBeInTheDocument();
  });

  it('should not change page when using arrow keys inside the page input', async () => {
    renderReader();

    const input = await getPageInput();
    submitPage(input, '5');
    expect(await screen.findByAltText('Page 5')).toBeInTheDocument();

    input.focus();
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    fireEvent.keyDown(input, { key: 'ArrowLeft' });

    expect(screen.getByAltText('Page 5')).toBeInTheDocument();
  });

  it('should still navigate with arrow keys outside the page input', async () => {
    renderReader();

    await getPageInput();
    expect(await screen.findByAltText('Page 1')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'ArrowRight' });

    expect(await screen.findByAltText('Page 2')).toBeInTheDocument();
  });
});
