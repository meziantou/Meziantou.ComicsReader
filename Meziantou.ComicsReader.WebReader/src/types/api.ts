// API Response DTOs - matching the server's ApiModels.cs

export interface BooksResponse {
  totalCount: number;
  books: BookResponse[];
}

export interface BookResponse {
  path: string;
  title: string;
  pageCount: number;
  fileSize: number;
  coverImageFileName: string | null;
  directory: string | null;
  firstDirectory: string | null;
  currentPage: number | null;
  isCompleted: boolean;
  lastRead: string | null;
}

export interface PagesResponse {
  totalCount: number;
  pages: PageInfo[];
}

export interface PageInfo {
  index: number;
  fileName: string;
}

export interface ReadingListResponse {
  totalCount: number;
  items: ReadingListItemResponse[];
}

export interface ReadingListItemResponse {
  bookPath: string;
  pageIndex: number;
  completed: boolean;
  lastRead: string;
  book: BookResponse | null;
}

export interface ReadingHistoryResponse {
  totalCount: number;
  items: ReadingHistoryItemResponse[];
}

export interface ReadingHistoryItemResponse {
  bookPath: string;
  completedAt: string;
  bookTitle: string | null;
}

export interface IndexingStatusResponse {
  lastIndexationDate: string;
  isInProgress: boolean;
  firstIndexationCompleted: boolean;
  errorCount: number;
  errors: IndexingErrorResponse[];
}

export interface IndexingErrorResponse {
  path: string;
  message: string;
}

export interface VersionResponse {
  version: string;
}

// Request DTOs
export interface UpdateReadingProgressRequest {
  pageIndex: number;
}

// App-specific types
export interface CachedBook {
  path: string;
  book: BookResponse;
  coverBlob: Blob | null;
  pages: Map<number, Blob>;
  cachedAt: string;
  fullyDownloaded: boolean;
}

export interface PendingProgressUpdate {
  id: string;
  bookPath: string;
  pageIndex: number;
  timestamp: string;
}

export interface AppSettings {
  serverUrl: string;
  token: string;
  autoDownloadNewBooks: boolean;
  largeFullscreenProgressBar: boolean;
}

export type FilterType = 'all' | 'one-shot' | 'series';
