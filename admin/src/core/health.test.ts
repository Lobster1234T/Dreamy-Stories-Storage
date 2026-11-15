import { describe, expect, it } from 'vitest';
import { findCandidates, incompleteVisibleItems, issueUids, localeFromAudioPath, planSafeRenames, runHealthChecks } from './health.ts';
import type { Issue } from './health.ts';
import { applyFix, markForDeletion, renameFile, unmarkDeletion } from './fixes.ts';
import type { WorkState } from './types.ts';
import { fileMap, makeConfig, makeDoc, makeItem } from '../test/fixtures.ts';

const config = makeConfig({}, ['en', 'ru']);
const byKind = (issues: Issue[], kind: Issue['kind']) => issues.filter((i) => i.kind === kind);

describe('incompleteVisibleItems', () => {
  it('lists visible items without audio or cover and skips hidden drafts', () => {
    const docs = {
      en: makeDoc('en', [
        makeItem({ title: 'Complete' }),
        makeItem({ title: 'No cover', imagePath: '' }),
        makeItem({ title: 'Nothing', imagePath: ' ', audioPath: '' }),
        makeItem({ title: 'Hidden draft', imagePath: '', hidden: true }),
      ], [makeItem({ title: '', audioPath: '' })]),
    };

    expect(incompleteVisibleItems(docs)).toEqual([
      { locale: 'en', section: 'stories', title: 'No cover', missing: ['cover'] },
      { locale: 'en', section: 'stories', title: 'Nothing', missing: ['audio', 'cover'] },
      { locale: 'en', section: 'lullabies', title: '(без названия)', missing: ['audio'] },
    ]);
  });
});

describe('findCandidates', () => {
  const files = fileMap([
    'lullaby_images/lullaby_1.jpg',
    'stories/de/12. Der LÐ“Â¶we.mp3',
    'stories/de/13. Aladin.mp3',
    'stories/de/12. cover.jpg',
  ]);

  it('finds a file with the same name in another folder', () => {
    expect(findCandidates('images/lullaby_1.jpg', files, new Set())).toEqual([{ path: 'lullaby_images/lullaby_1.jpg', confidence: 'high' }]);
  });

  it('finds an unreferenced file with the same number in the same folder', () => {
    expect(findCandidates('stories/de/12. Der Löwe.mp3', files, new Set())).toEqual([{ path: 'stories/de/12. Der LÐ“Â¶we.mp3', confidence: 'medium' }]);
    expect(findCandidates('stories/de/12. Der Löwe.mp3', files, new Set(['stories/de/12. Der LÐ“Â¶we.mp3']))).toEqual([]);
  });

  it('matches different unicode normalization and case first', () => {
    const nfd = fileMap(['stories/fr/la reine.mp3'.normalize('NFD')]);
    expect(findCandidates('stories/fr/La Reine.mp3', nfd, new Set())).toHaveLength(1);
  });

  it('never links audio to another geo folder (regression: pt/36 → ru/36)', () => {
    const geoFiles = fileMap(['stories/ru/36.mp3', 'stories/pt/37.mp3']);
    expect(findCandidates('stories/pt/36.mp3', geoFiles, new Set())).toEqual([]);
  });

  it('returns nothing when there is no plausible file', () => {
    expect(findCandidates('stories/pt/36.mp3', files, new Set())).toEqual([]);
    expect(findCandidates('stories/pt/Mermaid.mp3', files, new Set())).toEqual([]);
  });
});

