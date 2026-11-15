import { lazy, Suspense } from 'react';
import {
  ActionIcon,
  Anchor,
  AppShell,
  Badge,
  Burger,
  Button,
  Center,
  Group,
  Indicator,
  Loader,
  LoadingOverlay,
  Menu,
  Modal,
  NavLink,
  ScrollArea,
  Stack,
  Text,
  ThemeIcon,
  Tooltip,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core';
import { useDisclosure, useHotkeys } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconBrandGithub,
  IconCategory,
  IconDots,
  IconHome,
  IconLayoutGrid,
  IconLogout,
  IconMoon,
  IconMoonStars,
  IconPhoto,
  IconRefresh,
  IconSettings,
  IconStethoscope,
  IconSun,
} from '@tabler/icons-react';
import { useAppStore, redo, undo, getBackend, hasBackend, errorMessage } from '../../store/appStore.ts';
import { selectChangeCount, selectIssues, selectSummaries } from '../../store/selectors.ts';
import { disconnect, reload, resolveDraftConflict } from '../../store/session.ts';
import { setChangesOpen } from '../../store/uiStore.ts';
import type { Route } from '../router.ts';
import { navigate, routeHash, useRoute } from '../router.ts';
import { LocaleBadge, MiniPlayer } from '../common/common.tsx';
import { ErrorBoundary } from '../common/ErrorBoundary.tsx';
import { ChangesDrawer } from '../changes/ChangesDrawer.tsx';
import { confirmAndPublish } from '../changes/publishFlow.tsx';
import { ItemEditor } from '../editor/ItemEditor.tsx';
import { BulkImportModal } from '../content/BulkImportModal.tsx';
import { OverviewPage } from '../overview/OverviewPage.tsx';
import { ContentPage } from '../content/ContentPage.tsx';

const MatrixPage = lazy(() => import('../matrix/MatrixPage.tsx').then((m) => ({ default: m.MatrixPage })));
const CategoriesPage = lazy(() => import('../categories/CategoriesPage.tsx').then((m) => ({ default: m.CategoriesPage })));
const MediaPage = lazy(() => import('../media/MediaPage.tsx').then((m) => ({ default: m.MediaPage })));
const HealthPage = lazy(() => import('../health/HealthPage.tsx').then((m) => ({ default: m.HealthPage })));
const SettingsPage = lazy(() => import('../settings/SettingsPage.tsx').then((m) => ({ default: m.SettingsPage })));

const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image']);

/** Text fields keep their native Ctrl+Z; everywhere else it undoes panel edits. */
function isTextField(element: Element | null): boolean {
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(element.type);
  return element instanceof HTMLElement && element.isContentEditable;
}

function panelHotkey(action: () => void): (event: KeyboardEvent) => void {
  return (event) => {
    if (isTextField(document.activeElement)) return;
    event.preventDefault();
    action();
  };
}

export function Shell() {
  const [opened, { toggle, close }] = useDisclosure();
  const route = useRoute();
  const busy = useAppStore((s) => s.busy);
  useHotkeys([
    ['mod+Z', panelHotkey(undo), { preventDefault: false }],
    ['mod+shift+Z', panelHotkey(redo), { preventDefault: false }],
    ['mod+Y', panelHotkey(redo), { preventDefault: false }],
  ], []);
  return (
    <AppShell header={{ height: 56 }} navbar={{ width: 270, breakpoint: 'sm', collapsed: { mobile: !opened } }} padding="md">
      <AppShell.Header>
        <Header navOpened={opened} onToggleNav={toggle} />
      </AppShell.Header>
      <AppShell.Navbar>
        <Navbar route={route} onNavigate={close} />
      </AppShell.Navbar>
      <AppShell.Main pos="relative">
        <LoadingOverlay visible={busy} zIndex={150} overlayProps={{ blur: 1 }} />
        <ErrorBoundary resetKey={routeHash(route)}>
          <Suspense fallback={<Center py={80}><Loader /></Center>}>
            <PageRouter route={route} />
          </Suspense>
        </ErrorBoundary>
      </AppShell.Main>
      <ErrorBoundary>
        <ItemEditor />
        <ChangesDrawer />
        <BulkImportModal />
        <DraftConflictModal />
        <MiniPlayer />
      </ErrorBoundary>
    </AppShell>
  );
}

