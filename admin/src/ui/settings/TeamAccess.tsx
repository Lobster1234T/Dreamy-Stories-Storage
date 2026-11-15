import { useState } from 'react';
import { Alert, Anchor, Button, CopyButton, Group, List, Paper, Stack, Text, Textarea } from '@mantine/core';
import { IconCheck, IconCopy, IconUserPlus } from '@tabler/icons-react';
import type { RepoCoords } from '../../github/client.ts';
import { useAppStore } from '../../store/appStore.ts';
import { collaboratorsUrl, colleagueInvite, historyUrl, panelUrl } from '../../core/access.ts';

const EXTERNAL = { target: '_blank', rel: 'noreferrer' } as const;

function InviteMessage({ coords }: { coords: RepoCoords }) {
  const [message, setMessage] = useState(() => colleagueInvite(coords, panelUrl(coords, window.location)));
  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap">
          <Text fw={600}>Приглашение для коллеги</Text>
          <CopyButton value={message}>
            {({ copied, copy }) => (
              <Button size="xs" color={copied ? 'teal' : undefined} leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />} onClick={copy}>
                {copied ? 'Скопировано' : 'Скопировать'}
              </Button>
            )}
          </CopyButton>
        </Group>
        <Textarea value={message} onChange={(e) => setMessage(e.currentTarget.value)} autosize minRows={6}
          aria-label="Текст приглашения" description="Отправьте в мессенджер или на почту. Текст можно поправить." />
      </Stack>
    </Paper>
  );
}

export function TeamAccess() {
  const coords = useAppStore((s) => s.session?.coords);
  if (!coords) return null;
  return (
    <Stack gap="md" maw={720}>
      <Paper withBorder p="md" radius="md">
        <Stack gap="sm">
          <Text fw={600}>Как дать доступ коллеге</Text>
          <List type="ordered" spacing={8} size="sm">
            <List.Item>
              Узнайте ник коллеги на GitHub. Если аккаунта нет — пусть зарегистрируется на{' '}
              <Anchor href="https://github.com/signup" {...EXTERNAL}>github.com</Anchor> (можно на свой Gmail), это бесплатно.
            </List.Item>
            <List.Item>
              Добавьте его в репозиторий: кнопка «Add people» → ник → подтвердите.
              <Group mt={6}>
                <Button component="a" href={collaboratorsUrl(coords)} {...EXTERNAL} size="xs" variant="light" leftSection={<IconUserPlus size={14} />}>
                  Открыть доступ на GitHub
                </Button>
              </Group>
            </List.Item>
            <List.Item>Скопируйте приглашение ниже и отправьте коллеге — в нём ссылка на админку и как получить токен.</List.Item>
          </List>
        </Stack>
      </Paper>
      <InviteMessage coords={coords} />
      <Alert variant="light" color="gray" title="Что сможет коллега">
        Всё в панели: добавлять, править и публиковать сказки. Настройки репозитория, его удаление и выдача доступа остаются только у вас.
        Кто что опубликовал — видно в <Anchor href={historyUrl(coords, coords.branch)} {...EXTERNAL}>истории правок</Anchor>.
        Закрыть доступ — на той же странице GitHub, кнопка «Remove».
      </Alert>
    </Stack>
  );
}
