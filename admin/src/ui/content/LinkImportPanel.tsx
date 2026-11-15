import { useEffect, useState } from 'react';
import { Alert, Anchor, Button, Code, Group, List, Loader, Progress, Stack, Text, Textarea } from '@mantine/core';
import { IconDownload, IconLink } from '@tabler/icons-react';
import { MAX_LINKS, parseLinks } from '../../core/links.ts';
import { formatBytes } from '../../core/paths.ts';
import { errorMessage } from '../../store/appStore.ts';
import { fetchLinkInfo, getToolsStatus, installTools, LINK_IMPORT_MODE } from '../../media/linkImport.ts';
import type { InstallProgress, LinkEntry, ToolsStatus } from '../../media/linkImport.ts';

const POLL_MS = 1000;

interface Props {
  /** Adds the videos found behind the links as rows of the import table. */
  readonly onFound: (entries: readonly LinkEntry[]) => void;
}

function progressText(progress: InstallProgress | null): string {
  if (!progress) return 'подготовка…';
  const total = progress.total ? ` из ${formatBytes(progress.total)}` : '';
  return `${progress.label}: ${formatBytes(progress.received)}${total}`;
}

function HelperNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <Alert color="blue" variant="light" title="Запустите помощника на компьютере">
      <Stack gap="xs">
        <List type="ordered" size="sm" spacing={4}>
          <List.Item>Дважды кликните <Code>admin/start-helper.cmd</Code> в папке проекта и не закрывайте его окно.</List.Item>
          <List.Item>Если браузер спросит про доступ к приложениям на устройстве — нажмите «Разрешить».</List.Item>
          <List.Item>Нажмите «Проверить снова».</List.Item>
        </List>
        <Text size="xs" c="dimmed">Скачивает ваш компьютер: YouTube не отдаёт файлы сайтам и блокирует облачные серверы.</Text>
        <Group><Button size="xs" onClick={onRetry}>Проверить снова</Button></Group>
      </Stack>
    </Alert>
  );
}

function InstallTools({ busy, progress, onInstall }: { busy: boolean; progress: InstallProgress | null; onInstall: () => void }) {
  return (
    <Alert color="violet" variant="light" title="Один раз нужно скачать инструменты">
      <Stack gap="xs">
        <Text size="sm">
          yt-dlp (≈25 МБ) достаёт аудио с YouTube и других сайтов, ffmpeg (≈30 МБ) переводит его в MP3. Они скачаются с GitHub в папку
          {' '}<Code>admin/.tools</Code>; контрольные суммы проверяются, файл с чужой суммой не сохранится.
        </Text>
        {busy ? (
          <Stack gap={4}>
            <Progress value={progress?.total ? (progress.received / progress.total) * 100 : 0} animated striped />
            <Text size="xs" c="dimmed">Скачиваю {progressText(progress)}. GitHub бывает медленным — это может занять несколько минут.</Text>
          </Stack>
        ) : (
          <Group><Button leftSection={<IconDownload size={16} />} onClick={onInstall}>Скачать инструменты</Button></Group>
        )}
      </Stack>
    </Alert>
  );
}

interface FormProps extends Props {
  readonly tools: ToolsStatus;
  readonly busy: boolean;
  readonly progress: InstallProgress | null;
  readonly onUpdate: () => void;
}

function LinkForm({ tools, busy, progress, onUpdate, onFound }: FormProps) {
  const [text, setText] = useState('');
  const [searching, setSearching] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  async function search(): Promise<void> {
    const parsed = parseLinks(text);
    const failed: string[] = [];
    const issues = parsed.invalid.map((token) => `«${token.slice(0, 60)}» — это не ссылка`);
    if (parsed.truncated) issues.push(`За один раз — не больше ${MAX_LINKS} ссылок, остальные пропущены.`);
    setSearching(true);
    for (const link of parsed.links) {
      try {
        onFound((await fetchLinkInfo(link)).entries);
      } catch (error) {
        failed.push(link);
        issues.push(`${link} — ${errorMessage(error)}`);
      }
    }
    setSearching(false);
    setProblems(issues);
    setText(failed.join('\n'));
  }

  return (
    <Stack gap="sm">
      <Textarea label="Ссылки" description="По одной в строке: видео YouTube, целый плейлист или прямая ссылка на аудиофайл."
        placeholder="https://www.youtube.com/watch?v=…" autosize minRows={3} maxRows={8} value={text}
        onChange={(event) => setText(event.currentTarget.value)} />
      <Group justify="space-between" wrap="nowrap">
        <Text size="xs" c="dimmed">
          yt-dlp {tools.ytDlpVersion ?? ''} ·{' '}
          {busy ? `обновляю: ${progressText(progress)}` : <Anchor component="button" type="button" size="xs" onClick={onUpdate}>обновить инструменты</Anchor>}
        </Text>
        <Button leftSection={<IconLink size={16} />} loading={searching} disabled={!text.trim()} onClick={() => void search()}>Найти</Button>
      </Group>
      {tools.stale && (
        <Alert color="yellow" variant="light">yt-dlp старше месяца. Если YouTube перестанет отдавать аудио — нажмите «обновить инструменты».</Alert>
      )}
      {problems.length > 0 && (
        <Alert color="red" variant="light" title="Не всё получилось">{problems.map((problem) => <Text key={problem} size="sm">{problem}</Text>)}</Alert>
      )}
      <Text size="xs" c="dimmed">
        Найденные видео появятся в таблице и сразу начнут скачиваться — не закрывайте окно, пока идёт загрузка. Сказки встанут в конец
        списка, обложки добавите потом в редакторе. «No Copyright» в названии видео — ещё не лицензия: проверьте её в описании.
      </Text>
    </Stack>
  );
}

/** "By link" tab of the bulk import: links in, audio rows out. */
export function LinkImportPanel({ onFound }: Props) {
  const [tools, setTools] = useState<ToolsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<InstallProgress | null>(null);

  const refresh = (): void => {
    setError(null);
    getToolsStatus().then(setTools, (failure: unknown) => setError(errorMessage(failure)));
  };
  useEffect(refresh, []);

  // While tools download, poll for progress only; the install request itself reports the outcome.
  useEffect(() => {
    if (!busy) return undefined;
    let active = true;
    const timer = setInterval(() => {
      getToolsStatus().then((status) => {
        if (active) setProgress(status.progress);
      }, () => undefined);
    }, POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [busy]);

  async function install(update: boolean): Promise<void> {
    setBusy(true);
    setProgress(null);
    setError(null);
    try {
      setTools(await installTools(update));
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  if (!tools) {
    if (error && LINK_IMPORT_MODE === 'helper') return <HelperNotice onRetry={refresh} />;
    if (!error) return <Group gap="xs"><Loader size="sm" /><Text size="sm">Проверяю инструменты…</Text></Group>;
  }
  const problem = error && (
    <Alert color="red" variant="light" title="Ошибка">
      <Stack gap={6}>
        <Text size="sm">{error}</Text>
        {!tools && <Group><Button size="xs" variant="light" onClick={refresh}>Проверить снова</Button></Group>}
      </Stack>
    </Alert>
  );
  if (!tools) return problem;
  if (!tools.supported) return <Alert color="orange" variant="light">Скачивание по ссылке работает на Windows (x64), macOS и Linux (x64).</Alert>;
  return (
    <Stack gap="sm">
      {problem}
      {tools.installed
        ? <LinkForm tools={tools} busy={busy} progress={progress} onUpdate={() => void install(true)} onFound={onFound} />
        : <InstallTools busy={busy} progress={progress} onInstall={() => void install(false)} />}
    </Stack>
  );
}
