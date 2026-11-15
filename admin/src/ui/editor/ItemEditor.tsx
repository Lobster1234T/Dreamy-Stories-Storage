import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Box,
  Button,
  Drawer,
  Grid,
  Group,
  MultiSelect,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from '@mantine/core';
import { getHotkeyHandler } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconChevronLeft, IconChevronRight, IconPlus, IconTrash } from '@tabler/icons-react';
import type { Section } from '../../core/types.ts';
import { SECTION_LABEL } from '../../core/types.ts';
import { categoryName } from '../../core/serialize.ts';
import { visiblePositions } from '../../core/ops.ts';
import { newItemId } from '../../core/ids.ts';
import { useAppStore } from '../../store/appStore.ts';
import { deleteItems, saveItem } from '../../store/actions.ts';
import type { ItemDraft } from '../../store/actions.ts';
import { closeEditor, openEditor, useUiStore } from '../../store/uiStore.ts';
import type { EditorTarget } from '../../store/uiStore.ts';
import { LocaleBadge } from '../common/common.tsx';
import { confirmDelete } from '../changes/publishFlow.tsx';
import { CategoryModal } from '../categories/CategoryModal.tsx';
import { initialForm, validateDraft } from './useItemForm.ts';
import type { FormState } from './useItemForm.ts';
import { AudioField, CoverField } from './MediaFields.tsx';
import { AdvancedSection, CustomFieldInputs, SyncOptions, TranslationsBlock } from './EditorSections.tsx';

function confirmLeave(dirty: boolean, action: () => void): void {
  if (!dirty) {
    action();
    return;
  }
  modals.openConfirmModal({
    title: 'Есть несохранённые изменения',
    children: <Text size="sm">Уйти без сохранения? Правки в этой форме пропадут.</Text>,
    labels: { confirm: 'Не сохранять', cancel: 'Остаться' },
    confirmProps: { color: 'red' },
    onConfirm: action,
  });
}

export function ItemEditor() {
  const target = useUiStore((s) => s.editor);
  const [form, setForm] = useState<FormState | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    setShowErrors(false);
    setForm(target ? initialForm(target, useAppStore.getState().work) : null);
  }, [target]);

  const requestClose = (): void => confirmLeave(Boolean(form?.dirty), closeEditor);

  return (
    <Drawer.Root opened={target !== null} onClose={requestClose} position="right" size={780}>
      <Drawer.Overlay />
      <Drawer.Content>
        {target && form ? (
          <EditorBody target={target} form={form} setForm={setForm} showErrors={showErrors} setShowErrors={setShowErrors} onClose={requestClose} />
        ) : (
          target && <Box p="lg"><Text>Сказка не найдена — возможно, её удалили.</Text></Box>
        )}
      </Drawer.Content>
    </Drawer.Root>
  );
}

interface BodyProps {
  readonly target: EditorTarget;
  readonly form: FormState;
  readonly setForm: (update: (form: FormState | null) => FormState | null) => void;
  readonly showErrors: boolean;
  readonly setShowErrors: (value: boolean) => void;
  readonly onClose: () => void;
}

