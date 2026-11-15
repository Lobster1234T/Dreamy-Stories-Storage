import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionIcon, Alert, Anchor, Badge, Button, Group, Loader, Modal, ScrollArea, Select, Stack, Table, Tabs, Text, TextInput, Tooltip } from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { notifications } from '@mantine/notifications';
import { IconFileMusic, IconLink, IconTrash, IconUpload } from '@tabler/icons-react';
import type { ContentItem, Section } from '../../core/types.ts';
import { SECTION_LABEL } from '../../core/types.ts';
import { formatBytes, formatDuration } from '../../core/paths.ts';
import { cleanLinkTitle, linkHost } from '../../core/links.ts';
import { leadingNumber, titleFromFileName } from '../../core/titles.ts';
import { idsInSection } from '../../core/ids.ts';
import { slugify, uniqueSlug } from '../../core/slug.ts';
import { errorMessage, useAppStore } from '../../store/appStore.ts';
import { applyImport } from '../../store/actions.ts';
import type { ImportEntry } from '../../store/actions.ts';
import { stageUpload } from '../../store/uploads.ts';
import { closeBulkImport, useUiStore } from '../../store/uiStore.ts';
import type { BulkImportMode } from '../../store/uiStore.ts';
import { audioUploadPath, readAudioDuration, validateAudioFile } from '../../media/media.ts';
import { downloadLinkAudio } from '../../media/linkImport.ts';
import type { LinkEntry } from '../../media/linkImport.ts';
import { LocaleBadge } from '../common/common.tsx';
import { LinkImportPanel } from './LinkImportPanel.tsx';

type RowStatus = 'ready' | 'waiting' | 'downloading' | 'error';

interface Row {
  readonly key: string;
  /** null while a link is still being downloaded. */
  readonly file: File | null;
  readonly title: string;
  /** 'new' or the uid of the item whose audio is replaced. */
  readonly target: string;
  readonly ref: ContentItem | null;
  readonly status: RowStatus;
  /** Rows added "by link": where the audio comes from. */
  readonly link?: LinkEntry;
  readonly error?: string;
}

type Option = { readonly value: string; readonly label: string };

/** Links downloaded at the same time: gentle on YouTube and on this computer. */
const PARALLEL_DOWNLOADS = 2;
const NO_ITEMS: readonly ContentItem[] = [];
let rowCounter = 0;

function nextKey(): string {
  rowCounter += 1;
  return `row${rowCounter}`;
}

function matchFile(file: File, items: readonly ContentItem[], ref: readonly ContentItem[]): Row {
  const number = leadingNumber(file.name);
  const base = { key: nextKey(), file, title: titleFromFileName(file.name), status: 'ready' as const };
  const existing = number !== null ? items[number - 1] : undefined;
  if (existing) return { ...base, target: existing.uid, ref: null, title: existing.title };
  const refItem = number !== null ? ref[number - 1] : undefined;
  if (refItem && !items.some((item) => item.id === refItem.id)) return { ...base, target: 'new', ref: refItem };
  return { ...base, target: 'new', ref: null };
}

/** Link rows always create new stories: a number in a video title must never replace an existing story. */
function linkRow(entry: LinkEntry): Row {
  return { key: nextKey(), file: null, title: cleanLinkTitle(entry.title), target: 'new', ref: null, status: 'waiting', link: entry };
}

function LinkStatus({ row, onRetry }: { row: Row; onRetry: () => void }) {
  switch (row.status) {
    case 'waiting':
      return <Text size="xs" c="dimmed">в очереди</Text>;
    case 'downloading':
      return <Group gap={4} wrap="nowrap"><Loader size={10} /><Text size="xs" c="dimmed">скачиваю и перевожу в MP3…</Text></Group>;
    case 'error':
      return (
        <Text size="xs" c="red">
          {row.error}{' '}<Anchor component="button" type="button" size="xs" onClick={onRetry}>Повторить</Anchor>
        </Text>
      );
    default:
      return <Text size="xs" c="teal">скачано</Text>;
  }
}

function SourceCell({ row, onRetry }: { row: Row; onRetry: () => void }) {
  if (!row.link) {
    return (
      <>
        <Group gap={6} wrap="nowrap"><IconFileMusic size={16} /><Text size="sm" truncate>{row.file?.name}</Text></Group>
        <Text size="xs" c="dimmed">{formatBytes(row.file?.size ?? 0)}{row.ref ? ` · перевод «${row.ref.title}»` : ''}</Text>
      </>
    );
  }
  const { link } = row;
  const details = [link.uploader, link.duration !== null ? formatDuration(link.duration) : '', row.file ? formatBytes(row.file.size) : '']
    .filter(Boolean).join(' · ');
  return (
    <>
      <Group gap={6} wrap="nowrap">
        <IconLink size={16} />
        <Anchor href={link.url} target="_blank" rel="noreferrer" size="sm" truncate>{linkHost(link.url) || link.url}</Anchor>
        {/creative commons/i.test(link.license) && (
          <Tooltip label={link.license}><Badge size="xs" color="teal" variant="light">CC</Badge></Tooltip>
        )}
      </Group>
      {details && <Text size="xs" c="dimmed" truncate>{details}</Text>}
      <LinkStatus row={row} onRetry={onRetry} />
    </>
  );
}

