import { useMemo, useState } from 'react';
import { Badge, Card, Group, Modal, ScrollArea, SegmentedControl, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { basename, isImagePath } from '../../core/paths.ts';
import { SECTIONS } from '../../core/types.ts';
import { useAppStore } from '../../store/appStore.ts';
import { selectEffectiveFiles } from '../../store/selectors.ts';
import { Cover } from '../common/common.tsx';

const collator = new Intl.Collator('en', { numeric: true });

/** path → titles of the items that use it as a cover. */
export function useCoverUsage(): Map<string, string[]> {
  const docs = useAppStore((s) => s.work.docs);
  return useMemo(() => {
    const usage = new Map<string, string[]>();
    for (const doc of Object.values(docs)) {
      for (const section of SECTIONS) {
        for (const item of doc[section]) {
          if (item.imagePath) usage.set(item.imagePath, [...(usage.get(item.imagePath) ?? []), `${doc.code.toUpperCase()}: ${item.title}`]);
        }
      }
    }
    return usage;
  }, [docs]);
}

export function ImagePickerModal({ opened, onClose, onPick }: { opened: boolean; onClose: () => void; onPick: (path: string) => void }) {
  const files = useAppStore(selectEffectiveFiles);
  const usage = useCoverUsage();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'unused'>('all');
  const images = useMemo(() => [...files.keys()].filter(isImagePath).sort(collator.compare), [files]);
  const needle = query.trim().toLowerCase();
  const shown = images.filter((path) =>
    (!needle || path.toLowerCase().includes(needle) || (usage.get(path) ?? []).some((t) => t.toLowerCase().includes(needle))) &&
    (filter === 'all' || !usage.has(path)));

  return (
    <Modal opened={opened} onClose={onClose} size="xl" title={<Text fw={700}>Выберите обложку</Text>}>
      <Stack gap="sm">
        <Group gap="sm" wrap="wrap">
          <TextInput placeholder="Поиск по имени файла или названию сказки" leftSection={<IconSearch size={16} />} value={query}
            onChange={(e) => setQuery(e.currentTarget.value)} style={{ flex: 1 }} data-autofocus />
          <SegmentedControl value={filter} onChange={(v) => setFilter(v as 'all' | 'unused')} data={[{ value: 'all', label: 'Все' }, { value: 'unused', label: 'Свободные' }]} />
        </Group>
        <ScrollArea.Autosize mah="65vh">
          <SimpleGrid cols={{ base: 2, xs: 3, sm: 4, md: 5 }} spacing="sm">
            {shown.map((path) => (
              <Card key={path} withBorder padding={6} radius="md" className="media-tile" onClick={() => onPick(path)}>
                <Cover path={path} size={140} radius={6} />
                <Text size="xs" mt={4} truncate title={path}>{basename(path)}</Text>
                {usage.has(path)
                  ? <Text size="xs" c="dimmed" truncate title={usage.get(path)!.join('\n')}>{usage.get(path)![0]}{usage.get(path)!.length > 1 ? ` +${usage.get(path)!.length - 1}` : ''}</Text>
                  : <Badge size="xs" variant="light" color="gray">не используется</Badge>}
              </Card>
            ))}
          </SimpleGrid>
          {shown.length === 0 && <Text c="dimmed" ta="center" py="xl">Ничего не найдено</Text>}
        </ScrollArea.Autosize>
      </Stack>
    </Modal>
  );
}