function EditorBody({ target, form, setForm, showErrors, setShowErrors, onClose }: BodyProps) {
  const docs = useAppStore((s) => s.work.docs);
  const config = useAppStore((s) => s.work.config);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const { draft } = form;
  const isNew = target.uid === null;
  const patch = useCallback((p: Partial<ItemDraft>) => setForm((f) => (f ? { ...f, draft: { ...f.draft, ...p }, dirty: true } : f)), [setForm]);
  const errors = useMemo(() => validateDraft(draft, docs, target.locale, target.uid), [draft, docs, target.locale, target.uid]);
  const items = docs[target.locale]?.[draft.section] ?? [];
  const position = target.uid ? visiblePositions(items).get(target.uid) ?? null : null;
  const navIndex = target.uid && target.navUids ? target.navUids.indexOf(target.uid) : -1;

  const save = (): void => {
    if (useAppStore.getState().busy) {
      notifications.show({ color: 'orange', message: 'Идёт публикация — сохраните через пару секунд.' });
      return;
    }
    if (Object.keys(errors).length > 0) {
      setShowErrors(true);
      notifications.show({ color: 'red', message: 'Проверьте поля, отмеченные красным.' });
      return;
    }
    const id = draft.id || newItemId(useAppStore.getState().work.docs, draft.section, draft.title);
    saveItem({ locale: target.locale, uid: target.uid, draft: { ...draft, id }, position: form.position, previousId: isNew ? undefined : form.originalId, sync: form.sync });
    notifications.show({ color: 'teal', message: 'Сохранено в черновик. Нажмите «Опубликовать», когда будете готовы.' });
    closeEditor();
  };

  const goTo = (next: EditorTarget): void => confirmLeave(form.dirty, () => openEditor(next));
  const sourceIndex = target.uid ? items.findIndex((item) => item.uid === target.uid) : form.position;
  const translateTo = (locale: string): void => goTo({
    locale,
    section: draft.section,
    uid: null,
    position: sourceIndex !== undefined && sourceIndex >= 0 ? sourceIndex : undefined,
    prefill: {
      id: draft.id, title: draft.title, description: draft.description, imagePath: draft.imagePath, categories: draft.categories,
      ...(draft.section === 'lullabies' ? { audioPath: draft.audioPath, duration: draft.duration } : {}),
    },
  });
  const remove = (): void => confirmDelete(1, (withFiles) => {
    if (target.uid) deleteItems(target.locale, [target.uid], withFiles);
    closeEditor();
  });
  const categoryOptions = config.categories.map((c) => ({ value: c.id, label: `${c.icon} ${categoryName(c, target.locale, config.settings.referenceLocale)}`.trim() }));
  const positionOptions = [
    { value: 'end', label: 'В конец списка' },
    { value: '0', label: 'В начало списка' },
    ...items.map((item, index) => ({ value: String(index + 1), label: `После «${item.title}»` })),
  ];

  return (
    <Box onKeyDown={getHotkeyHandler([['mod+S', save], ['mod+Enter', save]])} style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <Drawer.Header>
        <Group gap="xs" wrap="nowrap">
          <LocaleBadge code={target.locale} />
          <Drawer.Title fw={700}>{isNew ? 'Новая' : 'Редактирование'} · {SECTION_LABEL[draft.section]}</Drawer.Title>
        </Group>
        <Group gap={4} wrap="nowrap">
          {navIndex >= 0 && target.navUids && (
            <>
              <Tooltip label="Предыдущая"><ActionIcon variant="subtle" disabled={navIndex === 0} aria-label="Предыдущая"
                onClick={() => goTo({ ...target, uid: target.navUids![navIndex - 1] })}><IconChevronLeft size={18} /></ActionIcon></Tooltip>
              <Text size="xs" c="dimmed">{navIndex + 1}/{target.navUids.length}</Text>
              <Tooltip label="Следующая"><ActionIcon variant="subtle" disabled={navIndex === target.navUids.length - 1} aria-label="Следующая"
                onClick={() => goTo({ ...target, uid: target.navUids![navIndex + 1] })}><IconChevronRight size={18} /></ActionIcon></Tooltip>
            </>
          )}
          <Drawer.CloseButton />
        </Group>
      </Drawer.Header>
      <Drawer.Body style={{ flex: 1 }}>
        <Stack gap="md">
          <Grid gutter="lg">
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <CoverField locale={target.locale} section={draft.section} draft={draft} onChange={patch} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 8 }}>
              <Stack gap="sm">
                <TextInput label="Название" required data-autofocus value={draft.title} onChange={(e) => patch({ title: e.currentTarget.value })}
                  error={showErrors ? errors.title : undefined}
                  leftSection={config.settings.autoNumberTitles && position !== null ? <Text size="sm" c="dimmed">{position + 1}.</Text> : undefined} />
                <Textarea label="Описание" autosize minRows={3} maxRows={8} value={draft.description}
                  onChange={(e) => patch({ description: e.currentTarget.value })} description={`${draft.description.length} символов`} />
                <Group gap={6} align="flex-end" wrap="nowrap">
                  <MultiSelect label="Категории" data={categoryOptions} value={[...draft.categories]} onChange={(categories) => patch({ categories })}
                    searchable clearable placeholder={categoryOptions.length ? 'Выберите' : 'Сначала создайте категорию'} style={{ flex: 1 }} />
                  <Tooltip label="Новая категория"><ActionIcon size="lg" variant="default" aria-label="Новая категория" onClick={() => setCategoryOpen(true)}><IconPlus size={16} /></ActionIcon></Tooltip>
                </Group>
                <Group grow align="flex-end">
                  <TextInput type="date" label="Дата добавления" value={draft.addedAt ?? ''} onChange={(e) => patch({ addedAt: e.currentTarget.value || null })} />
                  <Stack gap={4}>
                    <Text size="sm" fw={500}>Раздел</Text>
                    <SegmentedControl value={draft.section} onChange={(value) => patch({ section: value as Section })}
                      data={[{ value: 'stories', label: 'Сказка' }, { value: 'lullabies', label: 'Колыбельная' }]} />
                  </Stack>
                </Group>
                <Switch checked={!draft.hidden} onChange={(e) => patch({ hidden: !e.currentTarget.checked })} label="Показывать в приложении"
                  description={draft.hidden ? 'Скрыта: хранится в файле, но приложение её не показывает (удобно для черновиков и сезонных сказок)' : undefined} />
                {isNew && (
                  <Select label="Куда добавить" data={positionOptions} value={form.position === undefined ? 'end' : String(form.position)} searchable allowDeselect={false}
                    onChange={(value) => setForm((f) => (f ? { ...f, position: value === 'end' || value === null ? undefined : Number(value) } : f))} />
                )}
              </Stack>
            </Grid.Col>
          </Grid>
          <AudioField locale={target.locale} section={draft.section} draft={draft} onChange={patch} error={showErrors ? errors.audioPath : undefined} />
          <CustomFieldInputs draft={draft} onChange={patch} />
          <TranslationsBlock locale={target.locale} section={draft.section} draft={draft}
            onOpen={(locale, uid) => goTo({ locale, section: draft.section, uid })} onCreate={translateTo} />
          {!isNew && (
            <SyncOptions section={draft.section} draft={draft} originalId={form.originalId} locale={target.locale} sync={form.sync}
              onChange={(sync) => setForm((f) => (f ? { ...f, sync, dirty: true } : f))} />
          )}
          <AdvancedSection draft={draft} onChange={patch} idError={showErrors ? errors.id : errors.id && draft.id ? errors.id : undefined} isNew={isNew} />
        </Stack>
      </Drawer.Body>
      <Group justify="space-between" p="md" style={{ position: 'sticky', bottom: 0, background: 'var(--mantine-color-body)', borderTop: '1px solid var(--mantine-color-default-border)', zIndex: 2 }}>
        {isNew ? <span /> : <Button variant="subtle" color="red" leftSection={<IconTrash size={16} />} onClick={remove}>Удалить</Button>}
        <Group gap="xs">
          <Button variant="default" onClick={onClose}>Отмена</Button>
          <Tooltip label="Ctrl+S"><Button onClick={save}>{isNew ? 'Добавить' : 'Сохранить'}</Button></Tooltip>
        </Group>
      </Group>
      <CategoryModal opened={categoryOpen} onClose={() => setCategoryOpen(false)} category={null}
        onSaved={(id) => patch({ categories: [...draft.categories, id] })} />
    </Box>
  );
}
