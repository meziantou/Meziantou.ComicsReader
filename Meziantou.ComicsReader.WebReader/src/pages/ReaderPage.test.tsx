import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ReaderPage } from './ReaderPage';
import type { AppSettings, BookResponse, ReaderLocationState } from '../types';

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
  useNativeFullscreen: false,
};

const appState = vi.hoisted(() => ({
  books: [] as BookResponse[],
  isLoading: false,
  error: null as string | null,
}));

// Keep references stable across renders so effects depending on them don't re-run
const stableApp = vi.hoisted(() => ({
  apiClient: {},
  refreshData: () => Promise.resolve(),
  updateReadingList: () => {},
}));

vi.mock('../context', () => ({
  useApp: () => ({
    apiClient: stableApp.apiClient,
    books: appState.books,
    isLoading: appState.isLoading,
    error: appState.error,
    refreshData: stableApp.refreshData,
    updateReadingList: stableApp.updateReadingList,
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

function renderReader(state?: ReaderLocationState) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: `/read/${encodeURIComponent(book.path)}`, state }]}>
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

describe('ReaderPage book loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appState.books = [];
    appState.isLoading = false;
    appState.error = null;
  });

  afterEach(() => {
    cleanup();
  });

  it('should show a loading message while the app is loading', () => {
    appState.isLoading = true;

    renderReader();

    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(screen.queryByText('← Back to library')).not.toBeInTheDocument();
  });

  it('should show the app error when the book cannot be loaded', () => {
    appState.error = 'Unable to reach the server https://example.com.';

    renderReader();

    expect(screen.getByRole('alert')).toHaveTextContent('Unable to reach the server https://example.com.');
    expect(screen.getByText('← Back to library')).toBeInTheDocument();
  });

  it('should show book not found when the app loaded without the book', () => {
    appState.books = [{ ...book, path: 'comics/other.cbz' }];

    renderReader();

    expect(screen.getByRole('alert')).toHaveTextContent('Book not found');
  });
});

describe('ReaderPage page number navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appState.books = [book];
    appState.isLoading = false;
    appState.error = null;
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

describe('ReaderPage fullscreen', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    appState.books = [book];
    appState.isLoading = false;
    appState.error = null;
    settings.useNativeFullscreen = false;
  });

  afterEach(() => {
    cleanup();
  });

  it('should use the in-app fullscreen when native fullscreen is disabled', async () => {
    const requestFullscreen = vi.spyOn(Element.prototype, 'requestFullscreen');
    const { container } = renderReader();

    fireEvent.click(await screen.findByRole('button', { name: 'Fullscreen' }));

    expect(requestFullscreen).not.toHaveBeenCalled();
    expect(container.querySelector('.reader-page')).toHaveClass('fullscreen');
    expect(screen.queryByLabelText('Page number')).not.toBeInTheDocument();
  });

  it('should use the native fullscreen when enabled', async () => {
    settings.useNativeFullscreen = true;
    const requestFullscreen = vi.spyOn(Element.prototype, 'requestFullscreen');
    const { container } = renderReader();

    fireEvent.click(await screen.findByRole('button', { name: 'Fullscreen' }));

    const readerPage = container.querySelector('.reader-page');
    expect(requestFullscreen).toHaveBeenCalledOnce();
    expect(requestFullscreen.mock.contexts[0]).toBe(readerPage);
    expect(readerPage).toHaveClass('fullscreen');
  });

  it('should fall back to the in-app fullscreen when native fullscreen fails', async () => {
    settings.useNativeFullscreen = true;
    vi.spyOn(Element.prototype, 'requestFullscreen').mockRejectedValue(new Error('Not supported'));
    const { container } = renderReader();

    fireEvent.click(await screen.findByRole('button', { name: 'Fullscreen' }));

    await waitFor(() => expect(container.querySelector('.reader-page')).toHaveClass('fullscreen'));
  });

  it('should leave the in-app fullscreen with the Escape key', async () => {
    const exitFullscreen = vi.spyOn(document, 'exitFullscreen');
    const { container } = renderReader();

    fireEvent.click(await screen.findByRole('button', { name: 'Fullscreen' }));
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(exitFullscreen).not.toHaveBeenCalled();
    expect(container.querySelector('.reader-page')).not.toHaveClass('fullscreen');
    expect(screen.getByRole('button', { name: 'Fullscreen' })).toBeInTheDocument();
  });

  it('should open in fullscreen when requested by the navigation state', async () => {
    const { container } = renderReader({ fullscreen: true });

    expect(await screen.findByAltText('Page 1')).toBeInTheDocument();
    expect(container.querySelector('.reader-page')).toHaveClass('fullscreen');
  });
});
