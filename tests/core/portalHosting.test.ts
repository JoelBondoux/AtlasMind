import { describe, expect, it } from 'vitest';
import {
  PORTAL_HOSTS,
  PORTAL_HOSTING_VERIFIED_AT,
  PORTAL_HOST_CAPABILITIES,
  assessPortalAccess,
  enforcesNamedAudience,
  portalAccessSteps,
  portalHostCapability,
  portalHostingWarnings,
  resolvePortalAudience,
  seedPortalHostingConfig,
  type PortalHost,
  type PortalHostingConfig,
  type RepositoryVisibility,
} from '../../src/core/portalHosting';
import type { DirectorContact } from '../../src/types';

const contact = (
  id: string,
  name: string,
  links: Array<{ kind: string; handle: string }> = [],
): DirectorContact => ({
  id,
  name,
  kind: 'person',
  links: links.map((link, index) => ({
    id: `${id}-${index}`,
    kind: link.kind,
    label: link.kind,
    handle: link.handle,
  })),
  piiStored: links.length > 0,
});

const ROSTER: DirectorContact[] = [
  contact('ada', 'Ada', [{ kind: 'email', handle: 'ada@example.com' }]),
  contact('grace', 'Grace', [{ kind: 'github', handle: '@grace' }]),
  contact('linus', 'Linus'),
];

const config = (
  host: PortalHost,
  extra: Partial<PortalHostingConfig> = {},
): PortalHostingConfig => ({
  version: 1,
  host,
  audienceContactIds: [],
  ...extra,
});

const codes = (
  host: PortalHost,
  visibility: RepositoryVisibility = 'private',
  extra: Partial<PortalHostingConfig> = {},
): string[] => portalHostingWarnings(config(host, extra), visibility).map(warning => warning.code);

describe('authentication is not authorisation', () => {
  it('warns when a host can sign somebody in and cannot then decide who', () => {
    // "Sign in with GitHub" admits every GitHub account there is. A sign-in
    // without an allowlist is a public portal with a turnstile in front of it.
    const warnings = portalHostingWarnings(config('vercel'), 'private');
    const open = warnings.find(warning => warning.code === 'authenticated-but-open');
    expect(open?.severity).toBe('critical');
    expect(open?.message).toContain('every GitHub account');
  });

  it('does not raise it for the one host that can restrict to a named list', () => {
    expect(codes('cloudflare-pages')).not.toContain('authenticated-but-open');
  });

  it('separates a named audience from somebody else\'s list', () => {
    // A restriction that is not *this* audience must never read as one.
    expect(enforcesNamedAudience('cloudflare-pages')).toBe(true);
    expect(enforcesNamedAudience('vercel')).toBe(false);
    expect(enforcesNamedAudience('github-pages')).toBe(false);
    expect(enforcesNamedAudience('netlify')).toBe(false);
    expect(enforcesNamedAudience('custom')).toBe(false);
  });

  it('says a shared password is not an audience', () => {
    const warnings = portalHostingWarnings(config('netlify'), 'private');
    const shared = warnings.find(warning => warning.code === 'shared-password-is-not-an-audience');
    expect(shared?.message).toContain('no way to remove one person');
  });
});

describe('GitHub Pages cannot restrict an audience', () => {
  it('is loudest about a public repository, and says the source is public too', () => {
    const warnings = portalHostingWarnings(config('github-pages'), 'public');
    const first = warnings[0]!;
    expect(first.code).toBe('pages-public-repo');
    expect(first.severity).toBe('critical');
    expect(first.message).toContain('so is the source');
  });

  it('warns differently, and still critically, for a private repository', () => {
    const warnings = portalHostingWarnings(config('github-pages'), 'private');
    expect(warnings[0]!.code).toBe('pages-private-repo');
    expect(warnings[0]!.severity).toBe('critical');
    expect(warnings[0]!.message).toContain('public even when the repository is private');
  });

  it('treats unreadable visibility as public', () => {
    // The assumption that keeps a secret, and the one producerReportPublication
    // already makes.
    const warnings = portalHostingWarnings(config('github-pages'), 'unknown');
    expect(warnings[0]!.code).toBe('pages-unknown-visibility');
    expect(warnings[0]!.severity).toBe('critical');
  });

  it('says the Enterprise Cloud audience is a different list from the one declared', () => {
    expect(portalHostCapability('github-pages')!.notes).toContain('read access to the repository');
    expect(portalHostingWarnings(config('github-pages'), 'private')[0]!.message)
      .toContain('not the list below');
  });
});