describe('runHealthChecks', () => {
  it('groups a missing file used in several geos and proposes a relink', () => {
    const en = makeDoc('en', [], [makeItem({ uid: 'e1', id: 'starry', imagePath: 'images/lullaby_1.jpg', audioPath: 'lullabies/0.mp3' })]);
    const ru = makeDoc('ru', [], [makeItem({ uid: 'r1', id: 'starry', imagePath: 'images/lullaby_1.jpg', audioPath: 'lullabies/0.mp3' })]);
    const files = fileMap(['lullaby_images/lullaby_1.jpg', 'lullabies/0.mp3']);
    const missing = byKind(runHealthChecks({ docs: { en, ru }, config, files }), 'missing-file');
    expect(missing).toHaveLength(1);
    expect(missing[0].refs.map((r) => r.locale)).toEqual(['en', 'ru']);
    expect(missing[0].fix).toEqual({ type: 'relink', from: 'images/lullaby_1.jpg', to: 'lullaby_images/lullaby_1.jpg', confidence: 'high' });
  });

  it('reports empty fields with severities', () => {
    const en = makeDoc('en', [makeItem({ title: '', description: '', imagePath: '' })]);
    const issues = byKind(runHealthChecks({ docs: { en }, config, files: fileMap([en.stories[0].audioPath]) }), 'empty-field');
    expect(issues.map((i) => i.severity).sort()).toEqual(['error', 'warning', 'warning']);
  });

  it('treats gaps in hidden drafts as reminders, not errors', () => {
    const en = makeDoc('en', [makeItem({ title: 'Draft', audioPath: '', hidden: true })]);
    const issues = byKind(runHealthChecks({ docs: { en }, config, files: fileMap([en.stories[0].imagePath]) }), 'empty-field');
    expect(issues.map((i) => i.severity)).toEqual(['info']);
    expect(issues[0].title).toContain('скрытый черновик');
  });

  it('flags duplicate ids with a fix for the second item', () => {
    const en = makeDoc('en', [makeItem({ uid: 'x1', id: 'same' }), makeItem({ uid: 'x2', id: 'same' })]);
    const files = fileMap(en.stories.flatMap((s) => [s.audioPath, s.imagePath]));
    const [issue] = byKind(runHealthChecks({ docs: { en }, config, files }), 'duplicate-id');
    expect(issue.fix).toEqual({ type: 'regenerate-id', locale: 'en', uid: 'x2' });
  });

  it('warns when different stories share a cover or audio', () => {
    const ru = makeDoc('ru',
      [makeItem({ id: 'rapunzel', imagePath: 'images/image_1.jpg', audioPath: 'a.mp3' })],
      [makeItem({ id: 'starry', imagePath: 'images/image_1.jpg', audioPath: 'a.mp3' })]);
    const issues = runHealthChecks({ docs: { ru }, config, files: fileMap(['images/image_1.jpg', 'a.mp3']) });
    expect(byKind(issues, 'shared-cover')).toHaveLength(1);
    expect(byKind(issues, 'duplicate-audio')).toHaveLength(1);
  });

  it('lists unused media with its probable geo', () => {
    const en = makeDoc('en', [makeItem({ audioPath: 'stories/en/1.mp3', imagePath: 'images/1.jpg' })]);
    const files = fileMap(['stories/en/1.mp3', 'images/1.jpg', 'stories/en/53.Alice.mp3', 'images/unused.jpg', 'README.md', 'other/x.mp3']);
    const orphans = byKind(runHealthChecks({ docs: { en }, config, files }), 'orphan-file');
    expect(orphans.map((o) => o.path).sort()).toEqual(['images/unused.jpg', 'stories/en/53.Alice.mp3']);
    expect(orphans.find((o) => o.path === 'stories/en/53.Alice.mp3')?.orphanLocale).toBe('en');
    expect(localeFromAudioPath(config, 'stories/xx/1.mp3', ['en'])).toBeUndefined();
  });

  it('warns about files near the GitHub limit and big files', () => {
    const en = makeDoc('en',
      [makeItem({ audioPath: 'big.mp3', imagePath: 'big.jpg' })],
      [makeItem({ audioPath: 'huge.mp3', imagePath: 'ok.jpg' })]);
    const files = fileMap({ 'big.mp3': 50 * 1024 * 1024, 'big.jpg': 2 * 1024 * 1024, 'huge.mp3': 99 * 1024 * 1024, 'ok.jpg': 10 });
    const issues = runHealthChecks({ docs: { en }, config, files });
    expect(byKind(issues, 'near-limit').map((i) => i.path)).toEqual(['huge.mp3']);
    expect(byKind(issues, 'large-file').map((i) => i.path).sort()).toEqual(['big.jpg', 'big.mp3']);
  });

  it('reports stories missing in some geos', () => {
    const en = makeDoc('en', [makeItem({ id: 'one' }), makeItem({ id: 'two' })]);
    const ru = makeDoc('ru', [makeItem({ id: 'one' })]);
    const files = fileMap([...en.stories, ...ru.stories].flatMap((s) => [s.audioPath, s.imagePath]));
    const [issue] = byKind(runHealthChecks({ docs: { en, ru }, config, files }), 'missing-translation');
    expect(issue.detail).toContain('RU');
  });

  it('plans safe renames for files with spaces or non-latin names', () => {
    const en = makeDoc('en', [makeItem({ id: 'rapunzel', audioPath: 'stories/en/1.Rapunzel story.mp3', imagePath: 'images/ok.jpg' })]);
    const files = fileMap(['stories/en/1.Rapunzel story.mp3', 'images/ok.jpg', 'stories/en/rapunzel.mp3']);
    const [issue] = byKind(runHealthChecks({ docs: { en }, config, files }), 'unsafe-paths');
    expect(issue.fix).toEqual({ type: 'rename-files', renames: [{ from: 'stories/en/1.Rapunzel story.mp3', to: 'stories/en/rapunzel-2.mp3' }] });
  });

  it('skips pending and missing files when planning renames', () => {
    const item = makeItem({ id: 'x', audioPath: 'a b.mp3', imagePath: 'c d.jpg' });
    const files = new Map([['a b.mp3', { size: 1, pending: true, renamedFrom: null }]]);
    expect(planSafeRenames([{ locale: 'en', section: 'stories', item }], files, config)).toEqual([]);
  });

  it('does not call files unused while a geo cannot be read', () => {
    const en = makeDoc('en', [makeItem({ audioPath: 'stories/en/1.mp3', imagePath: 'images/1.jpg' })]);
    const files = fileMap(['stories/en/1.mp3', 'images/1.jpg', 'stories/de/1.mp3']);
    const orphans = byKind(runHealthChecks({ docs: { en }, config, files, parseErrors: { de: 'broken' } }), 'orphan-file');
    expect(orphans).toHaveLength(1);
    expect(orphans[0]).toMatchObject({ key: 'orphans-skipped', severity: 'info' });
    expect(orphans[0].fix).toBeUndefined();
  });

  it('only turns clean slugs into file names when planning renames', () => {
    const item = makeItem({ id: 'weird/../id', audioPath: 'stories/en/a b.mp3', imagePath: '' });
    const files = fileMap(['stories/en/a b.mp3']);
    expect(planSafeRenames([{ locale: 'en', section: 'stories', item }], files, config))
      .toEqual([{ from: 'stories/en/a b.mp3', to: 'stories/en/file.mp3' }]);
  });

  it('puts parse errors and other errors first', () => {
    const issues = runHealthChecks({ docs: {}, config, files: new Map(), parseErrors: { fr: 'bad json' } });
    expect(issues[0]).toMatchObject({ kind: 'parse-error', severity: 'error' });
  });

  it('collects uids of items with problems', () => {
    const issues: Issue[] = [
      { key: '1', kind: 'empty-field', severity: 'error', title: '', refs: [{ locale: 'en', section: 'stories', uid: 'u1', title: '' }] },
      { key: '2', kind: 'large-file', severity: 'info', title: '', refs: [{ locale: 'en', section: 'stories', uid: 'u2', title: '' }] },
    ];
    expect([...issueUids(issues, new Set(['error']))]).toEqual(['u1']);
  });
});

