import { useMemo, useState } from 'react';
import { ActionIcon, Alert, Badge, Button, Drawer, Group, Paper, Progress, Stack, Text, Textarea, ThemeIcon, Tooltip } from '@mantine/core';
import { modals } from '@mantine/modals';
import {
  IconArrowBackUp,
  IconArrowRight,
  IconArrowsSort,
  IconFileCode,
  IconMinus,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconUpload,
} from '@tabler/icons-react';
import type { FileChange, ItemChange, LocaleSummary } from '../../core/changes.ts';
import { buildCommitMessage } from '../../core/changes.ts';
import { SECTION_LABEL } from '../../core/types.ts';
import type { UploadEntry } from '../../core/types.ts';
import { formatBytes } from '../../core/paths.ts';
import { getBackend, hasBackend, useAppStore } from '../../store/appStore.ts';
import { selectFileChanges, selectSummaries } from '../../store/selectors.ts';
import { discardAll, discardLocale } from '../../store/session.ts';
import { restoreFile } from '../../store/actions.ts';
import { startUpload } from '../../store/uploads.ts';
import { openEditor, setChangesOpen, useUiStore } from '../../store/uiStore.ts';
import { EmptyState, LocaleBadge } from '../common/common.tsx';
import { confirmAndPublish } from './publishFlow.tsx';

const KIND_ICON = {
  added: { icon: IconPlus, color: 'teal' },
  modified: { icon: IconPencil, color: 'blue' },
  removed: { icon: IconMinus, color: 'red' },
} as const;

function ItemLine({ change }: { change: ItemChange }) {
  const { icon: Icon, color } = KIND_ICON[change.kind];
  const exists = useAppStore((s) => Boolean(s.work.docs[change.locale]?.[change.section].some((i) => i.uid === change.uid)));
  const open = (): void => {
    if (!exists) return;
    setChangesOpen(false);
    openEditor({ locale: change.locale, section: change.section, uid: change.uid });
  };
  return (
    <Group gap="xs" wrap="nowrap" onClick={open} style={{ cursor: exists ? 'pointer' : 'default' }}>
      <ThemeIcon size="sm" variant="light" color={color} radius="xl"><Icon size={12} /></ThemeIcon>
      <Text size="sm" truncate style={{ flex: 1 }}>
        <Text span c="dimmed" size="xs">{SECTION_LABEL[change.section]} · </Text>
        {change.title || '(без названия)'}
      </Text>
      {change.fields.length > 0 && <Text size="xs" c="dimmed" truncate maw={200}>{change.fields.join(', ')}</Text>}
    </Group>
  );
}

function LocaleCard({ summary }: { summary: LocaleSummary }) {
  const label = useAppStore((s) => s.work.config.locales.find((l) => l.code === summary.locale)?.label ?? summary.locale);
  return (
    <Paper withBorder p="sm" radius="md">
      <Group justify="space-between" mb={6}>
        <Group gap={6}><LocaleBadge code={summary.locale} /><Text fw={600} size="sm">{label}</Text></Group>
        <Tooltip label="Отменить изменения в этом гео">
          <ActionIcon variant="subtle" color="gray" aria-label="Отменить изменения в гео" onClick={() => discardLocale(summary.locale)}>
            <IconArrowBackUp size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>
      <Stack gap={4}>
        {summary.items.map((change) => <ItemLine key={`${change.kind}:${change.uid}`} change={change} />)}
        {summary.reordered.map((section) => (
          <Group key={section} gap="xs">
            <ThemeIcon size="sm" variant="light" color="grape" radius="xl"><IconArrowsSort size={12} /></ThemeIcon>
            <Text size="sm">{SECTION_LABEL[section]}: изменён порядок</Text>
          </Group>
        ))}
      </Stack>
    </Paper>
  );
}

function UploadState({ upload }: { upload: UploadEntry | undefined }) {
  if (!upload) return null;
  if (upload.status === 'done') return <Badge size="xs" color="teal" variant="light">загружен</Badge>;
  if (upload.status === 'error') {
    return (
      <Group gap={4}>
        <Badge size="xs" color="red" variant="light">ошибка</Badge>
        <ActionIcon size="sm" variant="subtle" aria-label="Повторить загрузку" onClick={() => void startUpload(upload.path)}><IconRefresh size={14} /></ActionIcon>
      </Group>
    );
  }
  if (upload.status === 'local') return <Badge size="xs" color="gray" variant="light">ждёт загрузки</Badge>;
  return <Progress value={upload.progress * 100} w={80} size="sm" animated />;
}

