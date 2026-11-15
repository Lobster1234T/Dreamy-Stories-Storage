import { useEffect, useRef } from 'react';
import { Alert, Button, Center, Group, Loader, MantineProvider, Stack, Text } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications, notifications } from '@mantine/notifications';
import { IconAlertTriangle } from '@tabler/icons-react';
import { theme } from './theme.ts';
import { useAppStore } from '../store/appStore.ts';
import { connect, disconnect, startDraftPersistence } from '../store/session.ts';
import { isAuthRemembered, loadSavedAuth } from '../store/auth.ts';
import { useUploadUnloadGuard } from './hooks.ts';
import { ConnectScreen } from './connect/ConnectScreen.tsx';
import { Shell } from './layout/Shell.tsx';
import { ErrorBoundary } from './common/ErrorBoundary.tsx';

export function App() {
  return (
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <ModalsProvider labels={{ confirm: 'Да', cancel: 'Отмена' }}>
        <Notifications position="bottom-right" limit={4} />
        <ErrorBoundary>
          <Root />
        </ErrorBoundary>
      </ModalsProvider>
    </MantineProvider>
  );
}

function Root() {
  const phase = useAppStore((s) => s.phase);
  useAutoConnect();
  useDraftPersistence();
  useUploadUnloadGuard();
  if (phase === 'disconnected') return <ConnectScreen />;
  if (phase === 'loading') return <FullScreenLoader />;
  if (phase === 'error') return <ErrorScreen />;
  return <Shell />;
}

function useAutoConnect(): void {
  const attempted = useRef(false);
  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    const saved = loadSavedAuth();
    if (!saved || useAppStore.getState().phase !== 'disconnected') return;
    connect({ ...saved, remember: isAuthRemembered() }).catch((error: unknown) => {
      notifications.show({ color: 'red', title: 'Не удалось подключиться', message: String(error) });
    });
  }, []);
}

function useDraftPersistence(): void {
  useEffect(
    () => startDraftPersistence((message) => notifications.show({ color: 'orange', title: 'Черновик', message })),
    [],
  );
}

function FullScreenLoader() {
  const session = useAppStore((s) => s.session);
  return (
    <Center h="100vh">
      <Stack align="center" gap="sm">
        <Loader size="lg" type="dots" />
        <Text c="dimmed">
          Загружаю сказки{session ? ` из ${session.coords.owner}/${session.coords.repo}` : ''}…
        </Text>
      </Stack>
    </Center>
  );
}

function ErrorScreen() {
  const error = useAppStore((s) => s.error);
  const retry = (): void => {
    const saved = loadSavedAuth();
    if (saved) void connect({ ...saved, remember: isAuthRemembered() });
    else disconnect(false);
  };
  return (
    <Center h="100vh" p="md">
      <Stack maw={520} gap="md">
        <Alert color="red" icon={<IconAlertTriangle />} title="Не получилось загрузить данные">
          {error}
        </Alert>
        <Group>
          <Button onClick={retry}>Повторить</Button>
          <Button variant="default" onClick={() => disconnect(false)}>Изменить подключение</Button>
        </Group>
      </Stack>
    </Center>
  );
}