function PageRouter({ route }: { route: Route }) {
  switch (route.page) {
    case 'content': return <ContentPage key={`${route.locale}:${route.section}`} locale={route.locale} section={route.section} />;
    case 'matrix': return <MatrixPage section={route.section} />;
    case 'categories': return <CategoriesPage />;
    case 'media': return <MediaPage />;
    case 'health': return <HealthPage />;
    case 'settings': return <SettingsPage tab={route.tab} />;
    default: return <OverviewPage />;
  }
}

function Header({ navOpened, onToggleNav }: { navOpened: boolean; onToggleNav: () => void }) {
  const session = useAppStore((s) => s.session);
  const changeCount = useAppStore(selectChangeCount);
  const canUndo = useAppStore((s) => s.past.length > 0);
  const canRedo = useAppStore((s) => s.future.length > 0);
  const busy = useAppStore((s) => s.busy);
  const { setColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme('light');
  const canWrite = hasBackend() && getBackend().canWrite;
  const repoUrl = session ? `https://github.com/${session.coords.owner}/${session.coords.repo}` : '#';

  const doReload = (): void => {
    if (session?.mode === 'sandbox') {
      notifications.show({ message: 'Песочница живёт в памяти и не обновляется. Чтобы начать заново — выйдите и снова откройте песочницу.' });
      return;
    }
    reload().then(
      () => notifications.show({ message: 'Данные обновлены из GitHub. Черновик сохранён.' }),
      (error: unknown) => notifications.show({ color: 'red', title: 'Не удалось обновить', message: errorMessage(error) }),
    );
  };

  return (
    <Group h="100%" px="md" justify="space-between" wrap="nowrap">
      <Group gap="sm" wrap="nowrap">
        <Burger opened={navOpened} onClick={onToggleNav} hiddenFrom="sm" size="sm" aria-label="Меню" />
        <ThemeIcon variant="gradient" gradient={{ from: 'violet', to: 'indigo' }} radius="md"><IconMoonStars size={18} /></ThemeIcon>
        <Text fw={700} visibleFrom="xs">Dreamy Stories</Text>
        {session && (
          <Anchor href={repoUrl} target="_blank" rel="noreferrer" size="xs" c="dimmed" visibleFrom="md">
            {session.coords.owner}/{session.coords.repo} · {session.coords.branch}
          </Anchor>
        )}
        {session?.mode === 'readonly' && <Badge color="orange" variant="light">Только просмотр</Badge>}
        {session?.mode === 'sandbox' && <Badge color="grape" variant="light">Песочница</Badge>}
      </Group>
      <Group gap={6} wrap="nowrap">
        <Tooltip label="Отменить (Ctrl+Z)"><ActionIcon variant="subtle" color="gray" disabled={!canUndo} onClick={undo} aria-label="Отменить"><IconArrowBackUp size={18} /></ActionIcon></Tooltip>
        <Tooltip label="Повторить (Ctrl+Shift+Z)"><ActionIcon variant="subtle" color="gray" disabled={!canRedo} onClick={redo} aria-label="Повторить"><IconArrowForwardUp size={18} /></ActionIcon></Tooltip>
        <Indicator label={changeCount} size={16} disabled={changeCount === 0} color="violet">
          <Button variant="default" size="xs" onClick={() => setChangesOpen(true)}>Изменения</Button>
        </Indicator>
        <Button size="xs" disabled={changeCount === 0 || !canWrite} loading={busy} onClick={() => confirmAndPublish(changeCount)} visibleFrom="xs">
          Опубликовать
        </Button>
        <ActionIcon variant="default" aria-label="Тема" onClick={() => setColorScheme(scheme === 'dark' ? 'light' : 'dark')}>
          {scheme === 'dark' ? <IconSun size={16} /> : <IconMoon size={16} />}
        </ActionIcon>
        <Menu position="bottom-end" withinPortal>
          <Menu.Target><ActionIcon variant="default" aria-label="Ещё"><IconDots size={16} /></ActionIcon></Menu.Target>
          <Menu.Dropdown>
            <Menu.Item leftSection={<IconRefresh size={14} />} onClick={doReload}>Обновить из GitHub</Menu.Item>
            <Menu.Item leftSection={<IconBrandGithub size={14} />} component="a" href={repoUrl} target="_blank" rel="noreferrer">Открыть репозиторий</Menu.Item>
            <Menu.Divider />
            <Menu.Item color="red" leftSection={<IconLogout size={14} />} onClick={() => disconnect(true)}>Выйти</Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
    </Group>
  );
}

function Navbar({ route, onNavigate }: { route: Route; onNavigate: () => void }) {
  const config = useAppStore((s) => s.work.config);
  const docs = useAppStore((s) => s.work.docs);
  const parseErrors = useAppStore((s) => s.base?.parseErrors);
  const summaries = useAppStore(selectSummaries);
  const issues = useAppStore(selectIssues);
  const commit = useAppStore((s) => s.base?.commitSha ?? '');
  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const changedLocales = new Set(summaries.map((s) => s.locale));
  const go = (next: Route): void => {
    navigate(next);
    onNavigate();
  };
  const active = (page: Route['page']): boolean => route.page === page;

  return (
    <>
      <AppShell.Section grow component={ScrollArea} p="xs">
        <NavLink label="Обзор" leftSection={<IconHome size={18} />} active={active('overview')} onClick={() => go({ page: 'overview' })} />
        <Text size="xs" fw={700} c="dimmed" tt="uppercase" px="sm" mt="md" mb={4}>Гео</Text>
        {config.locales.map((locale) => {
          const doc = docs[locale.code];
          const count = doc ? doc.stories.length + doc.lullabies.length : 0;
          const isActive = route.page === 'content' && route.locale === locale.code;
          return (
            <NavLink
              key={locale.code}
              label={locale.label}
              leftSection={<LocaleBadge code={locale.code} />}
              rightSection={
                <Group gap={4} wrap="nowrap">
                  {changedLocales.has(locale.code) && <Tooltip label="Есть неопубликованные изменения"><Badge size="xs" circle color="violet"> </Badge></Tooltip>}
                  {parseErrors?.[locale.code] ? <Badge size="xs" color="red">ошибка</Badge> : <Text size="xs" c="dimmed">{count}</Text>}
                </Group>
              }
              active={isActive}
              onClick={() => go({ page: 'content', locale: locale.code, section: route.page === 'content' ? route.section : 'stories' })}
            />
          );
        })}
        <Text size="xs" fw={700} c="dimmed" tt="uppercase" px="sm" mt="md" mb={4}>Инструменты</Text>
        <NavLink label="Матрица переводов" leftSection={<IconLayoutGrid size={18} />} active={active('matrix')} onClick={() => go({ page: 'matrix', section: 'stories' })} />
        <NavLink label="Категории" leftSection={<IconCategory size={18} />} active={active('categories')} onClick={() => go({ page: 'categories' })} />
        <NavLink label="Медиатека" leftSection={<IconPhoto size={18} />} active={active('media')} onClick={() => go({ page: 'media' })} />
        <NavLink label="Проверка" leftSection={<IconStethoscope size={18} />} active={active('health')} onClick={() => go({ page: 'health' })}
          rightSection={errorCount > 0 ? <Badge size="sm" color="red" variant="filled">{errorCount}</Badge> : null} />
        <NavLink label="Настройки" leftSection={<IconSettings size={18} />} active={active('settings')} onClick={() => go({ page: 'settings', tab: 'locales' })} />
      </AppShell.Section>
      <AppShell.Section p="sm">
        <Text size="xs" c="dimmed">Версия данных: <code>{commit.startsWith('mem-') ? 'песочница' : commit.slice(0, 7)}</code></Text>
      </AppShell.Section>
    </>
  );
}

function DraftConflictModal() {
  const conflict = useAppStore((s) => s.draftConflict);
  return (
    <Modal opened={conflict !== null} onClose={() => resolveDraftConflict('mine')} title="Черновик и репозиторий разошлись" closeOnClickOutside={false}>
      <Stack gap="sm">
        <Text size="sm">
          У вас есть неопубликованные правки, а за это время на GitHub изменились те же файлы: <b>{conflict?.paths.join(', ')}</b>.
        </Text>
        <Text size="sm" c="dimmed">
          «Оставить мои правки» — при публикации ваша версия заменит новую. «Взять из репозитория» — ваши правки в этих файлах удалятся.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => resolveDraftConflict('theirs')}>Взять из репозитория</Button>
          <Button onClick={() => resolveDraftConflict('mine')}>Оставить мои правки</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
