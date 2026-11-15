import { useState } from 'react';
import { Badge, Box, Button, FileButton, Group, Overlay, Paper, Progress, Stack, Text } from '@mantine/core';
import { Dropzone, IMAGE_MIME_TYPE } from '@mantine/dropzone';
import { notifications } from '@mantine/notifications';
import { IconMusic, IconPhoto, IconRefresh, IconUpload } from '@tabler/icons-react';
import type { Section, UploadEntry } from '../../core/types.ts';
import { GITHUB_FILE_LIMIT_BYTES, basename, formatBytes, formatDuration } from '../../core/paths.ts';
import { titleFromFileName } from '../../core/titles.ts';
import { newItemId } from '../../core/ids.ts';
import { errorMessage, useAppStore } from '../../store/appStore.ts';
import type { ItemDraft } from '../../store/actions.ts';
import { selectEffectiveFiles } from '../../store/selectors.ts';
import { stageUpload, startUpload } from '../../store/uploads.ts';
import {
  audioUploadPath,
  imageUploadPath,
  processImage,
  readAudioDuration,
  validateAudioFile,
  validateImageFile,
} from '../../media/media.ts';
import { Cover } from '../common/common.tsx';
import { useMediaUrl } from '../hooks.ts';
import { ImagePickerModal } from '../media/ImagePickerModal.tsx';

interface FieldProps {
  readonly locale: string;
  readonly section: Section;
  readonly draft: ItemDraft;
  readonly onChange: (patch: Partial<ItemDraft>) => void;
  readonly error?: string;
}

function notifyError(message: string): void {
  notifications.show({ color: 'red', message });
}

export function UploadStatus({ upload }: { upload: UploadEntry | undefined }) {
  const sandbox = useAppStore((s) => s.session?.mode === 'sandbox');
  if (!upload) return null;
  switch (upload.status) {
    case 'done': return <Badge size="sm" color="teal" variant="light">{sandbox ? 'файл загружен (песочница)' : 'файл загружен на GitHub'}</Badge>;
    case 'local': return <Badge size="sm" color="gray" variant="light">загрузится при публикации</Badge>;
    case 'error':
      return (
        <Group gap={6}>
          <Badge size="sm" color="red" variant="light">ошибка загрузки</Badge>
          <Button size="compact-xs" variant="subtle" leftSection={<IconRefresh size={12} />} onClick={() => void startUpload(upload.path)}>Повторить</Button>
          {upload.error && <Text size="xs" c="red">{upload.error}</Text>}
        </Group>
      );
    default:
      return (
        <Group gap={6}>
          <Progress value={upload.progress * 100} w={140} size="sm" animated />
          <Text size="xs" c="dimmed">{Math.round(upload.progress * 100)}%</Text>
        </Group>
      );
  }
}