describe('applyFix', () => {
  const item = makeItem({ uid: 'i1', id: 'dup', imagePath: 'images/lullaby_1.jpg' });
  const work: WorkState = {
    docs: { en: makeDoc('en', [item, makeItem({ uid: 'i2', id: 'dup', title: 'The Lost Dragon' })]) },
    config,
    deletions: [],
    renames: [],
  };

  it('relinks a path everywhere', () => {
    const next = applyFix(work, { type: 'relink', from: 'images/lullaby_1.jpg', to: 'lullaby_images/lullaby_1.jpg', confidence: 'high' });
    expect(next.docs.en.stories[0].imagePath).toBe('lullaby_images/lullaby_1.jpg');
  });

  it('marks files for deletion once and can undo it', () => {
    const once = applyFix(work, { type: 'delete-file', path: 'x.mp3' });
    expect(markForDeletion(once, ['x.mp3'])).toBe(once);
    expect(unmarkDeletion(once, 'x.mp3').deletions).toEqual([]);
    expect(unmarkDeletion(work, 'x.mp3')).toBe(work);
  });

  it('regenerates an id from the title', () => {
    const next = applyFix(work, { type: 'regenerate-id', locale: 'en', uid: 'i2' });
    expect(next.docs.en.stories[1].id).toBe('the-lost-dragon');
    expect(applyFix(work, { type: 'regenerate-id', locale: 'en', uid: 'nope' })).toBe(work);
  });

  it('renames files and collapses chains', () => {
    const first = applyFix(work, { type: 'rename-files', renames: [{ from: 'images/lullaby_1.jpg', to: 'images/a.jpg' }] });
    const second = renameFile(first, { from: 'images/a.jpg', to: 'images/b.jpg' });
    expect(second.renames).toEqual([{ from: 'images/lullaby_1.jpg', to: 'images/b.jpg' }]);
    expect(second.docs.en.stories[0].imagePath).toBe('images/b.jpg');
    const back = renameFile(second, { from: 'images/b.jpg', to: 'images/lullaby_1.jpg' });
    expect(back.renames).toEqual([]);
    expect(renameFile(work, { from: 'x', to: 'x' })).toBe(work);
  });
});
