import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  Accordion,
  Alert,
  Anchor,
  Button,
  Checkbox,
  Container,
  Divider,
  Group,
  List,
  Paper,
  PasswordInput,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from '@mantine/core';
import { IconBrandGithub, IconEye, IconFlask, IconKey, IconMoonStars } from '@tabler/icons-react';
import { connect } from '../../store/session.ts';
import type { SessionMode } from '../../store/auth.ts';
import { defaultCoords, isValidCoords, loadSavedAuth } from '../../store/auth.ts';
import { errorMessage } from '../../store/appStore.ts';

function tokenUrl(owner: string): string {
  const params = new URLSearchParams({
    name: 'Dreamy Stories Admin',
    description: 'Админ-панель сказок: чтение и запись контента',
    target_name: owner,
    expires_in: '365',
    contents: 'write',
  });
  return `https://github.com/settings/personal-access-tokens/new?${params.toString()}`;
}

export function ConnectScreen() {
  const initial = useMemo(() => {
    const saved = loadSavedAuth();
    return saved?.coords ?? defaultCoords(window.location.hostname, window.location.pathname, import.meta.env.VITE_DEFAULT_REPO);
  }, []);
  const [owner, setOwner] = useState(initial.owner);
  const [repo, setRepo] = useState(initial.repo);
  const [branch, setBranch] = useState(initial.branch || 'main');
  const [token, setToken] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState<SessionMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [help, setHelp] = useState<string | null>(null);
  const coords = { owner: owner.trim(), repo: repo.trim(), branch: branch.trim() || 'main' };

  async function start(mode: SessionMode): Promise<void> {
    setError(null);
    if (!isValidCoords(coords)) {
      setError('Проверьте владельца, репозиторий и ветку.');
      return;
    }
    if (mode === 'github' && !token.trim()) {
      setError('Вставьте токен GitHub — как его получить, написано ниже. Или откройте «Песочницу».');
      setHelp('token');
      return;
    }
    setBusy(mode);
    try {
      await connect({ coords, mode, token: token.trim() || null, remember });
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(null);
    }
  }

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    void start('github');
  };

  return (
    <Container size={560} py={48}>
      <Stack gap="lg">
        <Group gap="sm">
          <ThemeIcon size={44} radius="md" variant="gradient" gradient={{ from: 'violet', to: 'indigo' }}>
            <IconMoonStars size={26} />
          </ThemeIcon>
          <Stack gap={0}>
            <Title order={2}>Dreamy Stories</Title>
            <Text c="dimmed" size="sm">Админ-панель сказок и колыбельных</Text>
          </Stack>
        </Group>

        <Paper withBorder radius="lg" p="lg" component="form" onSubmit={onSubmit}>
          <Stack gap="md">
            <SimpleGrid cols={{ base: 1, xs: 3 }} spacing="sm">
              <TextInput label="Владелец" value={owner} onChange={(e) => setOwner(e.currentTarget.value)} required />
              <TextInput label="Репозиторий" value={repo} onChange={(e) => setRepo(e.currentTarget.value)} required />
              <TextInput label="Ветка" value={branch} onChange={(e) => setBranch(e.currentTarget.value)} />
            </SimpleGrid>
            <PasswordInput
              label="Токен GitHub"
              description={
                <>
                  Нужен, чтобы публиковать изменения. Хранится только в этом браузере.{' '}
                  <Anchor href={tokenUrl(coords.owner)} target="_blank" rel="noreferrer" size="xs">Получить токен на GitHub →</Anchor>
                </>
              }
              placeholder="github_pat_…"
              leftSection={<IconKey size={16} />}
              value={token}
              onChange={(e) => setToken(e.currentTarget.value)}
              autoComplete="off"
            />
            <Checkbox label="Запомнить на этом устройстве" checked={remember} onChange={(e) => setRemember(e.currentTarget.checked)}
              description="Токен останется в браузере для этого сайта. На чужом компьютере снимите галочку — тогда он забудется при закрытии вкладки." />
            {error && <Alert color="red">{error}</Alert>}
            <Button type="submit" size="md" leftSection={<IconBrandGithub size={18} />} loading={busy === 'github'} disabled={busy !== null}>
              Подключить
            </Button>
            <Divider label="или без токена" labelPosition="center" />
            <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="sm">
              <Button variant="default" leftSection={<IconEye size={16} />} loading={busy === 'readonly'} disabled={busy !== null} onClick={() => void start('readonly')}>
                Только просмотр
              </Button>
              <Button variant="light" color="grape" leftSection={<IconFlask size={16} />} loading={busy === 'sandbox'} disabled={busy !== null} onClick={() => void start('sandbox')}>
                Песочница
              </Button>
            </SimpleGrid>
            <Text size="xs" c="dimmed">
              Песочница загружает настоящие данные, но «публикует» только в память браузера — можно смело пробовать всё.
            </Text>
          </Stack>
        </Paper>

        <Accordion variant="separated" radius="lg" value={help} onChange={setHelp}>
          <Accordion.Item value="token">
            <Accordion.Control icon={<IconKey size={18} />}>Как получить токен (2 минуты)</Accordion.Control>
            <Accordion.Panel>
              <List type="ordered" spacing={6} size="sm">
                <List.Item>
                  Откройте{' '}
                  <Anchor href={tokenUrl(coords.owner)} target="_blank" rel="noreferrer">
                    создание токена на GitHub
                  </Anchor>{' '}
                  (поля уже заполнены).
                </List.Item>
                <List.Item>В «Repository access» выберите «Only select repositories» → {coords.repo || 'ваш репозиторий'}.</List.Item>
                <List.Item>В «Permissions → Repository» должно стоять «Contents: Read and write».</List.Item>
                <List.Item>Нажмите «Generate token», скопируйте его и вставьте сюда.</List.Item>
              </List>
              <Text size="xs" c="dimmed" mt="sm">
                Токен даёт доступ только к этому репозиторию. Если потеряете устройство — удалите токен на той же странице GitHub.
              </Text>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </Stack>
    </Container>
  );
}