describe('unknown is treated as unable to restrict', () => {
  it('collapses a custom host to no protection', () => {
    const assessment = assessPortalAccess(config('custom'), 'private', ROSTER);
    expect(assessment.capability.control).toBe('unknown');
    // Collapsed, so no caller can treat "we do not know" as a kind of gate.
    expect(assessment.effectiveControl).toBe('none');
    expect(assessment.audienceEnforceable).toBe(false);
  });

  it('says that is an assumption rather than a judgement about the setup', () => {
    const warning = portalHostingWarnings(config('custom'), 'private')
      .find(entry => entry.code === 'custom-host-unknown');
    expect(warning?.message).toContain('not a judgement about your setup');
  });
});

describe('a declared audience that cannot be enforced is reported', () => {
  it('says the names are a record of intent, not a restriction', () => {
    const warnings = portalHostingWarnings(
      config('github-pages', { audienceContactIds: ['ada', 'grace'] }),
      'private',
    );
    const unenforceable = warnings.find(warning => warning.code === 'audience-not-enforceable');
    expect(unenforceable?.severity).toBe('critical');
    expect(unenforceable?.message).toContain('record of intent, not a restriction');
  });

  it('does not raise it on a host that can enforce one', () => {
    expect(codes('cloudflare-pages', 'private', { audienceContactIds: ['ada'] }))
      .not.toContain('audience-not-enforceable');
  });

  it('says an empty allowlist on a capable host is the same as no policy', () => {
    const warning = portalHostingWarnings(config('cloudflare-pages'), 'private')
      .find(entry => entry.code === 'no-audience-declared');
    expect(warning?.message).toContain('the same as no policy');
  });
});

describe('AtlasMind declares; the host enforces', () => {
  it('never counts an audience as enforced until somebody says they set it up', () => {
    // AtlasMind cannot see a Cloudflare Access policy and must not pretend to.
    const declared = assessPortalAccess(
      config('cloudflare-pages', { audienceContactIds: ['ada'] }),
      'private',
      ROSTER,
    );
    expect(declared.audienceEnforceable).toBe(false);
    expect(declared.warnings.map(warning => warning.code)).toContain('access-not-confirmed');
  });

  it('counts it once somebody has', () => {
    const confirmed = assessPortalAccess(
      config('cloudflare-pages', {
        audienceContactIds: ['ada'],
        accessConfiguredAt: '2026-09-09T10:00:00.000Z',
        accessConfiguredBy: 'ada',
      }),
      'private',
      ROSTER,
    );
    expect(confirmed.audienceEnforceable).toBe(true);
    expect(confirmed.summary).toContain('Restricted to 1 named person');
  });

  it('names the console the enforcement actually lives in', () => {
    for (const capability of PORTAL_HOST_CAPABILITIES) {
      expect(capability.enforcedBy.length, capability.host).toBeGreaterThan(10);
      // Never AtlasMind — that is the point of the field.
      expect(capability.enforcedBy).not.toContain('AtlasMind Settings');
    }
  });

  it('gives every host steps that happen somewhere else', () => {
    for (const host of PORTAL_HOSTS) {
      const steps = portalAccessSteps(host);
      expect(steps.length, host).toBeGreaterThanOrEqual(3);
    }
    expect(portalAccessSteps('cloudflare-pages').join(' ')).toContain('Zero Trust dashboard');
    // And the step that is the whole feature.
    expect(portalAccessSteps('cloudflare-pages').join(' ')).toContain('admits every GitHub account');
  });
});

