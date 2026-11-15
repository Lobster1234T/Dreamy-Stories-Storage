/**
 * Links and texts for giving colleagues access to the panel.
 * Pure helpers: no network, no browser storage.
 */
import { encodePathForUrl } from './paths.ts';

export interface RepoRef {
  readonly owner: string;
  readonly repo: string;
}

export interface PageLocation {
  readonly hostname: string;
  readonly origin: string;
  readonly pathname: string;
}

const GITHUB = 'https://github.com';
const TOKEN_NAME = 'Dreamy Stories Admin';
const TOKEN_DAYS = '365';

/** Fine-grained token for the repository owner: this repository only, Contents read/write. */
export function ownerTokenUrl(owner: string): string {
  const params = new URLSearchParams({
    name: TOKEN_NAME,
    description: 'Админ-панель сказок: чтение и запись контента',
    target_name: owner,
    expires_in: TOKEN_DAYS,
    contents: 'write',
  });
  return `${GITHUB}/settings/personal-access-tokens/new?${params.toString()}`;
}

/**
 * Classic token for a colleague. GitHub does not issue fine-grained tokens for a
 * personal repository owned by someone else, so collaborators need `public_repo`.
 */
export function colleagueTokenUrl(): string {
  const params = new URLSearchParams({ scopes: 'public_repo', description: TOKEN_NAME });
  return `${GITHUB}/settings/tokens/new?${params.toString()}`;
}

/** Repository settings page where the owner adds or removes collaborators. */
export function collaboratorsUrl(ref: RepoRef): string {
  return `${GITHUB}/${ref.owner}/${ref.repo}/settings/access`;
}

/** Page where an invited colleague accepts the invitation. */
export function invitationUrl(ref: RepoRef): string {
  return `${GITHUB}/${ref.owner}/${ref.repo}/invitations`;
}

/** Commit history of the branch: who published what. */
export function historyUrl(ref: RepoRef, branch: string): string {
  return `${GITHUB}/${ref.owner}/${ref.repo}/commits/${encodePathForUrl(branch)}`;
}

/**
 * Public address of the panel: the current page on GitHub Pages,
 * otherwise (local run) the project's Pages address.
 */
export function panelUrl(ref: RepoRef, location: PageLocation): string {
  if (/\.github\.io$/i.test(location.hostname)) return `${location.origin}${location.pathname}`;
  return `https://${ref.owner.toLowerCase()}.github.io/${ref.repo}/`;
}

/** Ready-to-send message for a colleague who has just been added as a collaborator. */
export function colleagueInvite(ref: RepoRef, panel: string): string {
  return [
    'Привет! Даю тебе доступ к админке сказок Dreamy Stories.',
    '',
    `1. Прими приглашение на GitHub: ${invitationUrl(ref)} (оно пришло и на почту).`,
    `2. Создай токен: ${colleagueTokenUrl()} — галочка public_repo уже стоит. Выбери срок в «Expiration», нажми «Generate token» и скопируй токен.`,
    `3. Открой админку: ${panel} — вставь токен, оставь «Запомнить на этом устройстве» и нажми «Подключить».`,
    '',
    'Важно: новые сказки добавляй только в конец списка, а старые не перемещай, не скрывай и не удаляй — иначе у пользователей собьются избранное и скачанное.',
  ].join('\n');
}