function FileLine({ change, uploads }: { change: FileChange; uploads: Readonly<Record<string, UploadEntry>> }) {
  switch (change.kind) {
    case 'text':
      return <Group gap="xs" wrap="nowrap"><IconFileCode size={16} /><Text size="sm" className="mono">{change.path}</Text>{change.isNew && <Badge size="xs">новый</Badge>}</Group>;
    case 'blob':
      return (
        <Group gap="xs" wrap="nowrap">
          <IconUpload size={16} />
          <Text size="sm" className="mono" style={{ flex: 1 }}>{change.path}</Text>
          <Text size="xs" c="dimmed">{formatBytes(change.size)}</Text>
          <UploadState upload={uploads[change.path]} />
        </Group>
      );
    case 'rename':
      return <Group gap="xs" wrap="nowrap"><IconArrowRight size={16} /><Text size="sm" className="mono">{change.from} → {change.to}</Text></Group>;
    case 'delete':
      return (
        <Group gap="xs" wrap="nowrap">
          <IconTrash size={16} color="var(--mantine-color-red-6)" />
          <Text size="sm" className="mono" style={{ flex: 1 }}>{change.path}</Text>
          <Button size="compact-xs" variant="subtle" onClick={() => restoreFile(change.path)}>Вернуть</Button>
        </Group>
      );
  }
}

function confirmDiscardAll(): void {
  modals.openConfirmModal({
    title: 'Отменить все изменения?',
    children: <Text size="sm">Все неопубликованные правки и загруженные файлы будут сброшены.</Text>,
    labels: { confirm: 'Отменить всё', cancel: 'Не надо' },
    confirmProps: { color: 'red' },
    onConfirm: discardAll,
  });
}

export function ChangesDrawer() {
  const opened = useUiStore((s) => s.changesOpen);
  const summaries = useAppStore(selectSummaries);
  const changes = useAppStore(selectFileChanges);
  const uploads = useAppStore((s) => s.uploads);
  const busy = useAppStore((s) => s.busy);
  const [message, setMessage] = useState('');
  const canWrite = hasBackend() && getBackend().canWrite;
  const placeholder = useMemo(() => buildCommitMessage(summaries, changes).split('\n')[0], [summaries, changes]);
  const files = changes.filter((c) => !(c.kind === 'text' && c.path.endsWith('.json')) || c.path.startsWith('admin/'));

  return (
    <Drawer opened={opened} onClose={() => setChangesOpen(false)} position="right" size="lg" title={<Text fw={700}>Неопубликованные изменения</Text>}>
      {changes.length === 0 ? (
        <EmptyState title="Всё опубликовано" description="Изменений нет. Правьте сказки — здесь появится список того, что уйдёт в приложение." />
      ) : (
        <Stack gap="md">
          {!canWrite && <Alert color="orange">Режим только для просмотра: чтобы опубликовать, подключитесь с токеном.</Alert>}
          {summaries.map((summary) => <LocaleCard key={summary.locale} summary={summary} />)}
          {files.length > 0 && (
            <Paper withBorder p="sm" radius="md">
              <Text fw={600} size="sm" mb={6}>Файлы</Text>
              <Stack gap={6}>{files.map((change) => <FileLine key={change.kind === 'rename' ? change.to : change.path} change={change} uploads={uploads} />)}</Stack>
            </Paper>
          )}
          <Textarea label="Описание публикации" description="Необязательно — по умолчанию составится автоматически" placeholder={placeholder}
            value={message} onChange={(e) => setMessage(e.currentTarget.value)} autosize minRows={2} />
          <Group justify="space-between">
            <Button variant="subtle" color="red" onClick={confirmDiscardAll}>Отменить всё</Button>
            <Button onClick={() => confirmAndPublish(changes.length, message)} disabled={!canWrite} loading={busy}>
              Опубликовать
            </Button>
          </Group>
        </Stack>
      )}
    </Drawer>
  );
}
