import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { Anchor, Badge, Card, Group, List, Paper, SimpleGrid, Stack, Text, ThemeIcon } from '@mantine/core';
import { IconAlertTriangle, IconBooks, IconCloudUpload, IconWorld } from '@tabler/icons-react';
import type { ContentItem, Section } from '../../core/types.ts';
import { SECTIONS } from '../../core/types.ts';
import { useAppStore } from '../../store/appStore.ts';
import { selectChangeCount, selectIssues, selectSummaries } from '../../store/selectors.ts';
import { openEditor, setChangesOpen } from '../../store/uiStore.ts';
import { navigate } from '../router.ts';
import { Cover, LocaleBadge, PageTitle } from '../common/common.tsx';
import { formatDate } from '../hooks.ts';

interface Recent {
  readonly locale: string;
  readonly section: Section;
  readonly item: ContentItem;
}

function Stat({ icon, label, value, color, onClick }: { icon: ReactNode; label: string; value: ReactNode; color: string; onClick?: () => void }) {
  return (
    <Paper withBorder p="md" radius="md" onClick={onClick} style={{ cursor: onClick ? 'pointer' : undefined }}>
      <Group gap="sm" wrap="nowrap">
        <ThemeIcon size={40} radius="md" variant="light" color={color}>{icon}</ThemeIcon>
        <Stack gap={0}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>{label}</Text>
          <Text fw={700} size="xl" component="div">{value}</Text>
        </Stack>
      </Group>
    </Paper>
  );
}

export function OverviewPage() {
  const docs = useAppStore((s) => s.work.docs);
  const config = useAppStore((s) => s.work.config);
  const issues = useAppStore(selectIssues);
  const summaries = useAppStore(selectSummaries);
  const changeCount = useAppStore(selectChangeCount);
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  const uniqueStories = useMemo(() => new Set(Object.values(docs).flatMap((d) => d.stories.map((s) => s.id))).size, [docs]);
  const recent = useMemo<Recent[]>(() => Object.values(docs)
    .flatMap((doc) => SECTIONS.flatMap((section) => doc[section].map((item) => ({ locale: doc.code, section, item }))))
    .filter((entry) => entry.item.addedAt)
    .sort((a, b) => (b.item.addedAt ?? '').localeCompare(a.item.addedAt ?? ''))
    .slice(0, 8), [docs]);
  const changed = new Set(summaries.map((s) => s.locale));
  const reference = docs[config.settings.referenceLocale];

  return (
    <Stack gap="lg">
      <PageTitle title="Обзор" description="Все гео, проблемы и последние добавления на одном экране." />
      <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} spacing="sm">
        <Stat icon={<IconWorld size={22} />} label="Гео" value={config.locales.length} color="blue" onClick={() => navigate({ page: 'settings', tab: 'locales' })} />
        <Stat icon={<IconBooks size={22} />} label="Разных сказок" value={uniqueStories} color="violet" onClick={() => navigate({ page: 'matrix', section: 'stories' })} />
        <Stat icon={<IconAlertTriangle size={22} />} label="Проблемы" color={errors > 0 ? 'red' : 'teal'}
          value={<Group gap={6}><span>{errors}</span><Text span size="sm" c="dimmed">+{warnings} предупр.</Text></Group>} onClick={() => navigate({ page: 'health' })} />
        <Stat icon={<IconCloudUpload size={22} />} label="Не опубликовано" value={changeCount} color={changeCount > 0 ? 'orange' : 'gray'} onClick={() => setChangesOpen(true)} />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
        {config.locales.map((locale) => {
          const doc = docs[locale.code];
          if (!doc) return null;
          const hidden = doc.stories.filter((s) => s.hidden).length + doc.lullabies.filter((s) => s.hidden).length;
          const missing = reference && locale.code !== config.settings.referenceLocale
            ? reference.stories.filter((r) => !doc.stories.some((s) => s.id === r.id)).length : 0;
          const localeIssues = issues.filter((i) => i.severity !== 'info' && i.refs.some((r) => r.locale === locale.code)).length;
          return (
            <Card key={locale.code} withBorder radius="md" padding="md" className="media-tile"
              onClick={() => navigate({ page: 'content', locale: locale.code, section: 'stories' })}>
              <Group justify="space-between" mb="xs">
                <Group gap="xs"><LocaleBadge code={locale.code} size="md" /><Text fw={600}>{locale.label}</Text></Group>
                {changed.has(locale.code) && <Badge color="violet" variant="light">есть правки</Badge>}
              </Group>
              <Group gap="lg">
                <Stack gap={0}><Text fw={700} size="lg">{doc.stories.length}</Text><Text size="xs" c="dimmed">сказок</Text></Stack>
                <Stack gap={0}><Text fw={700} size="lg">{doc.lullabies.length}</Text><Text size="xs" c="dimmed">колыбельных</Text></Stack>
                {hidden > 0 && <Stack gap={0}><Text fw={700} size="lg">{hidden}</Text><Text size="xs" c="dimmed">скрыто</Text></Stack>}
              </Group>
              <Group gap={6} mt="sm">
                {missing > 0 && <Badge color="yellow" variant="light">нет {missing} из базового гео</Badge>}
                {localeIssues > 0 && <Badge color="red" variant="light">{localeIssues} проблем</Badge>}
                {missing === 0 && localeIssues === 0 && <Badge color="teal" variant="light">всё в порядке</Badge>}
              </Group>
            </Card>
          );
        })}
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
        <Paper withBorder p="md" radius="md">
          <Text fw={600} mb="sm">Недавно добавленные</Text>
          <Stack gap={8}>
            {recent.map(({ locale, section, item }) => (
              <Group key={`${locale}:${item.uid}`} gap="sm" wrap="nowrap" style={{ cursor: 'pointer' }} onClick={() => openEditor({ locale, section, uid: item.uid })}>
                <Cover path={item.imagePath} size={36} radius={6} />
                <Text size="sm" truncate style={{ flex: 1 }}>{item.title}</Text>
                <LocaleBadge code={locale} size="xs" />
                <Text size="xs" c="dimmed">{formatDate(item.addedAt)}</Text>
              </Group>
            ))}
            {recent.length === 0 && <Text size="sm" c="dimmed">Нет дат добавления — они появятся у новых сказок.</Text>}
          </Stack>
        </Paper>
        <Paper withBorder p="md" radius="md">
          <Text fw={600} mb="sm">Как это работает</Text>
          <List type="ordered" spacing={6} size="sm">
            <List.Item>Выберите гео слева и добавьте или отредактируйте сказку — обложку и MP3 можно просто перетащить.</List.Item>
            <List.Item>Все правки копятся в черновике (он не пропадёт, даже если закрыть вкладку). Ctrl+Z отменяет.</List.Item>
            <List.Item>Нажмите «Опубликовать» — всё уйдёт одним коммитом, приложение увидит изменения через ~5 минут.</List.Item>
            <List.Item>
              <Anchor component="button" size="sm" onClick={() => navigate({ page: 'matrix', section: 'stories' })}>Матрица переводов</Anchor>
              {' '}покажет, какой сказки не хватает в каком гео.
            </List.Item>
          </List>
        </Paper>
      </SimpleGrid>
    </Stack>
  );
}
