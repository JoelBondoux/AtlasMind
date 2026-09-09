import { describe, expect, it } from 'vitest';
import {
  PORTAL_HOSTING_VERIFIED_AT,
  PortalHostingManager,
  addPortalViewer,
  confirmPortalAccess,
  removePortalViewer,
  renderPortalHostingMarkdown,
  sanitizePortalHostingConfig,
  seedPortalHostingConfig,
  setPortalHost,
  type PortalHostingConfig,
} from '../../src/core/portalHosting';
import type { DirectorContact } from '../../src/types';

const AT = '2026-09-09T10:00:00.000Z';
const LATER = '2026-09-10T10:00:00.000Z';

const contact = (id: string, name: string, email?: string): DirectorContact => ({
  id,
  name,
  kind: 'person',
  links: email ? [{ id: `${id}-0`, kind: 'email', label: 'Work', handle: email }] : [],
  piiStored: email !== undefined,
});

const ROSTER: DirectorContact[] = [
  contact('ada', 'Ada', 'ada@example.com'),
  contact('linus', 'Linus'),
];

const CONFIGURED: PortalHostingConfig = {
  version: 1,
  host: 'cloudflare-pages',
  audienceContactIds: ['ada'],
  accessConfiguredAt: AT,
  accessConfiguredBy: 'ada',
};

describe('changing the host clears the confirmation', () => {
  it('drops the assertion, because it was about a different host', () => {
    // An assertion that a Netlify password is in place says nothing about a
    // Vercel deployment, and carrying it across would leave a portal reading
    // as enforced on a host nobody configured.
    const moved = setPortalHost(CONFIGURED, 'vercel', LATER);
    expect(moved.host).toBe('vercel');
    expect(moved.accessConfiguredAt).toBeUndefined();
    expect(moved.accessConfiguredBy).toBeUndefined();
  });

  it('drops the site URL with it', () => {
    const moved = setPortalHost(
      { ...CONFIGURED, siteUrl: 'https://reports.example.com' },
      'netlify',
      LATER,
    );
    expect(moved.siteUrl).toBeUndefined();
  });

  it('keeps the audience, which is a decision about people rather than a host', () => {
    expect(setPortalHost(CONFIGURED, 'vercel', LATER).audienceContactIds).toEqual(['ada']);
  });

  it('changes nothing when the host is already that one', () => {
    expect(setPortalHost(CONFIGURED, 'cloudflare-pages', LATER)).toBe(CONFIGURED);
  });
});

describe('the audience', () => {
  it('adds and removes by id', () => {
    const added = addPortalViewer(seedPortalHostingConfig(), 'ada', AT);
    expect(added.audienceContactIds).toEqual(['ada']);
    expect(removePortalViewer(added, 'ada', LATER).audienceContactIds).toEqual([]);
  });

  it('does not add somebody twice', () => {
    const once = addPortalViewer(seedPortalHostingConfig(), 'ada', AT);
    expect(addPortalViewer(once, 'ada', LATER)).toBe(once);
  });

  it('does nothing when removing somebody who is not on it', () => {
    const config = seedPortalHostingConfig();
    expect(removePortalViewer(config, 'nobody', AT)).toBe(config);
  });
});

