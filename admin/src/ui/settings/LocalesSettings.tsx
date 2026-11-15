import { useState } from 'react';
import { ActionIcon, Alert, Autocomplete, Button, Checkbox, Group, Modal, Paper, Radio, Select, Stack, Table, Text, TextInput, Tooltip } from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconArrowDown, IconArrowUp, IconPlus, IconTrash } from '@tabler/icons-react';
import { KNOWN_LOCALE_LABELS, isLocaleCode, localeLabel } from '../../core/config.ts';
import { useAppStore } from '../../store/appStore.ts';
import { addLocale, moveLocale, removeLocale, updateLocale, updateSettings } from '../../store/actions.ts';
import { LocaleBadge } from '../common/common.tsx';

function AddLocaleModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const config = useAppStore((s) => s.work.config);
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [copyFrom, setCopyFrom] = useState<string | null>(config.settings.referenceLocale);
  const existing = new Set(config.locales.map((l) => l.code));
  const trimmed = code.trim();
  const error = !trimmed ? null : !isLocaleCode(trimmed) ? 'Код вида ru, en, pt-BR, es-419' : existing.has(trimmed) ? 'Такое гео уже есть' : null;

  const save = (): void => {
    if (!trimmed || error) return;
    addLocale(trimmed, label.trim() || localeLabel(trimmed), copyFrom);
    setCode('');
    setLabel('');
    onClose();
  };

  return (
    <Modal opened={opened} onClose={onClose} title={<Text fw={700}>Новое гео</Text>}>
      <Stack gap="sm">
        <Autocomplete label="Код языка" placeholder="pl" data={Object.keys(KNOWN_LOCALE_LABELS).filter((c) => !existing.has(c))} value={code} error={error}
          onChange={(value) => {
            setCode(value);
            if (KNOWN_LOCALE_LABELS[value.trim()]) setLabel(KNOWN_LOCALE_LABELS[value.trim()]);
          }} />
        <TextInput label="Название" placeholder="Polski" value={label} onChange={(e) => setLabel(e.currentTarget.value)} />
        <Select label="Скопировать список сказок из" description="Обложки, категории и порядок. Сказки будут скрыты, пока не загрузите аудио (удобно через «Массовая загрузка»)."
          data={[{ value: '', label: 'Ничего — пустое гео' }, ...config.locales.map((l) => ({ value: l.code, label: `${l.code.toUpperCase()} · ${l.label}` }))]}
          value={copyFrom ?? ''} onChange={(value) => setCopyFrom(value || null)} allowDeselect={false} />
        <Alert color="yellow" variant="light">
          Приложение должно знать о новом гео: попросите разработчика загружать файл <code>{trimmed || 'код'}.json</code> для этого языка.
        </Alert>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Отмена</Button>
          <Button onClick={save} disabled={!trimmed || Boolean(error)}>Добавить</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function confirmRemove(code: string, label: string): void {
  const option = { deleteFile: false };
  modals.openConfirmModal({
    title: `Убрать гео «${label}»?`,
    children: (
      <Stack gap="sm">
        <Text size="sm">Гео пропадёт из панели. Если удалить и файл {code}.json, приложение перестанет получать сказки для этого языка.</Text>
        <Checkbox label={`Удалить файл ${code}.json из репозитория`} onChange={(e) => {
          option.deleteFile = e.currentTarget.checked;
        }} />
      </Stack>
    ),
    labels: { confirm: 'Убрать', cancel: 'Отмена' },
    confirmProps: { color: 'red' },
    onConfirm: () => removeLocale(code, option.deleteFile),
  });
}

export function LocalesSettings() {
  const config = useAppStore((s) => s.work.config);
  const docs = useAppStore((s) => s.work.docs);
  const [adding, setAdding] = useState(false);
  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Text size="sm" c="dimmed">Каждое гео — отдельный файл <code>код.json</code> в корне репозитория. Базовое гео задаёт порядок в матрице и источник для копирования.</Text>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setAdding(true)}>Добавить гео</Button>
      </Group>
      <Paper withBorder radius="md">
        <Radio.Group value={config.settings.referenceLocale} onChange={(value) => updateSettings({ referenceLocale: value })}>
          <Table verticalSpacing={6}>
            <Table.Thead>
              <Table.Tr><Table.Th>Гео</Table.Th><Table.Th>Название в панели</Table.Th><Table.Th>Сказок</Table.Th><Table.Th>Базовое</Table.Th><Table.Th /></Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {config.locales.map((locale, index) => (
                <Table.Tr key={locale.code}>
                  <Table.Td><LocaleBadge code={locale.code} /></Table.Td>
                  <Table.Td>
                    <TextInput size="xs" defaultValue={locale.label} key={locale.label}
                      onBlur={(e) => e.currentTarget.value.trim() && e.currentTarget.value.trim() !== locale.label && updateLocale(locale.code, e.currentTarget.value.trim())} />
                  </Table.Td>
                  <Table.Td><Text size="sm">{docs[locale.code] ? `${docs[locale.code].stories.length} + ${docs[locale.code].lullabies.length}` : 'файл не читается'}</Text></Table.Td>
                  <Table.Td><Radio value={locale.code} aria-label="Базовое гео" /></Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="nowrap" justify="flex-end">
                      <ActionIcon variant="subtle" disabled={index === 0} onClick={() => moveLocale(locale.code, -1)} aria-label="Выше"><IconArrowUp size={16} /></ActionIcon>
                      <ActionIcon variant="subtle" disabled={index === config.locales.length - 1} onClick={() => moveLocale(locale.code, 1)} aria-label="Ниже"><IconArrowDown size={16} /></ActionIcon>
                      <Tooltip label="Убрать гео"><ActionIcon variant="subtle" color="red" onClick={() => confirmRemove(locale.code, locale.label)} aria-label="Убрать"><IconTrash size={16} /></ActionIcon></Tooltip>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Radio.Group>
      </Paper>
      <AddLocaleModal opened={adding} onClose={() => setAdding(false)} />
    </Stack>
  );
}
