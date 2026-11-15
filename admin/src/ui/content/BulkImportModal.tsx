import { useEffect, useMemo, useState } from 'react';
import { ActionIcon, Alert, Button, Group, Modal, ScrollArea, Select, Stack, Table, Text, TextInput } from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { notifications } from '@mantine/notifications';
import { IconFileMusic, IconTrash, IconUpload } from '@tabler/icons-react';
import type { ContentItem, Section } from '../../core/types.ts';
import { SECTION_LABEL } from '../../core/types.ts';
import { formatBytes } from '../../core/paths.ts';
import { leadingNumber, titleFromFileName } from '../../core/titles.ts';
import { idsInSection } from '../../core/ids.ts';
import { slugify, uniqueSlug } from '../../core/slug.ts';
import { errorMessage, useAppStore } from '../../store/appStore.ts';
import { applyImport } from '../../store/actions.ts';
import type { ImportEntry } from '../../store/actions.ts';
import { stageUpload } from '../../store/uploads.ts';
import { closeBulkImport, useUiStore } from '../../store/uiStore.ts';
import { audioUploadPath, readAudioDuration, validateAudioFile } from '../../media/media.ts';
import { LocaleBadge } from '../common/common.tsx';

interface Row {
  readonly key: string;
  readonly file: File;
  readonly title: string;
  /** 'new' or the uid of the item whose audio is replaced. */
  readonly target: string;
  readonly ref: ContentItem | null;
}

let rowCounter = 0;
const NO_ITEMS: readonly ContentItem[] = [];

function matchFile(file: File, items: readonly ContentItem[], ref: readonly ContentItem[]): Row {
  rowCounter += 1;
  const number = leadingNumber(file.name);
  const base = { key: `row${rowCounter}`, file, title: titleFromFileName(file.name) };
  const existing = number !== null ? items[number - 1] : undefined;
  if (existing) return { ...base, target: existing.uid, ref: null, title: existing.title };
  const refItem = number !== null ? ref[number - 1] : undefined;
  if (refItem && !items.some((item) => item.id === refItem.id)) return { ...base, target: 'new', ref: refItem };
  return { ...base, target: 'new', ref: null };
}

