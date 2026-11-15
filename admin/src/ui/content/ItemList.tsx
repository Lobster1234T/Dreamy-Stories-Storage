import { memo, useMemo } from 'react';
import { ActionIcon, Badge, Box, Checkbox, Group, Menu, Paper, Progress, Stack, Text, Tooltip } from '@mantine/core';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  IconAlertTriangle,
  IconArrowBarToDown,
  IconArrowBarToUp,
  IconDots,
  IconEye,
  IconEyeOff,
  IconGripVertical,
  IconLanguage,
  IconPencil,
  IconTrash,
} from '@tabler/icons-react';
import type { ContentConfig, ContentItem, Docs, Section, UploadEntry } from '../../core/types.ts';
import { formatDuration } from '../../core/paths.ts';
import { visiblePositions } from '../../core/ops.ts';
import { useAppStore } from '../../store/appStore.ts';
import { deleteItems, moveItemsToEdge, reorderItem, setItemsHidden } from '../../store/actions.ts';
import { openEditor } from '../../store/uiStore.ts';
import { CategoryChips, Cover, LocaleBadge, PlayButton } from '../common/common.tsx';
import { formatDate } from '../hooks.ts';
import { confirmDelete } from '../changes/publishFlow.tsx';

interface ListProps {
  readonly locale: string;
  readonly section: Section;
  readonly items: readonly ContentItem[];
  readonly allItems: readonly ContentItem[];
  readonly dnd: boolean;
  readonly selected: ReadonlySet<string>;
  readonly onToggle: (uid: string) => void;
  readonly changed: ReadonlySet<string>;
  readonly problems: ReadonlySet<string>;
}

function presenceMap(docs: Docs, section: Section): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const [code, doc] of Object.entries(docs)) {
    for (const item of doc[section]) {
      if (!item.id) continue;
      map.set(item.id, (map.get(item.id) ?? new Set()).add(code));
    }
  }
  return map;
}

export function ItemList(props: ListProps) {
  const { locale, section, items, allItems, dnd } = props;
  const config = useAppStore((s) => s.work.config);
  const docs = useAppStore((s) => s.work.docs);
  const uploads = useAppStore((s) => s.uploads);
  const positions = useMemo(() => visiblePositions(allItems), [allItems]);
  const presence = useMemo(() => presenceMap(docs, section), [docs, section]);
  const locales = config.locales.map((l) => l.code).filter((code) => docs[code]);
  const navUids = useMemo(() => items.map((item) => item.uid), [items]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = allItems.findIndex((item) => item.uid === active.id);
    const to = allItems.findIndex((item) => item.uid === over.id);
    if (from >= 0 && to >= 0) reorderItem(locale, section, from, to);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={navUids} strategy={verticalListSortingStrategy} disabled={!dnd}>
        <Stack gap={6}>
          {items.map((item) => (
            <ItemRow
              key={item.uid}
              item={item}
              locale={locale}
              section={section}
              fullIndex={allItems.indexOf(item)}
              position={positions.get(item.uid) ?? null}
              dnd={dnd}
              selected={props.selected.has(item.uid)}
              onToggle={props.onToggle}
              changed={props.changed.has(item.uid)}
              problem={props.problems.has(item.uid)}
              config={config}
              missingIn={locales.filter((code) => !presence.get(item.id)?.has(code))}
              uploading={uploadOf(uploads, item)}
              navUids={navUids}
            />
          ))}
        </Stack>
      </SortableContext>
    </DndContext>
  );
}

function uploadOf(uploads: Readonly<Record<string, UploadEntry>>, item: ContentItem): UploadEntry | null {
  const candidates = [uploads[item.audioPath], uploads[item.imagePath]].filter((u): u is UploadEntry => Boolean(u));
  return candidates.find((u) => u.status === 'uploading' || u.status === 'error') ?? null;
}

interface RowProps {
  readonly item: ContentItem;
  readonly locale: string;
  readonly section: Section;
  /** Index in the full list (hidden items included). */
  readonly fullIndex: number;
  readonly position: number | null;
  readonly dnd: boolean;
  readonly selected: boolean;
  readonly onToggle: (uid: string) => void;
  readonly changed: boolean;
  readonly problem: boolean;
  readonly config: ContentConfig;
  readonly missingIn: readonly string[];
  readonly uploading: UploadEntry | null;
  readonly navUids: readonly string[];
}

