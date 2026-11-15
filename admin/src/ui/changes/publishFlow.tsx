import { Alert, Anchor, Checkbox, List, Stack, Text } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { incompleteVisibleItems } from '../../core/health.ts';
import type { IncompleteItem } from '../../core/health.ts';
import { publish } from '../../store/session.ts';
import type { PublishOutcome } from '../../store/session.ts';
import { getBackend, hasBackend, useAppStore } from '../../store/appStore.ts';
import { setChangesOpen } from '../../store/uiStore.ts';
import { pluralRu } from '../hooks.ts';

function commitUrl(sha: string): string | null {
  const session = useAppStore.getState().session;
  if (!session || session.mode === 'sandbox') return null;
  return `https://github.com/${session.coords.owner}/${session.coords.repo}/commit/${sha}`;
}

function showOutcome(outcome: PublishOutcome, message: string | undefined): void {
  switch (outcome.status) {
    case 'ok': {
      const url = commitUrl(outcome.sha);
      const sandbox = useAppStore.getState().session?.mode === 'sandbox';
      notifications.show({
        color: 'teal',
        title: sandbox ? 'Опубликовано в песочнице' : 'Опубликовано',
        message: sandbox ? 'Изменения сохранены только в памяти браузера, на GitHub ничего не ушло.' : (
          <Text size="sm">
            Приложение увидит изменения в течение ~5 минут.{' '}
            {url && <Anchor href={url} target="_blank" rel="noreferrer">Коммит {outcome.sha.slice(0, 7)}</Anchor>}
          </Text>
        ),
      });
      setChangesOpen(false);
      return;
    }
    case 'nothing':
      notifications.show({ message: 'Публиковать нечего — изменений нет.' });
      return;
    case 'conflict':
      askToOverwrite(outcome.paths, message);
      return;
    case 'error':
      notifications.show({ color: 'red', title: 'Не удалось опубликовать', message: outcome.message, autoClose: false });
  }
}

function askToOverwrite(paths: readonly string[], message: string | undefined): void {
  modals.openConfirmModal({
    title: 'Файлы изменились в репозитории',
    children: (
      <Stack gap="xs">
        <Text size="sm">Пока вы редактировали, кто-то изменил эти файлы на GitHub:</Text>
        <List size="sm">{paths.map((path) => <List.Item key={path}><code>{path}</code></List.Item>)}</List>
        <Text size="sm">Если опубликовать, ваша версия заменит их. Или отмените и нажмите «Обновить из GitHub» в меню.</Text>
      </Stack>
    ),
    labels: { confirm: 'Перезаписать моими изменениями', cancel: 'Отмена' },
    confirmProps: { color: 'red' },
    onConfirm: () => {
      void publish({ force: true, message }).then((outcome) => showOutcome(outcome, message));
    },
  });
}

export function runPublish(message?: string): void {
  void publish({ message }).then((outcome) => showOutcome(outcome, message));
}

const MISSING_LABEL = { audio: 'аудио', cover: 'обложки' } as const;
const SHOWN_INCOMPLETE = 6;

function IncompleteWarning({ items }: { items: readonly IncompleteItem[] }) {
  const count = `${items.length} ${pluralRu(items.length, 'сказка', 'сказки', 'сказок')}`;
  return (
    <Alert color="orange" variant="light" title={`${count} без обложки или аудио`}>
      <Stack gap={4}>
        <Text size="sm">Приложение покажет их с пустой картинкой или без звука. Добавьте файлы или выключите «Показывать в приложении».</Text>
        <List size="sm" spacing={2}>
          {items.slice(0, SHOWN_INCOMPLETE).map((item, index) => (
            <List.Item key={index}>
              {item.locale.toUpperCase()} · {item.title} — нет {item.missing.map((part) => MISSING_LABEL[part]).join(' и ')}
            </List.Item>
          ))}
        </List>
        {items.length > SHOWN_INCOMPLETE && <Text size="xs" c="dimmed">…и ещё {items.length - SHOWN_INCOMPLETE}</Text>}
      </Stack>
    </Alert>
  );
}

export function confirmAndPublish(fileCount: number, message?: string): void {
  if (!hasBackend() || !getBackend().canWrite) {
    notifications.show({ color: 'orange', message: 'Режим только для просмотра — подключите токен, чтобы публиковать.' });
    return;
  }
  const { session, work } = useAppStore.getState();
  const incomplete = incompleteVisibleItems(work.docs);
  const files = `${fileCount} ${pluralRu(fileCount, 'файл', 'файла', 'файлов')}`;
  modals.openConfirmModal({
    title: 'Опубликовать изменения?',
    children: (
      <Stack gap="sm">
        {session?.mode === 'sandbox' ? (
          <Text size="sm">Песочница: {files} «опубликуются» только в памяти этой вкладки — на GitHub ничего не уйдёт.</Text>
        ) : (
          <Text size="sm">
            {files} будет записано одним коммитом в ветку <b>{session?.coords.branch}</b>. Пользователи приложения увидят изменения
            примерно через 5 минут.
          </Text>
        )}
        {incomplete.length > 0 && <IncompleteWarning items={incomplete} />}
      </Stack>
    ),
    labels: { confirm: incomplete.length > 0 ? 'Опубликовать всё равно' : 'Опубликовать', cancel: 'Отмена' },
    confirmProps: incomplete.length > 0 ? { color: 'orange' } : undefined,
    onConfirm: () => runPublish(message),
  });
}

/** Delete confirmation with an option to remove the files too. */
export function confirmDelete(count: number, onConfirm: (deleteFiles: boolean) => void): void {
  const option = { deleteFiles: true };
  modals.openConfirmModal({
    title: count === 1 ? 'Удалить сказку?' : `Удалить ${count} ${pluralRu(count, 'сказку', 'сказки', 'сказок')}?`,
    children: (
      <Stack gap="sm">
        <Text size="sm">До публикации удаление можно отменить (Ctrl+Z).</Text>
        <Checkbox
          defaultChecked
          label="Удалить и файлы (аудио, обложку), если они больше нигде не используются"
          onChange={(event) => {
            option.deleteFiles = event.currentTarget.checked;
          }}
        />
      </Stack>
    ),
    labels: { confirm: 'Удалить', cancel: 'Отмена' },
    confirmProps: { color: 'red' },
    onConfirm: () => onConfirm(option.deleteFiles),
  });
}
