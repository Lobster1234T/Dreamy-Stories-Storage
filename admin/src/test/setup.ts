import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

/** Node 25+ ships its own `localStorage` global that shadows jsdom's; use an in-memory one. */
class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();
  get length(): number {
    return this.data.size;
  }
  clear(): void {
    this.data.clear();
  }
  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }
}

// jsdom lacks a few browser APIs Mantine relies on.
if (typeof window !== 'undefined') {
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    Object.defineProperty(window, name, { configurable: true, value: new MemoryStorage() });
    Object.defineProperty(globalThis, name, { configurable: true, value: window[name] });
  }
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });

  class ResizeObserverMock {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.defineProperty(window, 'ResizeObserver', { writable: true, value: ResizeObserverMock });
  window.HTMLElement.prototype.scrollIntoView = () => undefined;
}
