import { useEffect, useState } from 'react';
import { ActionIcon, Badge, Button, Checkbox, Group, Modal, Paper, Select, Stack, Switch, TagsInput, Text, TextInput } from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import type { CustomField, CustomFieldType } from '../../core/types.ts';
import { isValidCustomFieldKey } from '../../core/config.ts';
import { useAppStore } from '../../store/appStore.ts';
import { deleteCustomField, upsertCustomField } from '../../store/actions.ts';
import { EmptyState } from '../common/common.tsx';

const TYPE_LABELS: Record<CustomFieldType, string> = {
  text: 'Строка', textarea: 'Текст', number: 'Число', boolean: 'Да / нет', select: 'Выбор из списка', date: 'Дата', url: 'Ссылка',
};

const EMPTY: CustomField = { key: '', label: '', type: 'boolean', options: [], shared: true, showInList: false };

function FieldModal({ field, opened, onClose }: { field: CustomField | null; opened: boolean; onClose: () => void }) {
  const fields = useAppStore((s) => s.work.config.customFields);
  const [draft, setDraft] = useState<CustomField>(EMPTY);
  useEffect(() => {
    if (opened) setDraft(field ?? EMPTY);
  }, [opened, field]);
  const keyTaken = fields.some((f) => f.key === draft.key && f.key !== field?.key);
  const keyError = draft.key && !isValidCustomFieldKey(draft.key) ? 'Латиница и цифры, начинается с буквы (например isPremium)' : keyTaken ? 'Такое поле уже есть' : null;
  const canSave = Boolean(draft.key && draft.label.trim()) && !keyError && (draft.type !== 'select' || draft.options.length > 0);

  const save = (): void => {
    if (!canSave) return;
    upsertCustomField({ ...draft, label: draft.label.trim() }, field?.key);
    onClose();
  };

  return (
    <Modal opened={opened} onClose={onClose} title={<Text fw={700}>{field ? 'Поле' : 'Новое поле'}</Text>}>
      <Stack gap="sm">
        <TextInput label="Название в панели" placeholder="Премиум" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.currentTarget.value })} />
        <TextInput label="Ключ в JSON" description="Так поле будет называться в файле — его прочитает приложение" placeholder="isPremium"
          value={draft.key} error={keyError} onChange={(e) => setDraft({ ...draft, key: e.currentTarget.value.trim() })} />
        <Select label="Тип" data={Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }))} value={draft.type} allowDeselect={false}
          onChange={(value) => setDraft({ ...draft, type: (value as CustomFieldType) ?? 'text' })} />
        {draft.type === 'select' && (
          <TagsInput label="Варианты" description="Enter после каждого" value={[...draft.options]} onChange={(options) => setDraft({ ...draft, options })} />
        )}
        <Switch label="Общее для всех гео" description="В редакторе можно применить значение сразу ко всем переводам" checked={draft.shared}
          onChange={(e) => setDraft({ ...draft, shared: e.currentTarget.checked })} />
        <Switch label="Показывать в списке сказок" checked={draft.showInList} onChange={(e) => setDraft({ ...draft, showInList: e.currentTarget.checked })} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Отмена</Button>
          <Button onClick={save} disabled={!canSave}>Сохранить</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function confirmDeleteField(field: CustomField): void {
  const option = { removeValues: true };
  modals.openConfirmModal({
    title: `Удалить поле «${field.label}»?`,
    children: (
      <Checkbox defaultChecked label={`Удалить и значения «${field.key}» из всех сказок`} onChange={(e) => {
        option.removeValues = e.currentTarget.checked;
      }} />
    ),
    labels: { confirm: 'Удалить', cancel: 'Отмена' },
    confirmProps: { color: 'red' },
    onConfirm: () => deleteCustomField(field.key, option.removeValues),
  });
}

export function FieldsSettings() {
  const fields = useAppStore((s) => s.work.config.customFields);
  const [editing, setEditing] = useState<CustomField | null>(null);
  const [open, setOpen] = useState(false);
  const openModal = (field: CustomField | null): void => {
    setEditing(field);
    setOpen(true);
  };
  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Text size="sm" c="dimmed">Свои поля появятся в редакторе каждой сказки и запишутся в JSON. Например: «Премиум» (isPremium), «Возраст» (age), «Сезон» (season).</Text>
        <Button leftSection={<IconPlus size={16} />} onClick={() => openModal(null)}>Новое поле</Button>
      </Group>
      {fields.length === 0 ? (
        <EmptyState title="Своих полей пока нет" description="Добавьте поле — и приложение сможет, например, отмечать платные сказки без обновления панели." />
      ) : (
        <Stack gap={6}>
          {fields.map((field) => (
            <Paper key={field.key} withBorder p="sm" radius="md">
              <Group justify="space-between" wrap="nowrap">
                <Group gap="sm">
                  <Text fw={600}>{field.label}</Text>
                  <Badge variant="light">{TYPE_LABELS[field.type]}</Badge>
                  <Text size="xs" c="dimmed" className="mono">{field.key}</Text>
                  {field.shared && <Badge variant="outline" size="xs">общее</Badge>}
                  {field.showInList && <Badge variant="outline" size="xs" color="gray">в списке</Badge>}
                </Group>
                <Group gap={4}>
                  <ActionIcon variant="subtle" aria-label="Изменить" onClick={() => openModal(field)}><IconPencil size={16} /></ActionIcon>
                  <ActionIcon variant="subtle" color="red" aria-label="Удалить" onClick={() => confirmDeleteField(field)}><IconTrash size={16} /></ActionIcon>
                </Group>
              </Group>
            </Paper>
          ))}
        </Stack>
      )}
      <FieldModal field={editing} opened={open} onClose={() => setOpen(false)} />
    </Stack>
  );
}
