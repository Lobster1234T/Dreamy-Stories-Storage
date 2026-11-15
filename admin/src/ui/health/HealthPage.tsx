import { useState } from 'react';
import { Badge, Button, Group, Paper, SegmentedControl, Stack, Text, ThemeIcon } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertCircle, IconAlertTriangle, IconCircleCheck, IconInfoCircle, IconWand } from '@tabler/icons-react';
import type { Issue, Severity } from '../../core/health.ts';
import { useAppStore } from '../../store/appStore.ts';
import { applyIssueFix, applySafeFixes, safeFixes } from '../../store/actions.ts';
import { selectIssues } from '../../store/selectors.ts';
import { openEditor } from '../../store/uiStore.ts';
import { EmptyState, LocaleBadge, PageTitle } from '../common/common.tsx';

const SEVERITY = {
  error: { color: 'red', icon: IconAlertCircle },
  warning: { color: 'orange', icon: IconAlertTriangle },
  info: { color: 'blue', icon: IconInfoCircle },
} as const;

function IssueCard({ issue }: { issue: Issue }) {
  const { color, icon: Icon } = SEVERITY[issue.severity];
  const createFromOrphan = (): void => {
    if (!issue.path || !issue.orphanLocale) return;
    openEditor({ locale: issue.orphanLocale, section: 'stories', uid: null, prefill: { audioPath: issue.path, hidden: true } });
  };
  return (
    <Paper withBorder p="sm" radius="md">
      <Group align="flex-start" wrap="nowrap" gap="sm">
        <ThemeIcon variant="light" color={color} radius="xl"><Icon size={16} /></ThemeIcon>
        <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
          <Text fw={600} size="sm" style={{ wordBreak: 'break-word' }}>{issue.title}</Text>
          {issue.detail && <Text size="sm" c="dimmed" style={{ wordBreak: 'break-word' }}>{issue.detail}</Text>}
          {issue.refs.length > 0 && (
            <Group gap={6}>
              {issue.refs.slice(0, 8).map((ref) => (
                <Button key={`${ref.locale}:${ref.uid}`} size="compact-xs" variant="default" leftSection={<LocaleBadge code={ref.locale} size="xs" />}
                  onClick={() => openEditor({ locale: ref.locale, section: ref.section, uid: ref.uid })}>
                  <Text size="xs" truncate maw={180}>{ref.title}</Text>
                </Button>
              ))}
              {issue.refs.length > 8 && <Text size="xs" c="dimmed">и ещё {issue.refs.length - 8}</Text>}
            </Group>
          )}
        </Stack>
        <Group gap={6} wrap="nowrap">
          {issue.orphanLocale && <Button size="xs" variant="light" onClick={createFromOrphan}>Добавить как сказку</Button>}
          {issue.fix && (
            <Button size="xs" variant={issue.fix.type === 'relink' && issue.fix.confidence === 'high' ? 'filled' : 'light'} color={issue.fix.type === 'delete-file' ? 'red' : undefined}
              onClick={() => applyIssueFix(issue.fix!)}>
              {issue.fixLabel ?? 'Исправить'}
            </Button>
          )}
        </Group>
      </Group>
    </Paper>
  );
}

export function HealthPage() {
  const issues = useAppStore(selectIssues);
  const [severity, setSeverity] = useState<Severity | 'all'>('all');
  const counts = { error: 0, warning: 0, info: 0 };
  for (const issue of issues) counts[issue.severity] += 1;
  const shown = issues.filter((issue) => severity === 'all' || issue.severity === severity);
  const safe = safeFixes(issues);

  const fixSafe = (): void => {
    const fixed = applySafeFixes(issues);
    notifications.show({ color: 'teal', message: `Исправлено ссылок: ${fixed}. Проверьте и опубликуйте.` });
  };

  return (
    <Stack gap="md">
      <PageTitle title="Проверка" description="Битые ссылки, пустые поля, лишние файлы, недостающие переводы. Список обновляется сразу при правках."
        right={safe.length > 0 && <Button leftSection={<IconWand size={16} />} onClick={fixSafe}>Исправить ссылки автоматически ({safe.length})</Button>} />
      <Group gap="sm">
        <SegmentedControl value={severity} onChange={(v) => setSeverity(v as Severity | 'all')} data={[
          { value: 'all', label: `Все (${issues.length})` },
          { value: 'error', label: `Ошибки (${counts.error})` },
          { value: 'warning', label: `Предупреждения (${counts.warning})` },
          { value: 'info', label: `Советы (${counts.info})` },
        ]} />
        {counts.error > 0 && <Badge color="red" variant="light">Ошибки ломают показ в приложении — их стоит исправить первыми</Badge>}
      </Group>
      {shown.length === 0 ? (
        <EmptyState title="Всё чисто" description={<Group gap={6} justify="center"><IconCircleCheck size={16} />Проблем не найдено.</Group>} />
      ) : (
        <Stack gap={6}>{shown.slice(0, 300).map((issue) => <IssueCard key={issue.key} issue={issue} />)}</Stack>
      )}
    </Stack>
  );
}
