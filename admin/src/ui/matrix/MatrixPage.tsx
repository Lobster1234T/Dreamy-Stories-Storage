import { useMemo, useState } from 'react';
import { ActionIcon, Group, Paper, ScrollArea, Stack, Switch, Table, Tabs, Text, TextInput, Tooltip } from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconEyeOff, IconPlus, IconSearch } from '@tabler/icons-react';
import type { Section } from '../../core/types.ts';
import { SECTION_LABEL } from '../../core/types.ts';
import { buildMatrix } from '../../core/matrix.ts';
import type { MatrixCell, MatrixRow } from '../../core/matrix.ts';
import { normalizeForSearch } from '../../core/sorting.ts';
import { useAppStore } from '../../store/appStore.ts';
import { selectEffectiveFiles } from '../../store/selectors.ts';
import { openEditor } from '../../store/uiStore.ts';
import { navigate } from '../router.ts';
import { Cover, LocaleBadge, PageTitle } from '../common/common.tsx';

function Cell({ row, locale, section, cell, files, reference }: {
  row: MatrixRow;
  locale: string;
  section: Section;
  cell: MatrixCell | undefined;
  files: ReadonlyMap<string, unknown>;
  reference: MatrixCell | undefined;
}) {
  if (!cell) {
    const source = reference ?? Object.values(row.cells).find(Boolean);
    const prefill = source ? {
      id: row.id.startsWith('__no-id__') ? '' : row.id,
      title: source.item.title,
      description: source.item.description,
      imagePath: source.item.imagePath,
      categories: source.item.categories,
      ...(section === 'lullabies' ? { audioPath: source.item.audioPath, duration: source.item.duration } : {}),
    } : {};
    return (
      <Tooltip label={`Добавить в ${locale.toUpperCase()}`}>
        <ActionIcon variant="default" size="md" aria-label={`Добавить в ${locale}`} style={{ borderStyle: 'dashed' }}
          onClick={() => openEditor({ locale, section, uid: null, prefill, position: source?.index })}>
          <IconPlus size={14} />
        </ActionIcon>
      </Tooltip>
    );
  }
  const broken = !cell.item.audioPath || !files.has(cell.item.audioPath);
  const color = broken ? 'red' : cell.item.hidden ? 'gray' : 'teal';
  const Icon = broken ? IconAlertTriangle : cell.item.hidden ? IconEyeOff : IconCheck;
  return (
    <Tooltip label={`${cell.index + 1}. ${cell.item.title}${broken ? ' — нет аудио' : cell.item.hidden ? ' — скрыта' : ''}`}>
      <ActionIcon variant="light" color={color} size="md" aria-label={cell.item.title}
        onClick={() => openEditor({ locale, section, uid: cell.item.uid })}>
        <Icon size={14} />
      </ActionIcon>
    </Tooltip>
  );
}

export function MatrixPage({ section }: { section: Section }) {
  const docs = useAppStore((s) => s.work.docs);
  const config = useAppStore((s) => s.work.config);
  const files = useAppStore(selectEffectiveFiles);
  const [onlyGaps, setOnlyGaps] = useState(false);
  const [query, setQuery] = useState('');
  const localeKey = config.locales.map((l) => l.code).filter((code) => docs[code]).join(',');
  const locales = useMemo(() => localeKey.split(',').filter(Boolean), [localeKey]);
  const reference = config.settings.referenceLocale;
  const rows = useMemo(() => buildMatrix(docs, locales, reference, section), [docs, locales, reference, section]);
  const needle = normalizeForSearch(query.trim());
  const shown = rows.filter((row) =>
    (!onlyGaps || row.presentIn < locales.length) &&
    (!needle || Object.values(row.cells).some((cell) => cell && normalizeForSearch(cell.item.title).includes(needle))));

  return (
    <Stack gap="md">
      <PageTitle title="Матрица переводов" description="Строка — сказка, столбец — гео. Нажмите «+», чтобы добавить недостающий перевод: обложка и категории подставятся." />
      <Tabs value={section} onChange={(value) => value && navigate({ page: 'matrix', section: value as Section })}>
        <Tabs.List>
          <Tabs.Tab value="stories">{SECTION_LABEL.stories}</Tabs.Tab>
          <Tabs.Tab value="lullabies">{SECTION_LABEL.lullabies}</Tabs.Tab>
        </Tabs.List>
      </Tabs>
      <Group gap="md">
        <TextInput placeholder="Поиск" leftSection={<IconSearch size={16} />} value={query} onChange={(e) => setQuery(e.currentTarget.value)} w={280} />
        <Switch label="Только с пропусками" checked={onlyGaps} onChange={(e) => setOnlyGaps(e.currentTarget.checked)} />
        <Group gap={10}>
          <Group gap={4}><IconCheck size={14} color="var(--mantine-color-teal-6)" /><Text size="xs">есть</Text></Group>
          <Group gap={4}><IconEyeOff size={14} color="var(--mantine-color-gray-6)" /><Text size="xs">скрыта</Text></Group>
          <Group gap={4}><IconAlertTriangle size={14} color="var(--mantine-color-red-6)" /><Text size="xs">нет аудио</Text></Group>
        </Group>
      </Group>
      <Paper withBorder radius="md">
        <ScrollArea type="auto">
          <Table className="matrix-table" stickyHeader striped highlightOnHover verticalSpacing={4}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Сказка ({shown.length})</Table.Th>
                {locales.map((code) => (
                  <Table.Th key={code} ta="center">
                    <Stack gap={2} align="center">
                      <LocaleBadge code={code} />
                      <Text size="xs" c="dimmed">{rows.filter((r) => r.cells[code]).length}/{rows.length}</Text>
                    </Stack>
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {shown.map((row) => (
                <Table.Tr key={row.id}>
                  <Table.Td>
                    <Group gap="sm" wrap="nowrap">
                      <Cover path={row.imagePath} size={32} radius={6} />
                      <Text size="sm" truncate maw={320}>{row.title}</Text>
                    </Group>
                  </Table.Td>
                  {locales.map((code) => (
                    <Table.Td key={code} ta="center">
                      <Cell row={row} locale={code} section={section} cell={row.cells[code]} files={files} reference={row.cells[reference]} />
                    </Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Paper>
    </Stack>
  );
}