interface RowProps {
  readonly row: Row;
  readonly options: readonly Option[];
  readonly onPatch: (key: string, patch: Partial<Row>) => void;
  readonly onRemove: (key: string) => void;
}

function ImportRow({ row, options, onPatch, onRemove }: RowProps) {
  return (
    <Table.Tr>
      <Table.Td maw={240}>
        <SourceCell row={row} onRetry={() => onPatch(row.key, { status: 'waiting', error: undefined })} />
      </Table.Td>
      <Table.Td miw={220}>
        {row.link ? <Text size="sm">➕ Новая сказка</Text> : (
          <Select size="xs" data={options} value={row.target} searchable allowDeselect={false}
            onChange={(value) => onPatch(row.key, { target: value ?? 'new', ref: value === 'new' ? row.ref : null })} />
        )}
      </Table.Td>
      <Table.Td miw={200}>
        <TextInput size="xs" value={row.title} disabled={row.target !== 'new'} aria-label="Название"
          onChange={(e) => onPatch(row.key, { title: e.currentTarget.value })} />
      </Table.Td>
      <Table.Td>
        <ActionIcon variant="subtle" color="red" aria-label="Убрать" onClick={() => onRemove(row.key)}><IconTrash size={14} /></ActionIcon>
      </Table.Td>
    </Table.Tr>
  );
}

function footerText(total: number, ready: number, pending: number, failed: number): string {
  if (total === 0) return 'Файлы загрузятся в фоне, пока вы проверяете названия.';
  const parts = [pending > 0 ? `скачивается ${pending}` : '', `готово ${ready}`, failed > 0 ? `${failed} с ошибкой — будут пропущены` : ''];
  return parts.filter(Boolean).join(' · ');
}

