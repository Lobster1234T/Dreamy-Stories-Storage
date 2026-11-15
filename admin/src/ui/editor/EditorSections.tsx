import { useMemo } from 'react';
import {
  Accordion,
  Autocomplete,
  Button,
  Checkbox,
  Code,
  Group,
  NumberInput,
  Paper,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core';
import { IconCheck, IconPlus } from '@tabler/icons-react';
import type { CustomField, Section } from '../../core/types.ts';
import { findById } from '../../core/ops.ts';
import { isAudioPath, isImagePath } from '../../core/paths.ts';
import { useAppStore } from '../../store/appStore.ts';
import type { ItemDraft, SyncFields } from '../../store/actions.ts';
import { selectEffectiveFiles } from '../../store/selectors.ts';
import { LocaleBadge } from '../common/common.tsx';

type Patch = (patch: Partial<ItemDraft>) => void;

function withValue(extra: Readonly<Record<string, unknown>>, key: string, value: unknown): Record<string, unknown> {
  const { [key]: _old, ...rest } = extra;
  return value === undefined || value === '' || value === null ? rest : { ...rest, [key]: value };
}

function CustomInput({ field, value, onChange }: { field: CustomField; value: unknown; onChange: (value: unknown) => void }) {
  const common = { label: field.label, description: field.shared ? 'Общее поле для всех гео' : undefined };
  switch (field.type) {
    case 'boolean':
      return <Switch {...common} checked={value === true} onChange={(e) => onChange(e.currentTarget.checked)} />;
    case 'number':
      return <NumberInput {...common} value={typeof value === 'number' ? value : ''} onChange={(v) => onChange(typeof v === 'number' ? v : undefined)} />;
    case 'select':
      return <Select {...common} data={[...field.options]} value={typeof value === 'string' ? value : null} onChange={(v) => onChange(v ?? undefined)} clearable />;
    case 'textarea':
      return <Textarea {...common} autosize minRows={2} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.currentTarget.value)} />;
    case 'date':
      return <TextInput {...common} type="date" value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.currentTarget.value)} />;
    default:
      return <TextInput {...common} type={field.type === 'url' ? 'url' : 'text'} value={value === undefined ? '' : String(value)} onChange={(e) => onChange(e.currentTarget.value)} />;
  }
}

export function CustomFieldInputs({ draft, onChange }: { draft: ItemDraft; onChange: Patch }) {
  const fields = useAppStore((s) => s.work.config.customFields);
  if (fields.length === 0) return null;
  return (
    <Paper withBorder p="sm" radius="md">
      <Text fw={600} size="sm" mb="xs">Дополнительные поля</Text>
      <Stack gap="xs">
        {fields.map((field) => (
          <CustomInput key={field.key} field={field} value={draft.extra[field.key]}
            onChange={(value) => onChange({ extra: withValue(draft.extra, field.key, value) })} />
        ))}
      </Stack>
    </Paper>
  );
}

export function TranslationsBlock({ locale, section, draft, onOpen, onCreate }: {
  locale: string;
  section: Section;
  draft: ItemDraft;
  onOpen: (locale: string, uid: string) => void;
  onCreate: (locale: string) => void;
}) {
  const docs = useAppStore((s) => s.work.docs);
  const locales = useAppStore((s) => s.work.config.locales);
  const present = useMemo(() => new Map(findById(docs, section, draft.id).map((x) => [x.locale, x.item])), [docs, section, draft.id]);
  if (!draft.id || locales.length < 2) return null;
  return (
    <Paper withBorder p="sm" radius="md">
      <Text fw={600} size="sm">Эта сказка в других гео</Text>
      <Text size="xs" c="dimmed" mb="xs">Связь по ID «{draft.id}». Нажмите, чтобы открыть перевод или добавить недостающий.</Text>
      <Group gap={6}>
        {locales.filter((l) => l.code !== locale && docs[l.code]).map((l) => {
          const item = present.get(l.code);
          return item ? (
            <Button key={l.code} size="compact-sm" variant="light" color="teal" leftSection={<IconCheck size={14} />} onClick={() => onOpen(l.code, item.uid)}>
              {l.code.toUpperCase()} · <Text span size="xs" truncate maw={140} ml={4}>{item.title}</Text>
            </Button>
          ) : (
            <Button key={l.code} size="compact-sm" variant="default" leftSection={<IconPlus size={14} />} onClick={() => onCreate(l.code)}>
              {l.code.toUpperCase()}
            </Button>
          );
        })}
      </Group>
    </Paper>
  );
}

