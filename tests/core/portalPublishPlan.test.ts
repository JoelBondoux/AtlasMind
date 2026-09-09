import { describe, expect, it } from 'vitest';
import {
  buildPortalPublishPlan,
  describePortalPublishCommands,
  portalDeployCommand,
  type PortalPublishInput,
} from '../../src/core/portalPublishPlan';
import { PORTAL_HOSTS, type PortalHost, type PortalHostingConfig } from '../../src/core/portalHosting';
import type { DirectorContact } from '../../src/types';

const AT = '2026-09-09T10:00:00.000Z';

const contact = (id: string, name: string): DirectorContact => ({
  id,
  name,
  kind: 'person',
  links: [{ id: `${id}-0`, kind: 'email', label: 'Work', handle: `${id}@example.com` }],
  piiStored: true,
});

const ROSTER = [contact('ada', 'Ada'), contact('grace', 'Grace')];

const hosting = (
  host: PortalHost,
  extra: Partial<PortalHostingConfig> = {},
): PortalHostingConfig => ({
  version: 1,
  host,
  audienceContactIds: [],
  ...extra,
});

const input = (over: Partial<PortalPublishInput> = {}): PortalPublishInput => ({
  hosting: hosting('cloudflare-pages'),
  visibility: 'private',
  contacts: ROSTER,
  reportExists: true,
  publication: { publish: true, publishedSections: ['roadmap', 'delivery'], withheldSections: ['risks', 'cost'] },
  siteDir: 'project_memory/operations/producer-site',
  ...over,
});

describe('it refuses when the audience and the host disagree', () => {
  it('refuses named viewers on a host that cannot restrict a list', () => {
    // The mistake a one-press button makes fastest: somebody who named five
    // viewers believes the page is restricted, and one press puts it on the
    // open internet.
    const plan = buildPortalPublishPlan(input({
      hosting: hosting('github-pages', { audienceContactIds: ['ada', 'grace'] }),
    }));
    expect(plan.canPublish).toBe(false);
    const refusal = plan.refusals.find(entry => entry.code === 'audience-not-enforceable')!;
    expect(refusal.message).toContain('while the audience list says otherwise');
    expect(refusal.fix).toContain('clear the audience');
  });

  it('is a refusal rather than a warning, because a warning gets clicked past', () => {
    const plan = buildPortalPublishPlan(input({
      hosting: hosting('netlify', { audienceContactIds: ['ada'] }),
    }));
    expect(plan.canPublish).toBe(false);
  });

  it('does not refuse when nobody is named, so a knowingly public page still publishes', () => {
    const plan = buildPortalPublishPlan(input({ hosting: hosting('github-pages') }));
    expect(plan.refusals.map(entry => entry.code)).not.toContain('audience-not-enforceable');
  });

  it('does not refuse on a host that can enforce a named audience', () => {
    const plan = buildPortalPublishPlan(input({
      hosting: hosting('cloudflare-pages', {
        audienceContactIds: ['ada'],
        accessConfiguredAt: AT,
      }),
    }));
    expect(plan.canPublish).toBe(true);
  });
});

describe('unconfirmed access is not restricted access', () => {
  it('refuses to publish a risk register nobody has confirmed a policy for', () => {
    // AtlasMind cannot see a Cloudflare Access policy, and assuming one is
    // there is the moment this button publishes a risk register to the world.
    const plan = buildPortalPublishPlan(input({
      hosting: hosting('cloudflare-pages', { audienceContactIds: ['ada'] }),
      publication: { publish: true, publishedSections: ['roadmap', 'risks'], withheldSections: [] },
    }));
    const refusal = plan.refusals.find(entry => entry.code === 'access-not-confirmed')!;
    expect(refusal.message).toContain('treated as absent');
    expect(refusal.fix).toContain('stop publishing those sections');
  });

  it('allows an unconfirmed policy when nothing disclosing is published', () => {
    // A roadmap and a delivery date name nobody and are what a client asks for.
    const plan = buildPortalPublishPlan(input({
      hosting: hosting('cloudflare-pages', { audienceContactIds: ['ada'] }),
      publication: { publish: true, publishedSections: ['roadmap'], withheldSections: ['risks', 'cost'] },
    }));
    expect(plan.refusals.map(entry => entry.code)).not.toContain('access-not-confirmed');
    expect(plan.canPublish).toBe(true);
  });

  it('allows it once somebody has confirmed', () => {
    const plan = buildPortalPublishPlan(input({
      hosting: hosting('cloudflare-pages', { audienceContactIds: ['ada'], accessConfiguredAt: AT }),
      publication: { publish: true, publishedSections: ['roadmap', 'cost'], withheldSections: [] },
    }));
    expect(plan.canPublish).toBe(true);
  });
});

describe('publication has to be allowed first', () => {
  it('refuses when publication is switched off, and says which switch', () => {
    const plan = buildPortalPublishPlan(input({
      publication: { publish: false, reason: 'Publication is off.', publishedSections: [], withheldSections: [] },
    }));
    expect(plan.refusals[0]!.code).toBe('publication-not-allowed');
    expect(plan.refusals[0]!.fix).toContain('publishEnabled');
  });

  it('refuses when there is no report yet', () => {
    const plan = buildPortalPublishPlan(input({ reportExists: false }));
    expect(plan.refusals.map(entry => entry.code)).toContain('no-report');
  });

  it('gives every refusal a fix', () => {
    const plan = buildPortalPublishPlan(input({
      reportExists: false,
      publication: { publish: false, publishedSections: [], withheldSections: [] },
      hosting: hosting('netlify', { audienceContactIds: ['ada'] }),
    }));
    expect(plan.refusals.length).toBeGreaterThan(1);
    for (const refusal of plan.refusals) {
      expect(refusal.fix.length, refusal.code).toBeGreaterThan(20);
    }
  });
});