export function BulkImportModal() {
  const target = useUiStore((s) => s.bulkImport);
  const [rows, setRows] = useState<Row[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<BulkImportMode>('files');
  const downloads = useRef(new Map<string, AbortController>());

  useEffect(() => {
    setRows([]);
    setRejected([]);
    setTab(target?.mode ?? 'files');
    const active = downloads.current;
    return () => {
      active.forEach((controller) => controller.abort());
      active.clear();
    };
  }, [target]);

  const locale = target?.locale ?? '';
  const section: Section = target?.section ?? 'stories';
  const items = useAppStore((s) => s.work.docs[locale]?.[section] ?? NO_ITEMS);
  const reference = useAppStore((s) => s.work.docs[s.work.config.settings.referenceLocale]?.[section] ?? NO_ITEMS);
  const options = useMemo<Option[]>(() => [
    { value: 'new', label: '➕ Новая сказка' },
    ...items.map((item, index) => ({ value: item.uid, label: `Заменить аудио: ${index + 1}. ${item.title}` })),
  ], [items]);

  const patchRow = (key: string, patch: Partial<Row>): void => setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  function startDownload(row: Row): void {
    if (!row.link) return;
    const controller = new AbortController();
    downloads.current.set(row.key, controller);
    patchRow(row.key, { status: 'downloading', error: undefined });
    downloadLinkAudio(row.link.url, row.title, controller.signal)
      .then((file) => {
        const problem = validateAudioFile(file);
        patchRow(row.key, problem ? { status: 'error', error: problem } : { status: 'ready', file });
      }, (error: unknown) => {
        if (!controller.signal.aborted) patchRow(row.key, { status: 'error', error: errorMessage(error) });
      })
      .finally(() => downloads.current.delete(row.key));
  }

  // Download queue: keeps up to PARALLEL_DOWNLOADS links in flight.
  useEffect(() => {
    const active = rows.filter((row) => row.status === 'downloading').length;
    rows.filter((row) => row.status === 'waiting').slice(0, Math.max(0, PARALLEL_DOWNLOADS - active)).forEach(startDownload);
  }, [rows]);

  const addFiles = (files: File[]): void => {
    const bad = files.map((file) => [file.name, validateAudioFile(file)] as const).filter(([, error]) => error);
    setRejected(bad.map(([name, error]) => `${name}: ${error}`));
    const good = files.filter((file) => !validateAudioFile(file));
    const sorted = [...good].sort((a, b) => (leadingNumber(a.name) ?? 1e9) - (leadingNumber(b.name) ?? 1e9));
    setRows((current) => [...current, ...sorted.map((file) => matchFile(file, items, reference))]);
  };

  const addLinks = (entries: readonly LinkEntry[]): void => setRows((current) => {
    const known = new Set(current.flatMap((row) => (row.link ? [row.link.url] : [])));
    return [...current, ...entries.filter((entry) => !known.has(entry.url)).map(linkRow)];
  });

  const removeRow = (key: string): void => {
    downloads.current.get(key)?.abort();
    downloads.current.delete(key);
    setRows((current) => current.filter((row) => row.key !== key));
  };

  const ready = rows.filter((row) => row.status === 'ready').length;
  const pending = rows.filter((row) => row.status === 'waiting' || row.status === 'downloading').length;
  const failed = rows.filter((row) => row.status === 'error').length;

  async function apply(): Promise<void> {
    setBusy(true);
    try {
      const entries = await buildEntries(rows.filter((row) => row.status === 'ready'), locale, section);
      applyImport(locale, section, entries);
      notifications.show({ color: 'teal', title: 'Добавлено в черновик', message: `${entries.length} шт. Проверьте названия, добавьте обложки и опубликуйте.` });
      closeBulkImport();
    } catch (error) {
      notifications.show({ color: 'red', title: 'Не удалось добавить', message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal opened={target !== null} onClose={closeBulkImport} size="xl" title={
      <Group gap="xs"><Text fw={700}>Массовая загрузка</Text><LocaleBadge code={locale} /><Text c="dimmed" size="sm">{SECTION_LABEL[section]}</Text></Group>
    }>
      <Stack gap="md">
        <Tabs value={tab} onChange={(value) => value && setTab(value as BulkImportMode)}>
          <Tabs.List>
            <Tabs.Tab value="files" leftSection={<IconUpload size={14} />}>MP3-файлы</Tabs.Tab>
            <Tabs.Tab value="links" leftSection={<IconLink size={14} />}>По ссылке</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="files" pt="sm">
            <Dropzone onDrop={addFiles} accept={{ 'audio/mpeg': ['.mp3'], 'audio/mp3': ['.mp3'] }} multiple>
              <Group justify="center" gap="md" mih={90} style={{ pointerEvents: 'none' }}>
                <IconUpload size={32} />
                <Stack gap={2}>
                  <Text fw={600}>Перетащите MP3-файлы сюда</Text>
                  <Text size="sm" c="dimmed">Номер в начале имени («12. Название.mp3») сопоставит файл со сказкой №12 или с переводом №12 из базового гео.</Text>
                </Stack>
              </Group>
            </Dropzone>
          </Tabs.Panel>
          <Tabs.Panel value="links" pt="sm">
            {/* Mounted only on this tab: on the website it contacts the helper, which may trigger a browser permission prompt. */}
            {tab === 'links' && <LinkImportPanel onFound={addLinks} />}
          </Tabs.Panel>
        </Tabs>
        {rejected.length > 0 && <Alert color="red" title="Пропущены файлы">{rejected.map((r) => <Text key={r} size="sm">{r}</Text>)}</Alert>}
        {rows.length > 0 && (
          <ScrollArea.Autosize mah={420}>
            <Table verticalSpacing={6} striped>
              <Table.Thead>
                <Table.Tr><Table.Th>Источник</Table.Th><Table.Th>Куда</Table.Th><Table.Th>Название</Table.Th><Table.Th /></Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((row) => <ImportRow key={row.key} row={row} options={options} onPatch={patchRow} onRemove={removeRow} />)}
              </Table.Tbody>
            </Table>
          </ScrollArea.Autosize>
        )}
        <Group justify="space-between">
          <Text size="sm" c="dimmed">{footerText(rows.length, ready, pending, failed)}</Text>
          <Group gap="xs">
            <Button variant="default" onClick={closeBulkImport}>Отмена</Button>
            <Button onClick={() => void apply()} loading={busy} disabled={ready === 0 || pending > 0}>Добавить в черновик</Button>
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
    const { file } = row;
    if (!file) continue;
    const existing = row.target !== 'new' ? doc?.[section].find((item) => item.uid === row.target) : undefined;
    const refId = row.ref && !doc?.[section].some((item) => item.id === row.ref?.id) ? row.ref.id : '';
    const title = row.title.trim() || titleFromFileName(file.name);
    const id = existing?.id || refId || uniqueSlug(slugify(title) || 'story', taken);
    taken.add(id);
    const audioPath = await audioUploadPath(config, section, locale, id, file);
    await stageUpload(file, audioPath);
    entries.push({
      mode: existing ? 'replace' : 'new',
      targetUid: existing?.uid ?? null,
      ref: row.ref,
      id,
      title,
      audioPath,
      duration: (await readAudioDuration(file)) ?? row.link?.duration ?? null,
      ...(row.link ? { source: row.link.url } : {}),
    });
  }
  return entries;
}
