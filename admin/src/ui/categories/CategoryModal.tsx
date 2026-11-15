import { useEffect, useState } from 'react';
import { Button, ColorInput, Group, Modal, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import type { Category } from '../../core/types.ts';
import { isValidId, slugify, uniqueSlug } from '../../core/slug.ts';
import { useAppStore } from '../../store/appStore.ts';
import { upsertCategory } from '../../store/actions.ts';

const SWATCHES = ['#7c6cf2', '#e64980', '#f76707', '#f59f00', '#37b24d', '#1098ad', '#4263eb', '#868e96'];

interface Props {
  readonly opened: boolean;
  readonly onClose: () => void;
  /** null creates a new category. */
  readonly category: Category | null;
  readonly onSaved?: (id: string) => void;
}

export function CategoryModal({ opened, onClose, category, onSaved }: Props) {
  const config = useAppStore((s) => s.work.config);
  const [names, setNames] = useState<Record<string, string>>({});
  const [icon, setIcon] = useState('');
  const [color, setColor] = useState(SWATCHES[0]);
  const [id, setId] = useState('');
  const [idTouched, setIdTouched] = useState(false);

  useEffect(() => {
    if (!opened) return;
    setNames({ ...(category?.names ?? {}) });
    setIcon(category?.icon ?? '');
    setColor(category?.color ?? SWATCHES[config.categories.length % SWATCHES.length]);
    setId(category?.id ?? '');
    setIdTouched(Boolean(category));
  }, [opened, category, config.categories.length]);

  const reference = config.settings.referenceLocale;
  const firstName = names[reference] || names.en || Object.values(names).find(Boolean) || '';
  const taken = new Set(config.categories.map((c) => c.id).filter((c) => c !== category?.id));
  const autoId = uniqueSlug(slugify(firstName) || 'category', taken);
  const finalId = idTouched ? id : autoId;
  const idError = !isValidId(finalId) ? 'Латиница, цифры и дефис' : taken.has(finalId) ? 'Такая категория уже есть' : null;
  const canSave = Boolean(firstName.trim()) && !idError;

  const save = (): void => {
    if (!canSave) return;
    const cleanNames = Object.fromEntries(Object.entries(names).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
    upsertCategory({ id: finalId, icon: icon.trim(), color, names: cleanNames }, category?.id);
    onSaved?.(finalId);
    onClose();
  };

  return (
    <Modal opened={opened} onClose={onClose} title={<Text fw={700}>{category ? 'Категория' : 'Новая категория'}</Text>} size="lg">
      <Stack gap="sm">
        <Text size="sm" c="dimmed">Название на каждом языке — приложение покажет его пользователям своего гео.</Text>
        <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="xs">
          {config.locales.map((locale) => (
            <TextInput key={locale.code} label={`${locale.code.toUpperCase()} · ${locale.label}`} value={names[locale.code] ?? ''}
              onChange={(e) => {
                const value = e.currentTarget.value;
                setNames((current) => ({ ...current, [locale.code]: value }));
              }} />
          ))}
        </SimpleGrid>
        <Group grow align="flex-start">
          <TextInput label="Иконка (эмодзи)" placeholder="🐾" value={icon} maxLength={8} onChange={(e) => setIcon(e.currentTarget.value)} />
          <ColorInput label="Цвет" value={color} onChange={setColor} swatches={SWATCHES} format="hex" />
          <TextInput label="ID" description="Для приложения" value={finalId} error={idError}
            onChange={(e) => {
              setIdTouched(true);
              setId(e.currentTarget.value.trim().toLowerCase());
            }} />
        </Group>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Отмена</Button>
          <Button onClick={save} disabled={!canSave}>Сохранить</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
