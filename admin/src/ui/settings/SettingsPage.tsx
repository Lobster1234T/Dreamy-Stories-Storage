import { Alert, Anchor, Badge, Button, Code, Group, NumberInput, Paper, Select, Slider, Stack, Switch, Table, Tabs, Text } from '@mantine/core';
import { IconCode, IconLanguage, IconPhoto, IconPlugConnected, IconTags } from '@tabler/icons-react';
import { useAppStore } from '../../store/appStore.ts';
import { updateSettings } from '../../store/actions.ts';
import { disconnect } from '../../store/session.ts';
import { navigate } from '../router.ts';
import { PageTitle } from '../common/common.tsx';
import { LocalesSettings } from './LocalesSettings.tsx';
import { FieldsSettings } from './FieldsSettings.tsx';

const TABS = ['locales', 'fields', 'media', 'connection', 'app'] as const;

function MediaAndTitles() {
  const settings = useAppStore((s) => s.work.config.settings);
  const { media } = settings;
  return (
    <Stack gap="md" maw={640}>
      <Paper withBorder p="md" radius="md">
        <Switch checked={settings.autoNumberTitles} onChange={(e) => updateSettings({ autoNumberTitles: e.currentTarget.checked })}
          label="Автонумерация названий" description="Номер «12. » в начале названия ставится сам по порядку в приложении. Перетащили сказку — номера пересчитались. Если выключить, текущие номера останутся в названиях как текст." />
      </Paper>
      <Paper withBorder p="md" radius="md">
        <Stack gap="sm">
          <Text fw={600}>Обработка обложек при загрузке</Text>
          <Select label="Размер (длинная сторона)" value={String(media.maxImageSize)} allowDeselect={false}
            data={[{ value: '512', label: '512 px — как сейчас в приложении' }, { value: '768', label: '768 px' }, { value: '1024', label: '1024 px' }, { value: '2048', label: '2048 px' }, { value: '0', label: 'Не уменьшать' }]}
            onChange={(value) => updateSettings({ media: { ...media, maxImageSize: Number(value ?? 512) } })} />
          <Switch label="Обрезать до квадрата (по центру)" checked={media.squareImages} onChange={(e) => updateSettings({ media: { ...media, squareImages: e.currentTarget.checked } })} />
          <Stack gap={4}>
            <Text size="sm">Качество JPEG: {Math.round(media.imageQuality * 100)}%</Text>
            <Slider min={50} max={100} step={1} value={Math.round(media.imageQuality * 100)}
              onChangeEnd={(value) => updateSettings({ media: { ...media, imageQuality: value / 100 } })} />
          </Stack>
          <NumberInput label="Предупреждать об аудио больше, МБ" min={1} max={95} value={media.audioWarnMB}
            onChange={(value) => typeof value === 'number' && updateSettings({ media: { ...media, audioWarnMB: value } })} />
        </Stack>
      </Paper>
      <Paper withBorder p="md" radius="md">
        <Text fw={600} mb={4}>Куда складываются новые файлы</Text>
        <Table verticalSpacing={4}>
          <Table.Tbody>
            <Table.Tr><Table.Td>Аудио сказок</Table.Td><Table.Td><Code>{settings.paths.storyAudioDir}/</Code></Table.Td></Table.Tr>
            <Table.Tr><Table.Td>Аудио колыбельных</Table.Td><Table.Td><Code>{settings.paths.lullabyAudioDir}/</Code></Table.Td></Table.Tr>
            <Table.Tr><Table.Td>Обложки сказок</Table.Td><Table.Td><Code>{settings.paths.storyImageDir}/</Code></Table.Td></Table.Tr>
            <Table.Tr><Table.Td>Обложки колыбельных</Table.Td><Table.Td><Code>{settings.paths.lullabyImageDir}/</Code></Table.Td></Table.Tr>
          </Table.Tbody>
        </Table>
        <Text size="xs" c="dimmed" mt={4}>Имена новых файлов — латиница + короткий хеш (например <Code>rapunzel-1a2b3c4d.mp3</Code>), поэтому кеш никогда не покажет старый файл.</Text>
      </Paper>
    </Stack>
  );
}

