import { useMemo, useState } from 'react';
import { ActionIcon, Badge, Button, Card, FileButton, Group, Paper, SegmentedControl, SimpleGrid, Stack, Table, Tabs, Text, TextInput, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconSearch, IconTrash, IconUpload } from '@tabler/icons-react';
import { SECTIONS } from '../../core/types.ts';
import { basename, buildMediaPath, formatBytes, imageDir, isAudioPath, isImagePath, isUnderRoots, mediaRoots } from '../../core/paths.ts';
import { slugify } from '../../core/slug.ts';
import { errorMessage, useAppStore } from '../../store/appStore.ts';
import { deleteFiles } from '../../store/actions.ts';
import { selectEffectiveFiles } from '../../store/selectors.ts';
import { stageUpload } from '../../store/uploads.ts';
import { processImage, validateImageFile } from '../../media/media.ts';
import { shortHash } from '../../github/encoding.ts';
import { Cover, PageTitle, PlayButton } from '../common/common.tsx';
import { useCoverUsage } from './ImagePickerModal.tsx';

const collator = new Intl.Collator('en', { numeric: true });

function useAudioUsage(): Map<string, string[]> {
  const docs = useAppStore((s) => s.work.docs);
  return useMemo(() => {
    const usage = new Map<string, string[]>();
    for (const doc of Object.values(docs)) {
      for (const section of SECTIONS) {
        for (const item of doc[section]) {
          if (item.audioPath) usage.set(item.audioPath, [...(usage.get(item.audioPath) ?? []), `${doc.code.toUpperCase()}: ${item.title}`]);
        }
      }
    }
    return usage;
  }, [docs]);
}

async function uploadCovers(files: File[]): Promise<number> {
  const { config } = useAppStore.getState().work;
  let count = 0;
  for (const file of files) {
    const problem = validateImageFile(file);
    if (problem) {
      notifications.show({ color: 'red', message: `${file.name}: ${problem}` });
      continue;
    }
    const processed = await processImage(file, config.settings.media);
    const stem = slugify(file.name.replace(/\.[^.]+$/, '')) || 'cover';
    const path = buildMediaPath(imageDir(config, 'stories'), stem, await shortHash(processed), processed.type === 'image/png' ? 'png' : 'jpg');
    await stageUpload(processed, path, { keep: true });
    count += 1;
  }
  return count;
}

export function MediaPage() {
  const files = useAppStore(selectEffectiveFiles);
  const config = useAppStore((s) => s.work.config);
  const covers = useCoverUsage();
  const audio = useAudioUsage();
  const [tab, setTab] = useState<string | null>('images');
  const [filter, setFilter] = useState<'all' | 'unused'>('all');
  const [query, setQuery] = useState('');
  const roots = mediaRoots(config);
  const needle = query.trim().toLowerCase();
  const all = useMemo(() => [...files.keys()].filter((p) => isUnderRoots(p, roots)).sort(collator.compare), [files, roots.join()]);
  const images = all.filter(isImagePath).filter((p) => (filter === 'all' || !covers.has(p)) && (!needle || p.toLowerCase().includes(needle)));
  const tracks = all.filter(isAudioPath).filter((p) => (filter === 'all' || !audio.has(p)) && (!needle || p.toLowerCase().includes(needle)));
  const totalSize = all.reduce((sum, p) => sum + (files.get(p)?.size ?? 0), 0);

  const onUpload = (picked: File[]): void => {
    uploadCovers(picked).then(
      (count) => count > 0 && notifications.show({ color: 'teal', message: `Загружено обложек: ${count}. Они появятся в выборе обложки.` }),
      (error: unknown) => notifications.show({ color: 'red', message: errorMessage(error) }),
    );
  };

  return (
    <Stack gap="md">
      <PageTitle title="Медиатека" description={`Все обложки и аудио в репозитории: ${all.length} файлов, ${formatBytes(totalSize)}.`}
        right={<FileButton onChange={onUpload} accept="image/*" multiple>{(props) => <Button {...props} leftSection={<IconUpload size={16} />}>Загрузить обложки</Button>}</FileButton>} />
      <Group gap="sm">
        <TextInput placeholder="Поиск по имени файла" leftSection={<IconSearch size={16} />} value={query} onChange={(e) => setQuery(e.currentTarget.value)} w={280} />
        <SegmentedControl value={filter} onChange={(v) => setFilter(v as 'all' | 'unused')} data={[{ value: 'all', label: 'Все' }, { value: 'unused', label: 'Не используются' }]} />
      </Group>
      <Tabs value={tab} onChange={setTab}>
        <Tabs.List>
          <Tabs.Tab value="images">Обложки ({images.length})</Tabs.Tab>
          <Tabs.Tab value="audio">Аудио ({tracks.length})</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="images" pt="md">
          <SimpleGrid cols={{ base: 2, xs: 3, sm: 4, md: 6 }} spacing="sm">
            {images.map((path) => (
              <Card key={path} withBorder padding={6} radius="md">
                <Cover path={path} size={150} radius={6} />
                <Text size="xs" mt={4} truncate title={path}>{basename(path)}</Text>
                <Group justify="space-between" gap={4} wrap="nowrap">
                  {covers.has(path)
                    ? <Tooltip label={covers.get(path)!.join('\n')} multiline maw={300}><Badge size="xs" variant="light">{covers.get(path)!.length} исп.</Badge></Tooltip>
                    : <Badge size="xs" variant="light" color="gray">свободна</Badge>}
                  {!covers.has(path) && !files.get(path)?.pending && (
                    <ActionIcon size="sm" variant="subtle" color="red" aria-label="Удалить" onClick={() => deleteFiles([path])}><IconTrash size={14} /></ActionIcon>
                  )}
                </Group>
              </Card>
            ))}
          </SimpleGrid>
        </Tabs.Panel>
        <Tabs.Panel value="audio" pt="md">
          <Paper withBorder radius="md">
            <Table striped highlightOnHover verticalSpacing={6}>
              <Table.Thead><Table.Tr><Table.Th>Файл</Table.Th><Table.Th>Размер</Table.Th><Table.Th>Используется</Table.Th><Table.Th /></Table.Tr></Table.Thead>
              <Table.Tbody>
                {tracks.map((path) => (
                  <Table.Tr key={path}>
                    <Table.Td><Text size="sm" className="mono">{path}</Text></Table.Td>
                    <Table.Td><Text size="sm">{formatBytes(files.get(path)?.size ?? 0)}</Text></Table.Td>
                    <Table.Td>{audio.has(path) ? <Text size="xs" c="dimmed" lineClamp={2}>{audio.get(path)!.join(', ')}</Text> : <Badge size="xs" color="gray" variant="light">нигде</Badge>}</Table.Td>
                    <Table.Td>
                      <Group gap={4} wrap="nowrap">
                        <PlayButton path={path} title={basename(path)} cover="" />
                        {!audio.has(path) && !files.get(path)?.pending && (
                          <ActionIcon variant="subtle" color="red" aria-label="Удалить" onClick={() => deleteFiles([path])}><IconTrash size={14} /></ActionIcon>
                        )}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Paper>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
