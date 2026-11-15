import { useMemo, useState } from 'react';
import { ActionIcon, Badge, Button, ColorSwatch, Group, Paper, Stack, Text, Tooltip } from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconArrowDown, IconArrowUp, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import type { Category } from '../../core/types.ts';
import { SECTIONS } from '../../core/types.ts';
import { categoryName } from '../../core/serialize.ts';
import { useAppStore } from '../../store/appStore.ts';
import { deleteCategory, moveCategory } from '../../store/actions.ts';
import { EmptyState, PageTitle } from '../common/common.tsx';
import { CategoryModal } from './CategoryModal.tsx';

export function CategoriesPage() {
  const config = useAppStore((s) => s.work.config);
  const docs = useAppStore((s) => s.work.docs);
  const [editing, setEditing] = useState<Category | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const usage = useMemo(() => {
    const counts = new Map<string, Set<string>>();
    for (const doc of Object.values(docs)) {
      for (const section of SECTIONS) {
        for (const item of doc[section]) {
          for (const id of item.categories) counts.set(id, (counts.get(id) ?? new Set()).add(item.id || item.uid));
        }
      }
    }
    return counts;
  }, [docs]);
  const reference = config.settings.referenceLocale;
  const openModal = (category: Category | null): void => {
    setEditing(category);
    setModalOpen(true);
  };
  const remove = (category: Category): void => {
    modals.openConfirmModal({
      title: `Удалить категорию «${categoryName(category, reference, reference)}»?`,
      children: <Text size="sm">Она пропадёт у всех сказок во всех гео. До публикации можно отменить (Ctrl+Z).</Text>,
      labels: { confirm: 'Удалить', cancel: 'Отмена' },
      confirmProps: { color: 'red' },
      onConfirm: () => deleteCategory(category.id),
    });
  };

  return (
    <Stack gap="md">
      <PageTitle title="Категории" description="Категории общие для всех гео; название переводится. Приложение получает их в каждом файле гео в поле categories."
        right={<Button leftSection={<IconPlus size={16} />} onClick={() => openModal(null)}>Новая категория</Button>} />
      {config.categories.length === 0 ? (
        <EmptyState title="Категорий пока нет" description="Создайте, например, «Принцессы», «Животные», «Праздники» — и отмечайте ими сказки." />
      ) : (
        <Stack gap={6}>
          {config.categories.map((category, index) => (
            <Paper key={category.id} withBorder p="sm" radius="md">
              <Group justify="space-between" wrap="nowrap">
                <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                  <ColorSwatch color={category.color} size={18} />
                  <Text size="xl">{category.icon || '•'}</Text>
                  <Stack gap={0} style={{ minWidth: 0 }}>
                    <Text fw={600} truncate>{categoryName(category, 'ru', reference)}</Text>
                    <Text size="xs" c="dimmed" truncate>
                      {config.locales.map((l) => `${l.code.toUpperCase()}: ${category.names[l.code] || '—'}`).join(' · ')}
                    </Text>
                  </Stack>
                </Group>
                <Group gap={6} wrap="nowrap">
                  <Badge variant="light" color="gray">{usage.get(category.id)?.size ?? 0} сказок</Badge>
                  <Text size="xs" c="dimmed" className="mono" visibleFrom="sm">{category.id}</Text>
                  <ActionIcon variant="subtle" disabled={index === 0} onClick={() => moveCategory(category.id, -1)} aria-label="Выше"><IconArrowUp size={16} /></ActionIcon>
                  <ActionIcon variant="subtle" disabled={index === config.categories.length - 1} onClick={() => moveCategory(category.id, 1)} aria-label="Ниже"><IconArrowDown size={16} /></ActionIcon>
                  <Tooltip label="Изменить"><ActionIcon variant="subtle" onClick={() => openModal(category)} aria-label="Изменить"><IconPencil size={16} /></ActionIcon></Tooltip>
                  <Tooltip label="Удалить"><ActionIcon variant="subtle" color="red" onClick={() => remove(category)} aria-label="Удалить"><IconTrash size={16} /></ActionIcon></Tooltip>
                </Group>
              </Group>
            </Paper>
          ))}
        </Stack>
      )}
      <CategoryModal opened={modalOpen} onClose={() => setModalOpen(false)} category={editing} />
    </Stack>
  );
}
