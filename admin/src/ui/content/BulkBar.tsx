import { useState } from 'react';
import { Button, Group, MultiSelect, Paper, Popover, Stack, Text } from '@mantine/core';
import { IconArrowBarToDown, IconArrowBarToUp, IconCategory, IconEye, IconEyeOff, IconTrash } from '@tabler/icons-react';
import type { Section } from '../../core/types.ts';
import { categoryName } from '../../core/serialize.ts';
import { useAppStore } from '../../store/appStore.ts';
import { changeCategories, deleteItems, moveItemsToEdge, setItemsHidden } from '../../store/actions.ts';
import { confirmDelete } from '../changes/publishFlow.tsx';
import { pluralRu } from '../hooks.ts';

interface Props {
  readonly locale: string;
  readonly section: Section;
  readonly selected: readonly string[];
  readonly total: number;
  readonly onSelectAll: () => void;
  readonly onClear: () => void;
}

export function BulkBar({ locale, section, selected, total, onSelectAll, onClear }: Props) {
  const config = useAppStore((s) => s.work.config);
  const [add, setAdd] = useState<string[]>([]);
  const [remove, setRemove] = useState<string[]>([]);
  const [opened, setOpened] = useState(false);
  const options = config.categories.map((c) => ({ value: c.id, label: `${c.icon} ${categoryName(c, locale, config.settings.referenceLocale)}`.trim() }));
  const count = selected.length;

  const applyCategories = (): void => {
    changeCategories(locale, selected, add, remove);
    setAdd([]);
    setRemove([]);
    setOpened(false);
  };

  return (
    <Paper withBorder p="xs" radius="md" bg="var(--mantine-color-violet-light)">
      <Group gap="xs" wrap="wrap">
        <Text size="sm" fw={600}>Выбрано: {count} {pluralRu(count, 'сказка', 'сказки', 'сказок')}</Text>
        {count < total && <Button size="compact-sm" variant="subtle" onClick={onSelectAll}>Выбрать все ({total})</Button>}
        <Popover opened={opened} onChange={setOpened} width={320} position="bottom-start" withinPortal>
          <Popover.Target>
            <Button size="compact-sm" variant="default" leftSection={<IconCategory size={14} />} onClick={() => setOpened((o) => !o)} disabled={options.length === 0}>
              Категории
            </Button>
          </Popover.Target>
          <Popover.Dropdown>
            <Stack gap="xs">
              <MultiSelect label="Добавить" data={options} value={add} onChange={setAdd} searchable comboboxProps={{ withinPortal: false }} />
              <MultiSelect label="Убрать" data={options} value={remove} onChange={setRemove} searchable comboboxProps={{ withinPortal: false }} />
              <Button size="xs" onClick={applyCategories} disabled={add.length === 0 && remove.length === 0}>Применить</Button>
            </Stack>
          </Popover.Dropdown>
        </Popover>
        <Button size="compact-sm" variant="default" leftSection={<IconEyeOff size={14} />} onClick={() => setItemsHidden(locale, selected, true)}>Скрыть</Button>
        <Button size="compact-sm" variant="default" leftSection={<IconEye size={14} />} onClick={() => setItemsHidden(locale, selected, false)}>Показать</Button>
        <Button size="compact-sm" variant="default" leftSection={<IconArrowBarToUp size={14} />} onClick={() => moveItemsToEdge(locale, section, selected, 'top')}>В начало</Button>
        <Button size="compact-sm" variant="default" leftSection={<IconArrowBarToDown size={14} />} onClick={() => moveItemsToEdge(locale, section, selected, 'bottom')}>В конец</Button>
        <Button size="compact-sm" color="red" variant="light" leftSection={<IconTrash size={14} />}
          onClick={() => confirmDelete(count, (withFiles) => {
            deleteItems(locale, selected, withFiles);
            onClear();
          })}>
          Удалить
        </Button>
        <Button size="compact-sm" variant="subtle" color="gray" onClick={onClear}>Снять выделение</Button>
      </Group>
    </Paper>
  );
}