export function BulkImportModal() {
  const target = useUiStore((s) => s.bulkImport);
  const [rows, setRows] = useState<Row[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setRows([]);
    setRejected([]);
  }, [target]);
  const locale = target?.locale ?? '';
  const section: Section = target?.section ?? 'stories';
  const items = useAppStore((s) => s.work.docs[locale]?.[section] ?? NO_ITEMS);
  const reference = useAppStore((s) => s.work.docs[s.work.config.settings.referenceLocale]?.[section] ?? NO_ITEMS);
  const options = useMemo(() => [
    { value: 'new', label: '➕ Новая сказка' },
    ...items.map((item, index) => ({ value: item.uid, label: `Заменить аудио: ${index + 1}. ${item.title}` })),
  ], [items]);

  const addFiles = (files: File[]): void => {
    const bad = files.map((file) => [file.name, validateAudioFile(file)] as const).filter(([, error]) => error);
    setRejected(bad.map(([name, error]) => `${name}: ${error}`));
    const good = files.filter((file) => !validateAudioFile(file));
    const sorted = [...good].sort((a, b) => (leadingNumber(a.name) ?? 1e9) - (leadingNumber(b.name) ?? 1e9));
    setRows((current) => [...current, ...sorted.map((file) => matchFile(file, items, reference))]);
  };

  const patchRow = (key: string, patch: Partial<Row>): void => setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  async function apply(): Promise<void> {
    setBusy(true);
    try {
      const entries = await buildEntries(rows, locale, section);
      applyImport(locale, section, entries);
      notifications.show({ color: 'teal', title: 'Файлы добавлены', message: `${entries.length} шт. в черновике. Проверьте названия и опубликуйте.` });
      closeBulkImport();
    } catch (error) {
      notifications.show({ color: 'red', title: 'Не удалось добавить файлы', message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal opened={target !== null} onClose={closeBulkImport} size="xl" title={
      <Group gap="xs"><Text fw={700}>Массовая загрузка аудио</Text><LocaleBadge code={locale} /><Text c="dimmed" size="sm">{SECTION_LABEL[section]}</Text></Group>
    }>
      <Stack gap="md">
        <Dropzone onDrop={addFiles} accept={{ 'audio/mpeg': ['.mp3'], 'audio/mp3': ['.mp3'] }} multiple>
          <Group justify="center" gap="md" mih={90} style={{ pointerEvents: 'none' }}>
            <IconUpload size={32} />
            <Stack gap={2}>
              <Text fw={600}>Перетащите MP3-файлы сюда</Text>
              <Text size="sm" c="dimmed">Номер в начале имени («12. Название.mp3») сопоставит файл со сказкой №12 или с переводом №12 из базового гео.</Text>
            </Stack>
          </Group>
        </Dropzone>
        {rejected.length > 0 && <Alert color="red" title="Пропущены файлы">{rejected.map((r) => <Text key={r} size="sm">{r}</Text>)}</Alert>}
        {rows.length > 0 && (
          <ScrollArea.Autosize mah={420}>
            <Table verticalSpacing={6} striped>
              <Table.Thead>
                <Table.Tr><Table.Th>Файл</Table.Th><Table.Th>Куда</Table.Th><Table.Th>Название</Table.Th><Table.Th /></Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((row) => (
                  <Table.Tr key={row.key}>
                    <Table.Td maw={220}>
                      <Group gap={6} wrap="nowrap"><IconFileMusic size={16} /><Text size="sm" truncate>{row.file.name}</Text></Group>
                      <Text size="xs" c="dimmed">{formatBytes(row.file.size)}{row.ref ? ` · перевод «${row.ref.title}»` : ''}</Text>
                    </Table.Td>
                    <Table.Td miw={240}>
                      <Select size="xs" data={options} value={row.target} searchable allowDeselect={false}
                        onChange={(value) => patchRow(row.key, { target: value ?? 'new', ref: value === 'new' ? row.ref : null })} />
                    </Table.Td>
                    <Table.Td miw={200}>
                      <TextInput size="xs" value={row.title} disabled={row.target !== 'new'} onChange={(e) => patchRow(row.key, { title: e.currentTarget.value })} />
                    </Table.Td>
                    <Table.Td>
                      <ActionIcon variant="subtle" color="red" aria-label="Убрать" onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}><IconTrash size={14} /></ActionIcon>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea.Autosize>
        )}
        <Group justify="space-between">
          <Text size="sm" c="dimmed">{rows.length > 0 ? `Файлов: ${rows.length}` : 'Файлы загрузятся в фоне, пока вы проверяете названия.'}</Text>
          <Group gap="xs">
            <Button variant="default" onClick={closeBulkImport}>Отмена</Button>
            <Button onClick={() => void apply()} loading={busy} disabled={rows.length === 0}>Добавить в черновик</Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}

async function buildEntries(rows: readonly Row[], locale: string, section: Section): Promise<ImportEntry[]> {
  const { docs, config } = useAppStore.getState().work;
  const doc = docs[locale];
  const taken = idsInSection(docs, section);
  const entries: ImportEntry[] = [];
  for (const row of rows) {
    const existing = row.target !== 'new' ? doc?.[section].find((item) => item.uid === row.target) : undefined;
    const refId = row.ref && !doc?.[section].some((item) => item.id === row.ref?.id) ? row.ref.id : '';
    const title = row.title.trim() || titleFromFileName(row.file.name);
    const id = existing?.id || refId || uniqueSlug(slugify(title) || 'story', taken);
    taken.add(id);
    const audioPath = await audioUploadPath(config, section, locale, id, row.file);
    await stageUpload(row.file, audioPath);
    entries.push({
      mode: existing ? 'replace' : 'new',
      targetUid: existing?.uid ?? null,
      ref: row.ref,
      id,
      title,
      audioPath,
      duration: await readAudioDuration(row.file),
    });
  }
  return entries;
}