export function CoverField({ section, draft, onChange }: FieldProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const upload = useAppStore((s) => (draft.imagePath ? s.uploads[draft.imagePath] : undefined));

  async function handle(file: File | null): Promise<void> {
    if (!file) return;
    const problem = validateImageFile(file);
    if (problem) return notifyError(problem);
    setBusy(true);
    try {
      const { config, docs } = useAppStore.getState().work;
      const processed = await processImage(file, config.settings.media);
      const id = draft.id || newItemId(docs, section, draft.title || titleFromFileName(file.name));
      const path = await imageUploadPath(config, section, id, processed);
      await stageUpload(processed, path);
      onChange({ imagePath: path, ...(draft.id ? {} : { id }) });
    } catch (error) {
      notifyError(`Не удалось подготовить картинку: ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack gap={6}>
      <Text size="sm" fw={500}>Обложка</Text>
      <Dropzone onDrop={(files) => void handle(files[0] ?? null)} onReject={() => notifyError('Нужна картинка (JPG, PNG, WebP) до 30 МБ.')}
        accept={IMAGE_MIME_TYPE} maxSize={30 * 1024 * 1024} multiple={false} loading={busy} p={0} radius="md">
        <Box pos="relative" style={{ aspectRatio: '1 / 1', width: '100%' }}>
          <Cover path={draft.imagePath} size={240} radius={10} />
          {!draft.imagePath && (
            <Overlay backgroundOpacity={0} center>
              <Stack align="center" gap={4}><IconPhoto size={28} /><Text size="xs" c="dimmed" ta="center">Перетащите или нажмите</Text></Stack>
            </Overlay>
          )}
        </Box>
      </Dropzone>
      <Group gap={6}>
        <Button size="xs" variant="light" onClick={() => setPickerOpen(true)}>Из медиатеки</Button>
        {draft.imagePath && <Button size="xs" variant="subtle" color="gray" onClick={() => onChange({ imagePath: '' })}>Убрать</Button>}
      </Group>
      {draft.imagePath && <Text size="xs" c="dimmed" className="mono">{draft.imagePath}</Text>}
      <UploadStatus upload={upload} />
      <ImagePickerModal opened={pickerOpen} onClose={() => setPickerOpen(false)} onPick={(path) => {
        onChange({ imagePath: path });
        setPickerOpen(false);
      }} />
    </Stack>
  );
}

export function AudioField({ locale, section, draft, onChange, error }: FieldProps) {
  const [busy, setBusy] = useState(false);
  const url = useMediaUrl(draft.audioPath);
  const upload = useAppStore((s) => (draft.audioPath ? s.uploads[draft.audioPath] : undefined));
  const size = useAppStore((s) => (draft.audioPath ? selectEffectiveFiles(s).get(draft.audioPath)?.size : undefined));

  async function handle(file: File | null): Promise<void> {
    if (!file) return;
    const problem = validateAudioFile(file);
    if (problem) return notifyError(problem);
    setBusy(true);
    try {
      const { config, docs } = useAppStore.getState().work;
      const title = draft.title || titleFromFileName(file.name);
      const id = draft.id || newItemId(docs, section, title);
      const path = await audioUploadPath(config, section, locale, id, file);
      await stageUpload(file, path);
      const duration = await readAudioDuration(file);
      onChange({ audioPath: path, duration: duration ?? draft.duration, ...(draft.id ? {} : { id }), ...(draft.title ? {} : { title }) });
    } catch (failure) {
      notifyError(`Не удалось подготовить аудио: ${errorMessage(failure)}`);
    } finally {
      setBusy(false);
    }
  }

  if (!draft.audioPath) {
    return (
      <Stack gap={6}>
        <Text size="sm" fw={500}>Аудио (MP3)</Text>
        <Dropzone onDrop={(files) => void handle(files[0] ?? null)} onReject={() => notifyError('Нужен MP3 до 95 МБ.')}
          accept={{ 'audio/mpeg': ['.mp3'], 'audio/mp3': ['.mp3'] }} maxSize={GITHUB_FILE_LIMIT_BYTES} multiple={false} loading={busy}
          style={error ? { borderColor: 'var(--mantine-color-red-6)' } : undefined}>
          <Group justify="center" gap="sm" mih={70} style={{ pointerEvents: 'none' }}>
            <IconUpload size={26} />
            <Stack gap={0}><Text fw={600} size="sm">Перетащите MP3 или нажмите</Text><Text size="xs" c="dimmed">Название и длительность подставятся автоматически</Text></Stack>
          </Group>
        </Dropzone>
        {error && <Text size="xs" c="red">{error}</Text>}
      </Stack>
    );
  }

  return (
    <Stack gap={6}>
      <Text size="sm" fw={500}>Аудио (MP3)</Text>
      <Paper withBorder p="sm" radius="md">
        <Stack gap={6}>
          {url ? <audio src={url} controls preload="none" style={{ width: '100%' }} /> : <Text size="sm" c="red">Файл не найден в репозитории</Text>}
          <Group justify="space-between" wrap="wrap" gap={6}>
            <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
              <IconMusic size={16} />
              <Text size="xs" className="mono" truncate>{basename(draft.audioPath)}</Text>
            </Group>
            <Group gap={8}>
              <Text size="xs" c="dimmed">{size ? formatBytes(size) : ''} {draft.duration ? `· ${formatDuration(draft.duration)}` : ''}</Text>
              <FileButton onChange={(file) => void handle(file)} accept="audio/mpeg,.mp3">
                {(props) => <Button {...props} size="compact-xs" variant="light" loading={busy}>Заменить файл</Button>}
              </FileButton>
            </Group>
          </Group>
          <UploadStatus upload={upload} />
        </Stack>
      </Paper>
    </Stack>
  );
}