describe('the untrusted boundary', () => {
  it('reads an unrecognised host as custom, never as one that can restrict', () => {
    // The file is committed and hand-editable, and the reassuring direction is
    // the one worth refusing.
    const parsed = sanitizePortalHostingConfig({ version: 1, host: 'my-private-cloud', audienceContactIds: [] });
    expect(parsed.host).toBe('custom');
  });

  it('falls back to the default declaration on rubbish', () => {
    for (const input of [undefined, null, 7, 'text', []]) {
      expect(sanitizePortalHostingConfig(input).host).toBe('github-pages');
    }
  });

  it('drops a site URL that is not https, since it reaches a surface as a link', () => {
    expect(sanitizePortalHostingConfig({
      version: 1, host: 'netlify', audienceContactIds: [],
      siteUrl: 'javascript:alert(1)',
    }).siteUrl).toBeUndefined();
    expect(sanitizePortalHostingConfig({
      version: 1, host: 'netlify', audienceContactIds: [],
      siteUrl: 'http://reports.example.com',
    }).siteUrl).toBeUndefined();
  });

  it('keeps an https one', () => {
    expect(sanitizePortalHostingConfig({
      version: 1, host: 'netlify', audienceContactIds: [],
      siteUrl: 'https://reports.example.com',
    }).siteUrl).toBe('https://reports.example.com');
  });

  it('constrains a contact id to an identifier charset and de-duplicates', () => {
    const parsed = sanitizePortalHostingConfig({
      version: 1,
      host: 'cloudflare-pages',
      audienceContactIds: ['ada', 'ada', '<script>', 'grace hopper', 'linus'],
    });
    expect(parsed.audienceContactIds).toEqual(['ada', 'linus']);
  });

  it('drops a confirmation with no date, since nobody could age the claim', () => {
    const parsed = sanitizePortalHostingConfig({
      version: 1, host: 'cloudflare-pages', audienceContactIds: ['ada'],
      accessConfiguredBy: 'somebody',
    });
    expect(parsed.accessConfiguredAt).toBeUndefined();
    expect(parsed.accessConfiguredBy).toBeUndefined();
  });

  it('keeps a confirmation that has one', () => {
    const parsed = sanitizePortalHostingConfig({
      version: 1, host: 'cloudflare-pages', audienceContactIds: ['ada'],
      accessConfiguredAt: AT, accessConfiguredBy: 'ada',
    });
    expect(parsed.accessConfiguredAt).toBe(AT);
    expect(parsed.accessConfiguredBy).toBe('ada');
  });
});

describe('the markdown mirror', () => {
  it('names people, never their addresses', () => {
    // project_memory/ is committed, and a roster of email addresses in git is
    // exactly what the Project Director module avoids.
    const markdown = renderPortalHostingMarkdown(CONFIGURED, ROSTER, 'private');
    expect(markdown).toContain('Ada');
    expect(markdown).not.toContain('ada@example.com');
  });

  it('states both load-bearing rules', () => {
    const markdown = renderPortalHostingMarkdown(CONFIGURED, ROSTER, 'private');
    expect(markdown).toContain('Authentication is not authorisation');
    expect(markdown).toContain('AtlasMind declares; the host enforces');
  });

  it('says an empty audience is not the same as nobody having access', () => {
    const markdown = renderPortalHostingMarkdown(seedPortalHostingConfig(), ROSTER, 'public');
    expect(markdown).toContain('not the same as nobody having access');
  });

  it('reports somebody who cannot be put on an allowlist', () => {
    const markdown = renderPortalHostingMarkdown(
      { ...CONFIGURED, audienceContactIds: ['ada', 'linus'] },
      ROSTER,
      'private',
    );
    expect(markdown).toContain('cannot be put on an allowlist');
  });

  it('carries the date the host facts were read', () => {
    expect(renderPortalHostingMarkdown(CONFIGURED, ROSTER, 'private'))
      .toContain(PORTAL_HOSTING_VERIFIED_AT);
  });

  it('renders the same declaration identically every time', () => {
    expect(renderPortalHostingMarkdown(CONFIGURED, ROSTER, 'private'))
      .toBe(renderPortalHostingMarkdown(CONFIGURED, ROSTER, 'private'));
  });
});

describe('confirmation', () => {
  it('records who said it and when', () => {
    const confirmed = confirmPortalAccess(
      { version: 1, host: 'cloudflare-pages', audienceContactIds: ['ada'] },
      'ada',
      LATER,
    );
    expect(confirmed.accessConfiguredAt).toBe(LATER);
    expect(confirmed.accessConfiguredBy).toBe('ada');
  });
});

describe('the manager', () => {
  it('serves no declaration at all with no workspace, rather than a default', () => {
    // Absent means never declared, which is a different thing from a default —
    // and seeding on read would write a committed file because somebody opened
    // a tab.
    const manager = new PortalHostingManager(undefined);
    expect(manager.get()).toBeUndefined();
    expect(manager.getOrDefault().host).toBe('github-pages');
    manager.reload();
    expect(manager.get()).toBeUndefined();
  });
});