function Connection() {
  const session = useAppStore((s) => s.session);
  if (!session) return null;
  const modeLabel = { github: 'Полный доступ (токен)', readonly: 'Только просмотр', sandbox: 'Песочница' }[session.mode];
  return (
    <Stack gap="md" maw={640}>
      <Paper withBorder p="md" radius="md">
        <Stack gap={6}>
          <Group gap="xs"><Text fw={600}>Репозиторий:</Text><Anchor href={`https://github.com/${session.coords.owner}/${session.coords.repo}`} target="_blank" rel="noreferrer">{session.coords.owner}/{session.coords.repo}</Anchor></Group>
          <Group gap="xs"><Text fw={600}>Ветка:</Text><Code>{session.coords.branch}</Code></Group>
          <Group gap="xs"><Text fw={600}>Режим:</Text><Badge variant="light">{modeLabel}</Badge></Group>
        </Stack>
      </Paper>
      <Group>
        <Button variant="default" onClick={() => disconnect(false)}>Сменить токен или репозиторий</Button>
        <Button color="red" variant="light" onClick={() => disconnect(true)}>Выйти и забыть токен</Button>
      </Group>
      <Alert variant="light" color="gray">
        Неопубликованные правки хранятся в этом браузере отдельно для каждого репозитория и ветки — после повторного входа они вернутся.
      </Alert>
    </Stack>
  );
}

const SAMPLE = `{
  "stories": [
    {
      "name": "1. Рапунцель",
      "type": "story",
      "description": "…",
      "audioPath": "stories/ru/1.mp3",
      "imagePath": "images/image_1.jpg",
      "index": 0,
      "id": "rapunzel",
      "categories": ["classic", "princesses"],
      "addedAt": "2025-09-15",
      "duration": 754
    }
  ],
  "lullabies": [ … ],
  "categories": [
    { "id": "princesses", "name": "Принцессы", "icon": "👑", "color": "#e64980" }
  ],
  "hidden": [
    { "…": "скрытые сказки", "section": "stories", "position": 12 }
  ]
}`;

function AppSchema() {
  return (
    <Stack gap="md" maw={760}>
      <Alert color="teal" variant="light" title="Старое приложение продолжает работать">
        Поля name, type, description, audioPath, imagePath и index остались как были, index всегда равен позиции в списке. Новые поля добавлены в конец — парсеры
        (Unity JsonUtility, Newtonsoft, Gson, Codable) их просто игнорируют.
      </Alert>
      <Paper withBorder p="md" radius="md">
        <Text fw={600} mb="xs">Что можно использовать в новой версии приложения</Text>
        <Table verticalSpacing={4}>
          <Table.Tbody>
            <Table.Tr><Table.Td><Code>id</Code></Table.Td><Table.Td>Постоянный ID сказки, одинаковый во всех гео. Храните избранное и прогресс по нему, а не по index.</Table.Td></Table.Tr>
            <Table.Tr><Table.Td><Code>categories</Code></Table.Td><Table.Td>ID категорий; названия на языке гео — в корневом массиве <Code>categories</Code>.</Table.Td></Table.Tr>
            <Table.Tr><Table.Td><Code>addedAt</Code></Table.Td><Table.Td>Дата добавления ГГГГ-ММ-ДД — для сортировки «новые» и бейджа NEW.</Table.Td></Table.Tr>
            <Table.Tr><Table.Td><Code>duration</Code></Table.Td><Table.Td>Длительность в секундах — «12 мин» на карточке.</Table.Td></Table.Tr>
            <Table.Tr><Table.Td><Code>hidden</Code></Table.Td><Table.Td>Скрытые сказки лежат отдельно и в списки не попадают — приложению ничего делать не нужно.</Table.Td></Table.Tr>
            <Table.Tr><Table.Td>свои поля</Table.Td><Table.Td>Всё, что заведено во вкладке «Поля», пишется в сказку под своим ключом.</Table.Td></Table.Tr>
          </Table.Tbody>
        </Table>
      </Paper>
      <Code block>{SAMPLE}</Code>
    </Stack>
  );
}

export function SettingsPage({ tab }: { tab: string }) {
  const active = (TABS as readonly string[]).includes(tab) ? tab : 'locales';
  return (
    <Stack gap="md">
      <PageTitle title="Настройки" description="Гео, свои поля, обработка файлов и подключение." />
      <Tabs value={active} onChange={(value) => value && navigate({ page: 'settings', tab: value })} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="locales" leftSection={<IconLanguage size={16} />}>Гео</Tabs.Tab>
          <Tabs.Tab value="fields" leftSection={<IconTags size={16} />}>Поля</Tabs.Tab>
          <Tabs.Tab value="media" leftSection={<IconPhoto size={16} />}>Файлы и названия</Tabs.Tab>
          <Tabs.Tab value="connection" leftSection={<IconPlugConnected size={16} />}>Подключение</Tabs.Tab>
          <Tabs.Tab value="app" leftSection={<IconCode size={16} />}>Для приложения</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="locales" pt="md"><LocalesSettings /></Tabs.Panel>
        <Tabs.Panel value="fields" pt="md"><FieldsSettings /></Tabs.Panel>
        <Tabs.Panel value="media" pt="md"><MediaAndTitles /></Tabs.Panel>
        <Tabs.Panel value="connection" pt="md"><Connection /></Tabs.Panel>
        <Tabs.Panel value="app" pt="md"><AppSchema /></Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
