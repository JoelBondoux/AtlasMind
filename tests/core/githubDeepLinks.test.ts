import { describe, expect, it } from 'vitest';

import {
  describeMissingLinks,
  githubLinksForPage,
  PAGES_WITHOUT_GITHUB_EQUIVALENT,
  parseRepoSlug,
  resolveGithubLink,
} from '../../src/core/githubDeepLinks.js';

const SLUG = parseRepoSlug('JoelBondoux/AtlasMind')!;

describe('a slug is untrusted input', () => {
  it('reads the shapes a remote or gh actually produces', () => {
    for (const raw of [
      'JoelBondoux/AtlasMind',
      ' JoelBondoux/AtlasMind ',
      'https://github.com/JoelBondoux/AtlasMind',
      'https://www.github.com/JoelBondoux/AtlasMind',
      'git@github.com:JoelBondoux/AtlasMind.git',
      'https://github.com/JoelBondoux/AtlasMind.git',
    ]) {
      expect(parseRepoSlug(raw), raw).toEqual({ owner: 'JoelBondoux', repo: 'AtlasMind' });
    }
  });

  it('accepts the punctuation a repository name may really contain', () => {
    expect(parseRepoSlug('owner/my.repo_name-2')).toEqual({ owner: 'owner', repo: 'my.repo_name-2' });
  });

  it('refuses anything that could carry a path segment or a query', () => {
    // This is the whole reason for validating rather than checking for a slash:
    // the slug is interpolated into a URL, so a segment or a query inside it
    // would point the link somewhere else entirely.
    for (const raw of [
      'owner/repo/extra',
      'owner/repo?tab=readme',
      'owner/repo#anchor',
      'owner/../../etc',
      'owner/..',
      'owner/.',
      'owner/re po',
      'ow ner/repo',
      '-owner/repo',
      'owner-/repo',
      '/repo',
      'owner/',
      'owner',
      '',
      'owner/repo@evil.com',
      'javascript:alert(1)/x',
      'owner/repo\\..\\..\\x',
    ]) {
      expect(parseRepoSlug(raw), raw).toBeUndefined();
    }
  });

  it('refuses a non-string without throwing', () => {
    for (const raw of [undefined, null, 42, {}, []] as unknown[]) {
      expect(parseRepoSlug(raw as string | undefined)).toBeUndefined();
    }
  });

  it('caps an owner at 39 characters, as GitHub does', () => {
    expect(parseRepoSlug(`${'a'.repeat(39)}/repo`)).toBeTruthy();
    expect(parseRepoSlug(`${'a'.repeat(40)}/repo`)).toBeUndefined();
  });
});

describe('every link is on github.com, and nowhere else', () => {
  it('builds every URL on the pinned origin', () => {
    const pages = ['overview', 'issues', 'pullRequests', 'release', 'security', 'pipeline', 'repo', 'ssot'];
    for (const page of pages) {
      const links = githubLinksForPage(page, SLUG);
      expect(links.length, page).toBeGreaterThan(0);
      for (const link of links) {
        expect(link.url, page).toMatch(/^https:\/\/github\.com\/JoelBondoux\/AtlasMind/);
      }
    }
  });

  it('produces no links at all without a slug', () => {
    // A plausible-looking link to the wrong repository is worse than no button:
    // it points somebody at somebody else's issue tracker.
    expect(githubLinksForPage('issues', undefined)).toEqual([]);
    expect(resolveGithubLink('issues', 'issues', undefined)).toBeUndefined();
  });

  it('gives every link a label and a description of what is there', () => {
    for (const page of ['overview', 'issues', 'workflow', 'release', 'debt', 'director']) {
      for (const link of githubLinksForPage(page, SLUG)) {
        expect(link.id, page).toBeTruthy();
        expect(link.label, page).toBeTruthy();
        expect(link.detail.length, `${page}/${link.id}`).toBeGreaterThan(20);
      }
    }
  });

  it('keeps ids unique within a page, or resolution is ambiguous', () => {
    for (const page of ['overview', 'issues', 'pullRequests', 'repo', 'release', 'security', 'workflow']) {
      const ids = githubLinksForPage(page, SLUG).map(link => link.id);
      expect(new Set(ids).size, page).toBe(ids.length);
    }
  });
});

describe('only surfaces every repository has', () => {
  it('links to no feature that can be switched off', () => {
    // `/wiki` and `/discussions` 404 when disabled, and a 404 behind a button we
    // drew reads as our bug rather than as a repository setting.
    const everyUrl = [
      'overview', 'score', 'gapAnalysis', 'workflow', 'roadmap', 'issues', 'pullRequests', 'director',
      'repo', 'pipeline', 'testing', 'debt', 'security', 'release', 'delivery', 'documents', 'ssot',
    ].flatMap(page => githubLinksForPage(page, SLUG).map(link => link.url));
    expect(everyUrl.length).toBeGreaterThan(15);
    for (const url of everyUrl) {
      expect(url, url).not.toMatch(/\/(wiki|discussions|projects)(\/|$|\?)/);
    }
  });

  it('encodes a query rather than embedding raw spaces or colons', () => {
    // A raw `is:open no:assignee` in an href is a broken link in some clients and
    // a silently different search in others.
    for (const link of [...githubLinksForPage('issues', SLUG), ...githubLinksForPage('pullRequests', SLUG)]) {
      const query = link.url.split('?')[1];
      if (query === undefined) {
        continue;
      }
      expect(query, link.url).not.toMatch(/[ :@]/);
    }
  });
});

describe('a page with no GitHub equivalent says so', () => {
  it('has no links for the pages that are about this machine, not the repo', () => {
    for (const page of PAGES_WITHOUT_GITHUB_EQUIVALENT) {
      expect(githubLinksForPage(page, SLUG), page).toEqual([]);
    }
  });

  it('explains the absence rather than leaving a blank space', () => {
    // A blank space reads as something that failed to load.
    for (const page of PAGES_WITHOUT_GITHUB_EQUIVALENT) {
      expect(describeMissingLinks(page, SLUG), page).toMatch(/no GitHub equivalent/);
    }
  });

  it('distinguishes "no repository" from "no equivalent"', () => {
    // Different causes with different fixes: one is a `gh` sign-in, the other is
    // nothing at all.
    const noRepo = describeMissingLinks('issues', undefined);
    expect(noRepo).toMatch(/could not read a GitHub repository/);
    expect(noRepo).toMatch(/signed in/);
    expect(describeMissingLinks('issues', SLUG)).toBeUndefined();
  });
});

describe('resolution goes through this module, so a webview never names a URL', () => {
  it('resolves a known page and id', () => {
    expect(resolveGithubLink('issues', 'labels', SLUG)).toBe('https://github.com/JoelBondoux/AtlasMind/labels');
  });

  it('refuses an id that is not on that page', () => {
    // The id space is per page on purpose: `security` on the issues page would
    // otherwise resolve, and the button would go somewhere it was not drawn for.
    expect(resolveGithubLink('issues', 'dependabot', SLUG)).toBeUndefined();
    expect(resolveGithubLink('issues', 'nonsense', SLUG)).toBeUndefined();
    expect(resolveGithubLink('nonsense', 'issues', SLUG)).toBeUndefined();
  });

  it('cannot be made to resolve a URL supplied as an id', () => {
    expect(resolveGithubLink('issues', 'https://evil.example/', SLUG)).toBeUndefined();
    expect(resolveGithubLink('issues', '../../evil', SLUG)).toBeUndefined();
  });
});
