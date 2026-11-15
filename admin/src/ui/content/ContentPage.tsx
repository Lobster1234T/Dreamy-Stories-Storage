import { useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  CloseButton,
  Group,
  MultiSelect,
  Select,
  Stack,
  Tabs,
  Text,
  TextInput,
} from '@mantine/core';
import { IconFileUpload, IconInfoCircle, IconPlus, IconSearch } from '@tabler/icons-react';
import type { Section } from '../../core/types.ts';
import { SECTION_LABEL } from '../../core/types.ts';
import type { ItemFilter, SortMode, StatusFilter } from '../../core/sorting.ts';
import { EMPTY_FILTER, SORT_LABELS, filterItems, isFilterActive, sortItems } from '../../core/sorting.ts';
import { categoryName } from '../../core/serialize.ts';
import { useAppStore } from '../../store/appStore.ts';
import { selectChangedUids, selectProblemUids } from '../../store/selectors.ts';
import { openBulkImport, openEditor } from '../../store/uiStore.ts';
import { navigate } from '../router.ts';
import { usePref } from '../hooks.ts';
import { EmptyState, LocaleBadge } from '../common/common.tsx';
import { ItemList } from './ItemList.tsx';
import { BulkBar } from './BulkBar.tsx';

const SORT_MODES: readonly SortMode[] = ['order', 'newest', 'oldest', 'title', 'duration'];
const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'Все' },
  { value: 'visible', label: 'Видимые в приложении' },
  { value: 'hidden', label: 'Скрытые' },
  { value: 'changed', label: 'Изменённые' },
  { value: 'problems', label: 'С проблемами' },
];

export function ContentPage({ locale, section }: { locale: string; section: Section }) {
  const doc = useAppStore((s) => s.work.docs[locale]);
  const config = useAppStore((s) => s.work.config);
  const parseError = useAppStore((s) => s.base?.parseErrors[locale]);
  const changed = useAppStore(selectChangedUids);
  const problems = useAppStore(selectProblemUids);
  const [filter, setFilter] = useState<ItemFilter>(EMPTY_FILTER);
  const [sort, setSort] = usePref<SortMode>('sort', 'order', SORT_MODES);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const label = config.locales.find((l) => l.code === locale)?.label ?? locale;

  const items = doc?.[section] ?? [];
  const shown = useMemo(
    () => sortItems(filterItems(items, filter, { changedUids: changed, problemUids: problems }), sort, locale),
    [items, filter, changed, problems, sort, locale],
  );
  const dndEnabled = sort === 'order' && !isFilterActive(filter);

  if (parseError) {
    return <Alert color="red" title={`${locale}.json не читается`}>{parseError}. Исправьте файл на GitHub, затем «Обновить из GitHub».</Alert>;
  }
  if (!doc) return <EmptyState title="Такого гео нет" description="Выберите гео в меню слева или добавьте его в настройках." />;

  const toggle = (uid: string): void => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };
  const selectAll = (): void => setSelected(new Set(shown.map((item) => item.uid)));
  const addNew = (): void => openEditor({ locale, section, uid: null });

  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Group gap="sm">
          <LocaleBadge code={locale} size="lg" />
          <Text fw={700} size="xl">{label}</Text>
        </Group>
        <Group gap="xs">
          <Button variant="default" leftSection={<IconFileUpload size={16} />} onClick={() => openBulkImport(locale, section)}>
            Массовая загрузка
          </Button>
          <Button leftSection={<IconPlus size={16} />} onClick={addNew}>
            Добавить
          </Button>
        </Group>
      </Group>

      <Tabs value={section} onChange={(value) => value && navigate({ page: 'content', locale, section: value as Section })}>
        <Tabs.List>
          {(['stories', 'lullabies'] as const).map((s) => (
            <Tabs.Tab key={s} value={s} rightSection={<Badge size="sm" variant="light" color="gray">{doc[s].length}</Badge>}>
              {SECTION_LABEL[s]}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>

      <Group gap="sm" wrap="wrap" align="flex-end">
        <TextInput
          placeholder="Поиск по названию, описанию, ID"
          leftSection={<IconSearch size={16} />}
          value={filter.query}
          onChange={(e) => setFilter({ ...filter, query: e.currentTarget.value })}
          rightSection={filter.query ? <CloseButton size="sm" onClick={() => setFilter({ ...filter, query: '' })} aria-label="Очистить" /> : null}
          style={{ flex: '1 1 240px' }}
        />
        <MultiSelect
          placeholder={filter.categories.length ? undefined : 'Категории'}
          data={config.categories.map((c) => ({ value: c.id, label: `${c.icon} ${categoryName(c, locale, config.settings.referenceLocale)}`.trim() }))}
          value={[...filter.categories]}
          onChange={(categories) => setFilter({ ...filter, categories })}
          clearable
          searchable
          style={{ flex: '1 1 200px' }}
        />
        <Select data={STATUS_OPTIONS} value={filter.status} onChange={(v) => setFilter({ ...filter, status: (v as StatusFilter) ?? 'all' })} allowDeselect={false} w={210} />
        <Select data={SORT_MODES.map((m) => ({ value: m, label: SORT_LABELS[m] }))} value={sort} onChange={(v) => v && setSort(v as SortMode)} allowDeselect={false} w={190} />
      </Group>

      <Alert variant="light" color="yellow" icon={<IconInfoCircle size={16} />} py={6}>
        <Text size="xs">
          Приложение запоминает избранное и скачанное по номеру сказки. Новые добавляйте в конец; существующие не перемещайте,
          не скрывайте и не удаляйте из середины — иначе у пользователей всё сдвинется.
        </Text>
      </Alert>

      {!dndEnabled && items.length > 1 && (
        <Alert variant="light" color="gray" icon={<IconInfoCircle size={16} />} py={6}>
          <Text size="xs">Перетаскивание работает при сортировке «Как в приложении» и без фильтров.</Text>
        </Alert>
      )}

      {selected.size > 0 && (
        <BulkBar locale={locale} section={section} selected={[...selected]} total={shown.length}
          onSelectAll={selectAll} onClear={() => setSelected(new Set())} />
      )}

      {shown.length === 0 ? (
        <EmptyState
          title={items.length === 0 ? `Пока нет ни одной: ${SECTION_LABEL[section].toLowerCase()}` : 'Ничего не найдено'}
          description={items.length === 0 ? 'Добавьте первую — или загрузите сразу пачку MP3 через «Массовая загрузка».' : 'Измените поиск или фильтры.'}
          action={items.length === 0 ? <Button onClick={addNew} leftSection={<IconPlus size={16} />}>Добавить</Button> : undefined}
        />
      ) : (
        <ItemList
          locale={locale}
          section={section}
          items={shown}
          allItems={items}
          dnd={dndEnabled}
          selected={selected}
          onToggle={toggle}
          changed={changed}
          problems={problems}
        />
      )}
    </Stack>
  );
}
