import { create } from 'zustand';
import type { Section } from '../core/types.ts';
import type { ItemDraft } from './actions.ts';

export interface EditorTarget {
  readonly locale: string;
  readonly section: Section;
  /** null opens the editor for a new item. */
  readonly uid: string | null;
  readonly prefill?: Partial<ItemDraft>;
  readonly position?: number;
  /** Order used by the previous/next buttons. */
  readonly navUids?: readonly string[];
}

export interface PlayerTrack {
  readonly src: string;
  readonly title: string;
  readonly cover: string | null;
}

interface UiState {
  readonly editor: EditorTarget | null;
  readonly player: PlayerTrack | null;
  readonly changesOpen: boolean;
  readonly bulkImport: { readonly locale: string; readonly section: Section } | null;
}

export const useUiStore = create<UiState>()(() => ({
  editor: null,
  player: null,
  changesOpen: false,
  bulkImport: null,
}));

export const openEditor = (editor: EditorTarget): void => useUiStore.setState({ editor });
export const closeEditor = (): void => useUiStore.setState({ editor: null });
export const play = (player: PlayerTrack): void => useUiStore.setState({ player });
export const stopPlayer = (): void => useUiStore.setState({ player: null });
export const setChangesOpen = (changesOpen: boolean): void => useUiStore.setState({ changesOpen });
export const openBulkImport = (locale: string, section: Section): void => useUiStore.setState({ bulkImport: { locale, section } });
export const closeBulkImport = (): void => useUiStore.setState({ bulkImport: null });