const ItemRow = memo(function ItemRow(props: RowProps) {
  const { item, locale, section, position, dnd, config } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.uid, disabled: !dnd });
  const open = (): void => openEditor({ locale, section, uid: item.uid, navUids: props.navUids });
  const listFields = config.customFields.filter((f) => f.showInList && item.extra[f.key] !== undefined && item.extra[f.key] !== '');

  return (
    <Paper
      ref={setNodeRef}
      withBorder
      p="xs"
      radius="md"
      className="item-row"
      data-changed={props.changed}
      data-hidden={item.hidden}
      data-dragging={isDragging}
      style={{ transform: CSS.Transform.toString(transform), transition, position: 'relative', zIndex: isDragging ? 5 : undefined }}
      onClick={open}
    >
      <Group gap="sm" wrap="nowrap">
        <Checkbox checked={props.selected} onChange={() => props.onToggle(item.uid)} onClick={(e) => e.stopPropagation()} aria-label="Выбрать" />
        {dnd && (
          <ActionIcon variant="subtle" color="gray" className="drag-handle" aria-label="Перетащить" {...attributes} {...listeners} onClick={(e) => e.stopPropagation()}>
            <IconGripVertical size={16} />
          </ActionIcon>
        )}
        <Text w={30} ta="right" c="dimmed" size="sm" ff="monospace">{position === null ? '—' : position + 1}</Text>
        <Group gap="sm" wrap="nowrap" className="item-row-main" style={{ flex: 1, minWidth: 0 }}>
          <Cover path={item.imagePath} size={52} />
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Group gap={6} wrap="nowrap">
              <Text fw={600} truncate>{item.title || 'Без названия'}</Text>
              {item.hidden && <Badge size="xs" color="gray" leftSection={<IconEyeOff size={10} />}>скрыта</Badge>}
              {props.problem && <Tooltip label="Есть проблемы — см. «Проверка»"><IconAlertTriangle size={16} color="var(--mantine-color-red-6)" /></Tooltip>}
              {listFields.map((f) => <Badge key={f.key} size="xs" variant="outline">{f.label}: {String(item.extra[f.key])}</Badge>)}
            </Group>
            <Text size="sm" c="dimmed" lineClamp={1}>{item.description || '—'}</Text>
            <CategoryChips ids={item.categories} config={config} locale={locale} />
          </Box>
        </Group>
        {props.uploading && (props.uploading.status === 'error'
          ? <Badge color="red" size="sm">ошибка загрузки</Badge>
          : <Progress value={props.uploading.progress * 100} w={60} size="sm" animated />)}
        <Stack gap={0} align="flex-end" visibleFrom="md" miw={78}>
          <Text size="xs" c="dimmed">{formatDate(item.addedAt)}</Text>
          <Text size="xs" c="dimmed">{formatDuration(item.duration)}</Text>
        </Stack>
        <PlayButton path={item.audioPath} title={item.title} cover={item.imagePath} />
        <RowMenu {...props} onOpen={open} />
      </Group>
    </Paper>
  );
});

function RowMenu({ item, locale, section, fullIndex, missingIn, onOpen }: RowProps & { onOpen: () => void }) {
  const translate = (target: string): void => openEditor({
    locale: target,
    section,
    uid: null,
    position: fullIndex >= 0 ? fullIndex : undefined,
    prefill: {
      id: item.id,
      title: item.title,
      description: item.description,
      imagePath: item.imagePath,
      categories: item.categories,
      ...(section === 'lullabies' ? { audioPath: item.audioPath, duration: item.duration } : {}),
    },
  });
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon variant="subtle" color="gray" aria-label="Действия" onClick={(e) => e.stopPropagation()}><IconDots size={16} /></ActionIcon>
      </Menu.Target>
      <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
        <Menu.Item leftSection={<IconPencil size={14} />} onClick={onOpen}>Редактировать</Menu.Item>
        <Menu.Item leftSection={item.hidden ? <IconEye size={14} /> : <IconEyeOff size={14} />} onClick={() => setItemsHidden(locale, [item.uid], !item.hidden)}>
          {item.hidden ? 'Показать в приложении' : 'Скрыть из приложения'}
        </Menu.Item>
        <Menu.Item leftSection={<IconArrowBarToUp size={14} />} onClick={() => moveItemsToEdge(locale, section, [item.uid], 'top')}>В начало списка</Menu.Item>
        <Menu.Item leftSection={<IconArrowBarToDown size={14} />} onClick={() => moveItemsToEdge(locale, section, [item.uid], 'bottom')}>В конец списка</Menu.Item>
        {missingIn.length > 0 && (
          <>
            <Menu.Divider />
            <Menu.Label>Добавить перевод в</Menu.Label>
            {missingIn.map((code) => (
              <Menu.Item key={code} leftSection={<IconLanguage size={14} />} rightSection={<LocaleBadge code={code} size="xs" />} onClick={() => translate(code)}>
                {code.toUpperCase()}
              </Menu.Item>
            ))}
          </>
        )}
        <Menu.Divider />
        <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={() => confirmDelete(1, (withFiles) => deleteItems(locale, [item.uid], withFiles))}>
          Удалить
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