describe('AtlasMind performs only what a constant can express', () => {
  it('has a literal command per host it deploys to, and none for custom', () => {
    expect(portalDeployCommand('cloudflare-pages', 'site', false)).toEqual({
      file: 'npx', args: ['wrangler', 'pages', 'deploy', 'site'],
    });
    expect(portalDeployCommand('netlify', 'site', false)?.args).toContain('netlify');
    expect(portalDeployCommand('vercel', 'site', false)?.args).toContain('vercel');
    expect(portalDeployCommand('custom', 'site', true)).toBeUndefined();
  });

  it('passes arguments as argv, never as a shell string', () => {
    // A folder name cannot become a second command.
    for (const host of PORTAL_HOSTS) {
      const command = portalDeployCommand(host, 'a dir; rm -rf /', true);
      if (!command) { continue; }
      expect(Array.isArray(command.args), host).toBe(true);
      for (const arg of command.args) {
        expect(typeof arg).toBe('string');
      }
      // The dangerous string survives intact as one argument rather than being
      // joined into a command line.
      expect(command.args.some(arg => arg.includes(';')) || !command.args.includes('a dir; rm -rf /'))
        .toBe(true);
    }
  });

  it('never carries a shell metacharacter in the command itself', () => {
    for (const host of PORTAL_HOSTS) {
      const command = portalDeployCommand(host, 'site', true);
      if (!command) { continue; }
      for (const piece of [command.file, ...command.args.slice(0, 3)]) {
        expect(/[&|;`$><]/.test(piece), `${host}: ${piece}`).toBe(false);
      }
    }
  });

  it('stops after preparing on a custom host — the second action', () => {
    const plan = buildPortalPublishPlan(input({ hosting: hosting('custom') }));
    expect(plan.atlasCanDeploy).toBe(false);
    const last = plan.steps[plan.steps.length - 1]!;
    expect(last.actor).toBe('you');
    expect(last.detail).toContain('stops with the folder prepared');
    expect(plan.disclosure).toContain('publishing it is yours to do');
  });

  it('will not dispatch a Pages workflow that does not exist yet', () => {
    const missing = buildPortalPublishPlan(input({ hosting: hosting('github-pages') }));
    expect(missing.atlasCanDeploy).toBe(false);
    expect(missing.steps[missing.steps.length - 1]!.detail).toContain('Add Producer Portal Deploy Workflow');

    const present = buildPortalPublishPlan(input({
      hosting: hosting('github-pages'),
      workflowPresent: true,
    }));
    expect(present.atlasCanDeploy).toBe(true);
  });
});

describe('the plan says what cannot be undone', () => {
  it('marks the local steps reversible and the deploy not', () => {
    const plan = buildPortalPublishPlan(input({
      hosting: hosting('cloudflare-pages', { audienceContactIds: ['ada'], accessConfiguredAt: AT }),
    }));
    const local = plan.steps.filter(step => step.id !== 'deploy');
    expect(local.every(step => step.reversible)).toBe(true);
    expect(plan.steps.find(step => step.id === 'deploy')!.reversible).toBe(false);
  });

  it('says so in the disclosure', () => {
    const plan = buildPortalPublishPlan(input({
      hosting: hosting('cloudflare-pages', { audienceContactIds: ['ada'], accessConfiguredAt: AT }),
    }));
    expect(plan.disclosure).toContain('cannot be recalled');
  });

  it('names what is published and what is withheld', () => {
    const plan = buildPortalPublishPlan(input());
    expect(plan.disclosure).toContain('Will publish: roadmap, delivery');
    expect(plan.disclosure).toContain('Withheld: risks, cost');
  });

  it('carries who can read it, from the hosting assessment', () => {
    const plan = buildPortalPublishPlan(input({
      hosting: hosting('cloudflare-pages', { audienceContactIds: ['ada'], accessConfiguredAt: AT }),
    }));
    expect(plan.disclosure).toContain('Restricted to 1 named person');
  });
});

describe('nothing here turns a public switch on', () => {
  it('has no step that enables a host or creates a policy', () => {
    for (const host of PORTAL_HOSTS) {
      const plan = buildPortalPublishPlan(input({ hosting: hosting(host), workflowPresent: true }));
      const text = plan.steps.map(step => `${step.title} ${step.detail}`).join(' ').toLowerCase();
      expect(text, host).not.toContain('enable pages');
      expect(text, host).not.toContain('create an access policy');
    }
  });

  it('lists every command it is about to run, with its purpose', () => {
    const plan = buildPortalPublishPlan(input({
      hosting: hosting('cloudflare-pages', { audienceContactIds: ['ada'], accessConfiguredAt: AT }),
    }));
    const lines = describePortalPublishCommands(plan);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('npx wrangler pages deploy');
    expect(lines[0]).toContain('Publish to Cloudflare Pages');
  });

  it('lists nothing when there is nothing to run', () => {
    expect(describePortalPublishCommands(buildPortalPublishPlan(input({ hosting: hosting('custom') }))))
      .toEqual([]);
  });
});
