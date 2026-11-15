import type { ContentConfig, ContentItem, Docs, Section, WorkState } from '../../core/types.ts';
import { findById, findItem } from '../../core/ops.ts';
import { isValidId } from '../../core/slug.ts';
import { todayIso } from '../../core/guards.ts';
import type { ItemDraft, SyncFields } from '../../store/actions.ts';
import { NO_SYNC, itemToDraft } from '../../store/actions.ts';
import type { EditorTarget } from '../../store/uiStore.ts';

export interface FormState {
  readonly draft: ItemDraft;
  readonly originalId: string;
  readonly sync: SyncFields;
  readonly position: number | undefined;
  readonly dirty: boolean;
}

export type FormErrors = Partial<Record<'title' | 'audioPath' | 'id', string>>;

const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Fields that are identical in every other geo are probably meant to stay
 * in sync, so they are pre-checked for syncing.
 */
export function defaultSync(docs: Docs, locale: string, section: Section, item: ContentItem, config: ContentConfig): SyncFields {
  const others = findById(docs, section, item.id).filter((x) => x.locale !== locale).map((x) => x.item);
  if (others.length === 0) return NO_SYNC;
  const all = (test: (other: ContentItem) => boolean): boolean => others.every(test);
  return {
    imagePath: all((o) => o.imagePath === item.imagePath),
    categories: all((o) => sameList(o.categories, item.categories)),
    audioPath: all((o) => o.audioPath === item.audioPath),
    customKeys: config.customFields.filter((f) => f.shared && all((o) => o.extra[f.key] === item.extra[f.key])).map((f) => f.key),
    renameId: true,
  };
}

export function initialForm(target: EditorTarget, work: WorkState): FormState | null {
  const doc = work.docs[target.locale];
  if (!doc) return null;
  if (target.uid) {
    const location = findItem(doc, target.uid);
    if (!location) return null;
    return {
      draft: itemToDraft(location.item, location.section),
      originalId: location.item.id,
      sync: defaultSync(work.docs, target.locale, location.section, location.item, work.config),
      position: undefined,
      dirty: false,
    };
  }
  const draft: ItemDraft = {
    id: '',
    title: '',
    description: '',
    audioPath: '',
    imagePath: '',
    categories: [],
    addedAt: todayIso(),
    duration: null,
    hidden: false,
    section: target.section,
    extra: {},
    ...target.prefill,
  };
  // The live app keys favorites/downloads by position (index): new items go to the end by default.
  return { draft, originalId: draft.id, sync: NO_SYNC, position: undefined, dirty: Boolean(target.prefill) };
}

export function validateDraft(draft: ItemDraft, docs: Docs, locale: string, uid: string | null): FormErrors {
  const errors: FormErrors = {};
  if (!draft.title.trim()) errors.title = 'Введите название';
  if (!draft.audioPath.trim() && !draft.hidden) {
    errors.audioPath = 'Загрузите аудио — или выключите «Показывать в приложении», чтобы сохранить как черновик';
  }
  if (draft.id && !isValidId(draft.id)) errors.id = 'Только строчная латиница, цифры и дефис';
  else if (draft.id && docs[locale]?.[draft.section].some((item) => item.id === draft.id && item.uid !== uid)) {
    errors.id = 'Такой ID уже есть в этом гео';
  }
  return errors;
}
