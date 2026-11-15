import { useSyncExternalStore } from 'react';
import type { Section } from '../core/types.ts';

export type Route =
  | { readonly page: 'overview' }
  | { readonly page: 'content'; readonly locale: string; readonly section: Section }
  | { readonly page: 'matrix'; readonly section: Section }
  | { readonly page: 'categories' }
  | { readonly page: 'media' }
  | { readonly page: 'health' }
  | { readonly page: 'settings'; readonly tab: string };

const asSection = (value: string | undefined): Section => (value === 'lullabies' ? 'lullabies' : 'stories');

export function parseRoute(hash: string): Route {
  const [page, a, b] = hash.replace(/^#\/?/, '').split('/').map((part) => decodeURIComponent(part));
  switch (page) {
    case 'content': return a ? { page: 'content', locale: a, section: asSection(b) } : { page: 'overview' };
    case 'matrix': return { page: 'matrix', section: asSection(a) };
    case 'categories': return { page: 'categories' };
    case 'media': return { page: 'media' };
    case 'health': return { page: 'health' };
    case 'settings': return { page: 'settings', tab: a || 'locales' };
    default: return { page: 'overview' };
  }
}

export function routeHash(route: Route): string {
  switch (route.page) {
    case 'content': return `#/content/${encodeURIComponent(route.locale)}/${route.section}`;
    case 'matrix': return `#/matrix/${route.section}`;
    case 'settings': return `#/settings/${route.tab}`;
    default: return `#/${route.page === 'overview' ? '' : route.page}`;
  }
}

export function navigate(route: Route): void {
  window.location.hash = routeHash(route);
}

function subscribe(callback: () => void): () => void {
  window.addEventListener('hashchange', callback);
  return () => window.removeEventListener('hashchange', callback);
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash, () => '');
  return parseRoute(hash);
}
