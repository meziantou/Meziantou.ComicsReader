import type {
  BooksResponse,
  BookResponse,
  PagesResponse,
  ReadingListResponse,
  ReadingListItemResponse,
  IndexingStatusResponse,
  UpdateReadingProgressRequest,
  VersionResponse,
} from '../types';

export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
export const DEFAULT_IMAGE_REQUEST_TIMEOUT_MS = 60_000;

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// Thrown when the server cannot be reached (network failure or timeout)
export class ApiNetworkError extends Error {
  isTimeout: boolean;

  constructor(message: string, isTimeout: boolean, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ApiNetworkError';
    this.isTimeout = isTimeout;
  }
}

export interface ApiClientOptions {
  requestTimeoutMs?: number;
  imageRequestTimeoutMs?: number;
}

function getHttpErrorMessage(response: Response): string {
  const status = `${response.status} ${response.statusText ?? ''}`.trim();
  switch (response.status) {
    case 401:
    case 403:
      return `Authentication failed (${status}). Check the access token in Settings.`;
    default:
      return `Server error (${status})`;
  }
}

export class ApiClient {
  private baseUrl: string;
  private token: string | null;
  private requestTimeoutMs: number;
  private imageRequestTimeoutMs: number;

  constructor(baseUrl: string, token: string | null = null, options: ApiClientOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.imageRequestTimeoutMs = options.imageRequestTimeoutMs ?? DEFAULT_IMAGE_REQUEST_TIMEOUT_MS;
  }

  private getServerDisplayName(): string {
    return this.baseUrl || window.location.origin;
  }

  // Send a request and read its body, aborting if the whole operation exceeds the timeout
  private async send<T>(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    readBody: (response: Response) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (!response.ok) {
        throw new ApiError(response.status, getHttpErrorMessage(response));
      }

      return await readBody(response);
    } catch (error) {
      if (timedOut) {
        throw new ApiNetworkError(
          `The server ${this.getServerDisplayName()} did not respond within ${Math.round(timeoutMs / 1000)} seconds.`,
          true,
          { cause: error },
        );
      }

      // fetch rejects with a TypeError when the server is unreachable
      if (error instanceof TypeError) {
        throw new ApiNetworkError(`Unable to reach the server ${this.getServerDisplayName()}.`, false, { cause: error });
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}/api/v1${path}`;
    const headers = new Headers(options.headers);
    headers.set('Content-Type', 'application/json');

    if (this.token) {
      headers.set('Authorization', `Bearer ${this.token}`);
    }

    const text = await this.send(url, { ...options, headers }, this.requestTimeoutMs, response => response.text());

    // Handle empty responses
    if (!text) {
      return undefined as T;
    }

    return JSON.parse(text) as T;
  }

  private async fetchImage(url: string): Promise<Blob> {
    const headers = new Headers();

    if (this.token) {
      headers.set('Authorization', `Bearer ${this.token}`);
    }

    return this.send(url, { headers }, this.imageRequestTimeoutMs, response => response.blob());
  }

  // Books
  async getBooks(search?: string, filter?: string): Promise<BooksResponse> {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (filter) params.set('filter', filter);
    const queryString = params.toString();
    return this.fetch<BooksResponse>(`/books${queryString ? `?${queryString}` : ''}`);
  }

  async getBookInfo(path: string): Promise<BookResponse> {
    return this.fetch<BookResponse>(`/books/${encodeURIComponent(path)}/info`);
  }

  async getBookPages(path: string): Promise<PagesResponse> {
    return this.fetch<PagesResponse>(`/books/${encodeURIComponent(path)}/pages`);
  }

  getPageUrl(path: string, pageIndex: number): string {
    const url = `${this.baseUrl}/api/v1/books/${encodeURIComponent(path)}/pages/${pageIndex}`;
    if (this.token) {
      return `${url}?token=${encodeURIComponent(this.token)}`;
    }
    return url;
  }

  async getPage(path: string, pageIndex: number): Promise<Blob> {
    return this.fetchImage(`${this.baseUrl}/api/v1/books/${encodeURIComponent(path)}/pages/${pageIndex}`);
  }

  getCoverUrl(path: string): string {
    const url = `${this.baseUrl}/api/v1/books/${encodeURIComponent(path)}/cover`;
    if (this.token) {
      return `${url}?token=${encodeURIComponent(this.token)}`;
    }
    return url;
  }

  async getCover(path: string): Promise<Blob> {
    return this.fetchImage(`${this.baseUrl}/api/v1/books/${encodeURIComponent(path)}/cover`);
  }

  async markAsRead(path: string): Promise<void> {
    await this.fetch<void>(`/books/${encodeURIComponent(path)}/mark-as-read`, {
      method: 'POST',
    });
  }

  // Reading progress
  async getReadingList(includeCompleted: boolean = false): Promise<ReadingListResponse> {
    return this.fetch<ReadingListResponse>(`/reading-list?includeCompleted=${includeCompleted}`);
  }

  async getReadingListItem(path: string): Promise<ReadingListItemResponse | null> {
    try {
      return await this.fetch<ReadingListItemResponse>(`/reading-list/${encodeURIComponent(path)}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async updateReadingProgress(path: string, pageIndex: number): Promise<ReadingListResponse> {
    const request: UpdateReadingProgressRequest = { pageIndex };
    return this.fetch<ReadingListResponse>(`/reading-list/${encodeURIComponent(path)}`, {
      method: 'PUT',
      body: JSON.stringify(request),
    });
  }

  async removeFromReadingList(path: string): Promise<ReadingListResponse> {
    return this.fetch<ReadingListResponse>(`/reading-list/${encodeURIComponent(path)}`, {
      method: 'DELETE',
    });
  }

  // Indexing
  async getIndexingStatus(): Promise<IndexingStatusResponse> {
    return this.fetch<IndexingStatusResponse>('/indexing/status');
  }

  async triggerReindex(): Promise<void> {
    await this.fetch<void>('/indexing/reindex', {
      method: 'POST',
    });
  }

  // Version
  async getVersion(): Promise<VersionResponse> {
    return this.fetch<VersionResponse>('/version');
  }
}

// Singleton instance that gets updated when settings change
let apiClientInstance: ApiClient | null = null;

export function getApiClient(serverUrl: string, token: string | null): ApiClient {
  apiClientInstance = new ApiClient(serverUrl, token);
  return apiClientInstance;
}

export function getCurrentApiClient(): ApiClient | null {
  return apiClientInstance;
}
