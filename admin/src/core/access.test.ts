import { describe, expect, it } from 'vitest';
import {
  collaboratorsUrl,
  colleagueInvite,
  colleagueTokenUrl,
  historyUrl,
  invitationUrl,
  ownerTokenUrl,
  panelUrl,
} from './access.ts';

const REF = { owner: 'Lobster1234T', repo: 'Dreamy-Stories-Storage' };

describe('token links', () => {
  it('prefills a fine-grained token for the owner with contents write access', () => {
    const url = new URL(ownerTokenUrl('Lobster1234T'));

    expect(url.origin + url.pathname).toBe('https://github.com/settings/personal-access-tokens/new');
    expect(url.searchParams.get('target_name')).toBe('Lobster1234T');
    expect(url.searchParams.get('contents')).toBe('write');
    expect(url.searchParams.get('expires_in')).toBe('365');
  });

  it('prefills a classic public_repo token for colleagues', () => {
    const url = new URL(colleagueTokenUrl());

    expect(url.origin + url.pathname).toBe('https://github.com/settings/tokens/new');
    expect(url.searchParams.get('scopes')).toBe('public_repo');
    expect(url.searchParams.get('description')).toBe('Dreamy Stories Admin');
  });
});

describe('repository links', () => {
  it('points to the collaborators settings and the invitation page', () => {
    expect(collaboratorsUrl(REF)).toBe('https://github.com/Lobster1234T/Dreamy-Stories-Storage/settings/access');
    expect(invitationUrl(REF)).toBe('https://github.com/Lobster1234T/Dreamy-Stories-Storage/invitations');
  });

  it('encodes each branch segment in the history link', () => {
    expect(historyUrl(REF, 'main')).toBe('https://github.com/Lobster1234T/Dreamy-Stories-Storage/commits/main');
    expect(historyUrl(REF, 'feat/new stories')).toBe('https://github.com/Lobster1234T/Dreamy-Stories-Storage/commits/feat/new%20stories');
  });
});

describe('panelUrl', () => {
  it('uses the current page on GitHub Pages', () => {
    const location = { hostname: 'lobster1234t.github.io', origin: 'https://lobster1234t.github.io', pathname: '/Dreamy-Stories-Storage/' };

    expect(panelUrl(REF, location)).toBe('https://lobster1234t.github.io/Dreamy-Stories-Storage/');
  });

  it('builds the Pages address when the panel runs locally', () => {
    const location = { hostname: 'localhost', origin: 'http://localhost:5173', pathname: '/' };

    expect(panelUrl(REF, location)).toBe('https://lobster1234t.github.io/Dreamy-Stories-Storage/');
  });
});

describe('colleagueInvite', () => {
  it('contains the invitation, token and panel links plus the ordering rule', () => {
    const text = colleagueInvite(REF, 'https://lobster1234t.github.io/Dreamy-Stories-Storage/');

    expect(text).toContain(invitationUrl(REF));
    expect(text).toContain(colleagueTokenUrl());
    expect(text).toContain('https://lobster1234t.github.io/Dreamy-Stories-Storage/');
    expect(text).toContain('только в конец списка');
  });
});