describe('resolving the audience', () => {
  it('prefers an email, because every allowlist takes one', () => {
    const resolved = resolvePortalAudience(
      config('cloudflare-pages', { audienceContactIds: ['ada'] }),
      ROSTER,
    );
    expect(resolved.resolvable[0]!.identifier).toBe('ada@example.com');
    expect(resolved.resolvable[0]!.identifierKind).toBe('email');
  });

  it('falls back to a GitHub handle, without the @', () => {
    const resolved = resolvePortalAudience(
      config('cloudflare-pages', { audienceContactIds: ['grace'] }),
      ROSTER,
    );
    expect(resolved.resolvable[0]!.identifier).toBe('grace');
    expect(resolved.resolvable[0]!.identifierKind).toBe('github');
  });

  it('reports somebody who cannot be expressed rather than dropping them', () => {
    // A short allowlist that looks complete is how one person spends an
    // afternoon wondering why the link does not work for them.
    const resolved = resolvePortalAudience(
      config('cloudflare-pages', { audienceContactIds: ['ada', 'linus'] }),
      ROSTER,
    );
    expect(resolved.resolvable).toHaveLength(1);
    expect(resolved.unresolvable).toHaveLength(1);
    expect(resolved.unresolvable[0]!.name).toBe('Linus');
    expect(resolved.unresolvable[0]!.unresolvedReason).toContain('cannot be put on any host allowlist');
    expect(resolved.members).toHaveLength(2);
  });

  it('carries the gap into the summary', () => {
    const assessment = assessPortalAccess(
      config('cloudflare-pages', {
        audienceContactIds: ['ada', 'linus'],
        accessConfiguredAt: '2026-09-09T10:00:00.000Z',
      }),
      'private',
      ROSTER,
    );
    expect(assessment.summary).toContain('will not get in');
  });

  it('reports a contact who has left the roster', () => {
    const resolved = resolvePortalAudience(
      config('cloudflare-pages', { audienceContactIds: ['ada', 'departed'] }),
      ROSTER,
    );
    expect(resolved.missingContactIds).toEqual(['departed']);
    expect(resolved.members).toHaveLength(1);
  });

  it('stores contact ids and never contact details', () => {
    // project_memory/ is committed, and the Director module goes to trouble to
    // prefer a system-of-record reference over raw personal data.
    const stored = config('cloudflare-pages', { audienceContactIds: ['ada'] });
    expect(JSON.stringify(stored)).not.toContain('ada@example.com');
  });
});

describe('the declared capabilities', () => {
  it('covers every host, with its cost and prerequisites stated', () => {
    expect(PORTAL_HOST_CAPABILITIES).toHaveLength(PORTAL_HOSTS.length);
    for (const host of PORTAL_HOSTS) {
      const capability = portalHostCapability(host);
      expect(capability, host).toBeDefined();
      expect(capability!.audienceCost.length, host).toBeGreaterThan(8);
      expect(capability!.requires.length, host).toBeGreaterThan(8);
      expect(capability!.notes.length, host).toBeGreaterThan(20);
    }
  });

  it('pins when those facts were read', () => {
    expect(PORTAL_HOSTING_VERIFIED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('leads with the one host that answers the question without an enterprise plan', () => {
    expect(PORTAL_HOST_CAPABILITIES[0]!.host).toBe('cloudflare-pages');
    expect(PORTAL_HOST_CAPABILITIES[0]!.control).toBe('named-audience');
    expect(PORTAL_HOST_CAPABILITIES[0]!.githubSignIn).toBe(true);
  });
});

describe('the default', () => {
  it('starts on GitHub Pages rather than on the safest host', () => {
    // Defaulting to the safe one would hide the problem instead of surfacing
    // it: /portal already points at Pages, and that is what needs the warning.
    const seeded = seedPortalHostingConfig();
    expect(seeded.host).toBe('github-pages');
    expect(seeded.audienceContactIds).toEqual([]);
    expect(seeded.accessConfiguredAt).toBeUndefined();
  });

  it('assesses a fresh config as offering nothing', () => {
    const assessment = assessPortalAccess(seedPortalHostingConfig(), 'unknown', []);
    expect(assessment.audienceEnforceable).toBe(false);
    expect(assessment.warnings.some(warning => warning.severity === 'critical')).toBe(true);
  });
});

describe('warnings are ordered by consequence and cannot shuffle', () => {
  it('puts the case where somebody believes they are protected first', () => {
    const warnings = portalHostingWarnings(
      config('github-pages', { audienceContactIds: ['ada'] }),
      'public',
    );
    expect(warnings[0]!.code).toBe('pages-public-repo');
  });

  it('produces the same order every time', () => {
    const once = codes('vercel', 'private', { audienceContactIds: ['ada'] });
    const twice = codes('vercel', 'private', { audienceContactIds: ['ada'] });
    expect(once).toEqual(twice);
  });
});