export function SyncOptions({ section, draft, originalId, locale, sync, onChange }: {
  section: Section;
  draft: ItemDraft;
  originalId: string;
  locale: string;
  sync: SyncFields;
  onChange: (sync: SyncFields) => void;
}) {
  const docs = useAppStore((s) => s.work.docs);
  const allFields = useAppStore((s) => s.work.config.customFields);
  const fields = useMemo(() => allFields.filter((f) => f.shared), [allFields]);
  const others = findById(docs, section, originalId).filter((x) => x.locale !== locale);
  if (others.length === 0) return null;
  const toggleKey = (key: string, on: boolean): string[] => (on ? [...sync.customKeys, key] : sync.customKeys.filter((k) => k !== key));
  return (
    <Paper withBorder p="sm" radius="md">
      <Group gap={6} mb="xs">
        <Text fw={600} size="sm">Применить и в других гео</Text>
        {others.map((x) => <LocaleBadge key={x.locale} code={x.locale} size="xs" />)}
      </Group>
      <Group gap="md">
        <Checkbox label="Обложку" checked={sync.imagePath} onChange={(e) => onChange({ ...sync, imagePath: e.currentTarget.checked })} />
        <Checkbox label="Категории" checked={sync.categories} onChange={(e) => onChange({ ...sync, categories: e.currentTarget.checked })} />
        <Checkbox label="Аудио (общий файл)" checked={sync.audioPath} onChange={(e) => onChange({ ...sync, audioPath: e.currentTarget.checked })} />
        {fields.map((f) => (
          <Checkbox key={f.key} label={f.label} checked={sync.customKeys.includes(f.key)} onChange={(e) => onChange({ ...sync, customKeys: toggleKey(f.key, e.currentTarget.checked) })} />
        ))}
        {draft.id !== originalId && (
          <Checkbox label="Новый ID" checked={sync.renameId} onChange={(e) => onChange({ ...sync, renameId: e.currentTarget.checked })} />
        )}
      </Group>
    </Paper>
  );
}

export function AdvancedSection({ draft, onChange, idError, isNew }: { draft: ItemDraft; onChange: Patch; idError?: string; isNew: boolean }) {
  const files = useAppStore(selectEffectiveFiles);
  const customFields = useAppStore((s) => s.work.config.customFields);
  const customKeys = useMemo(() => new Set(customFields.map((f) => f.key)), [customFields]);
  const paths = useMemo(() => [...files.keys()], [files]);
  const audio = useMemo(() => paths.filter(isAudioPath), [paths]);
  const images = useMemo(() => paths.filter(isImagePath), [paths]);
  const unknown = Object.fromEntries(Object.entries(draft.extra).filter(([key]) => !customKeys.has(key)));
  return (
    <Accordion variant="contained" radius="md" defaultValue={idError ? 'advanced' : null}>
      <Accordion.Item value="advanced">
        <Accordion.Control>Дополнительно: ID и пути к файлам</Accordion.Control>
        <Accordion.Panel>
          <Stack gap="xs">
            <TextInput label="ID сказки" description={isNew ? 'Можно оставить пустым — создастся из названия' : 'Связывает одну сказку между гео. Меняйте осознанно.'}
              value={draft.id} error={idError} onChange={(e) => onChange({ id: e.currentTarget.value.trim().toLowerCase() })} />
            <Autocomplete label="Аудиофайл в репозитории" data={audio} limit={30} value={draft.audioPath} onChange={(value) => onChange({ audioPath: value })} />
            <Autocomplete label="Обложка в репозитории" data={images} limit={30} value={draft.imagePath} onChange={(value) => onChange({ imagePath: value })} />
            {Object.keys(unknown).length > 0 && (
              <Stack gap={2}>
                <Text size="sm" fw={500}>Другие поля из JSON (сохраняются как есть)</Text>
                <Code block>{JSON.stringify(unknown, null, 2)}</Code>
              </Stack>
            )}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
