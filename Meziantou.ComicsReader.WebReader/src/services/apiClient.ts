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

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export class ApiClient {
  private baseUrl: string;
  private token: string | null;

  constructor(baseUrl: string, token: string | null = null) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token;
  }

  private async fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}/api/v1${path}`;
    const headers = new Headers(options.headers);
    headers.set('Content-Type', 'application/json');

    if (this.token) {
      headers.set('Authorization', `Bearer ${this.token}`);
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      throw new ApiError(response.status, `API error: ${response.statusText}`);
    }

    // Handle empty responses
    const text = await response.text();
    if (!text) {
      return undefined as T;
    }

    return JSON.parse(text) as T;
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
    const url = `${this.baseUrl}/api/v1/books/${encodeURIComponent(path)}/pages/${pageIndex}`;
    const headers = new Headers();

    if (this.token) {
      headers.set('Authorization', `Bearer ${this.token}`);
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new ApiError(response.status, `Failed to get page: ${response.statusText}`);
    }
    return response.blob();
  }

  getCoverUrl(path: string): string {
    const url = `${this.baseUrl}/api/v1/books/${encodeURIComponent(path)}/cover`;
    if (this.token) {
      return `${url}?token=${encodeURIComponent(this.token)}`;
    }
    return url;
  }

  async getCover(path: string): Promise<Blob> {
    const url = `${this.baseUrl}/api/v1/books/${encodeURIComponent(path)}/cover`;
    const headers = new Headers();

    if (this.token) {
      headers.set('Authorization', `Bearer ${this.token}`);
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new ApiError(response.status, `Failed to get cover: ${response.statusText}`);
    }
    return response.blob();
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
