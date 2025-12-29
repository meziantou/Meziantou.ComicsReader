import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

// Mock navigator.onLine
Object.defineProperty(navigator, 'onLine', {
  value: true,
  writable: true,
});

// Mock navigator.connection
Object.defineProperty(navigator, 'connection', {
  value: {
    saveData: false,
    effectiveType: '4g',
  },
  writable: true,
});

// Mock matchMedia for dark mode tests
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// Mock URL.createObjectURL and URL.revokeObjectURL
(globalThis as unknown as { URL: { createObjectURL: () => string; revokeObjectURL: () => void } }).URL.createObjectURL = () => 'blob:mock-url';
(globalThis as unknown as { URL: { createObjectURL: () => string; revokeObjectURL: () => void } }).URL.revokeObjectURL = () => {};

// Mock requestFullscreen
Element.prototype.requestFullscreen = () => Promise.resolve();
document.exitFullscreen = () => Promise.resolve();
