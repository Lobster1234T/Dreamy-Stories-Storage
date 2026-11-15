import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ActionIcon, Badge, Box, Center, CloseButton, Group, Paper, Stack, Text, ThemeIcon, Title, Tooltip } from '@mantine/core';
import { IconPhotoOff, IconPlayerPlayFilled, IconSparkles } from '@tabler/icons-react';
import type { ContentConfig } from '../../core/types.ts';
import { categoryName } from '../../core/serialize.ts';
import { localeColor } from '../theme.ts';
import { useMediaUrl } from '../hooks.ts';
import { play, stopPlayer, useUiStore } from '../../store/uiStore.ts';

export function LocaleBadge({ code, size = 'sm' }: { code: string; size?: 'xs' | 'sm' | 'md' | 'lg' }) {
  return (
    <Badge variant="light" color={localeColor(code)} size={size} radius="sm" style={{ flexShrink: 0 }}>
      {code.toUpperCase()}
    </Badge>
  );
}

export function Cover({ path, size = 48, radius = 8 }: { path: string; size?: number; radius?: number }) {
  const url = useMediaUrl(path);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (!url || failed) {
    return (
      <Center w={size} h={size} className="cover-img" style={{ borderRadius: radius }} aria-label="Нет обложки">
        <IconPhotoOff size={Math.max(14, size * 0.35)} color="var(--mantine-color-dimmed)" />
      </Center>
    );
  }
  return (
    <img
      src={url}
      width={size}
      height={size}
      loading="lazy"
      alt=""
      className="cover-img"
      style={{ borderRadius: radius }}
      onError={() => setFailed(true)}
    />
  );
}

export function CategoryChips({ ids, config, locale, max = 3 }: { ids: readonly string[]; config: ContentConfig; locale: string; max?: number }) {
  if (ids.length === 0) return null;
  const known = new Map(config.categories.map((c) => [c.id, c]));
  const shown = ids.slice(0, max);
  return (
    <Group gap={4} wrap="nowrap" style={{ overflow: 'hidden' }}>
      {shown.map((id) => {
        const category = known.get(id);
        return (
          <Badge key={id} size="xs" variant="light" color={category ? 'gray' : 'red'} radius="sm" style={{ textTransform: 'none', flexShrink: 0 }}
            leftSection={category?.icon ? <span>{category.icon}</span> : undefined}>
            {category ? categoryName(category, locale, config.settings.referenceLocale) : `${id}?`}
          </Badge>
        );
      })}
      {ids.length > max && <Text size="xs" c="dimmed">+{ids.length - max}</Text>}
    </Group>
  );
}

export function PlayButton({ path, title, cover }: { path: string; title: string; cover: string }) {
  const url = useMediaUrl(path);
  const coverUrl = useMediaUrl(cover);
  const current = useUiStore((s) => s.player?.src);
  if (!url) return <Box w={28} />;
  return (
    <Tooltip label="Прослушать">
      <ActionIcon
        variant={current === url ? 'filled' : 'light'}
        radius="xl"
        aria-label="Прослушать"
        onClick={(event) => {
          event.stopPropagation();
          play({ src: url, title, cover: coverUrl || null });
        }}
      >
        <IconPlayerPlayFilled size={14} />
      </ActionIcon>
    </Tooltip>
  );
}

export function MiniPlayer() {
  const player = useUiStore((s) => s.player);
  if (!player) return null;
  return (
    <Paper className="mini-player" shadow="xl" withBorder p="sm" radius="lg">
      <Group gap="sm" wrap="nowrap" mb={6}>
        {player.cover && <img src={player.cover} width={36} height={36} alt="" className="cover-img" style={{ borderRadius: 6 }} />}
        <Text fw={600} size="sm" truncate style={{ flex: 1 }}>{player.title}</Text>
        <CloseButton aria-label="Закрыть плеер" onClick={stopPlayer} />
      </Group>
      <audio key={player.src} src={player.src} controls autoPlay preload="auto" style={{ width: '100%' }} />
    </Paper>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <Center py={60}>
      <Stack align="center" gap="sm" maw={460} ta="center">
        <ThemeIcon size={56} radius="xl" variant="light">
          <IconSparkles size={28} />
        </ThemeIcon>
        <Title order={4}>{title}</Title>
        {description && <Text c="dimmed" size="sm">{description}</Text>}
        {action}
      </Stack>
    </Center>
  );
}

export function PageTitle({ title, description, right }: { title: ReactNode; description?: ReactNode; right?: ReactNode }) {
  return (
    <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
      <Stack gap={2}>
        <Title order={2}>{title}</Title>
        {description && <Text c="dimmed" size="sm">{description}</Text>}
      </Stack>
      {right}
    </Group>
  );
}
