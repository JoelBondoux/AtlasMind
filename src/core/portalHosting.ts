/**
 * Where the producer portal is hosted, and — the part that actually decides
 * whether it is private — **who is allowed to see it**.
 *
 * `producerReportPublication` answers *what may leave the machine*, and answers
 * it on the assumption that whatever leaves is world-readable, because on GitHub
 * Pages it is. This module answers the next question: it need not be world
 * readable if the portal is hosted somewhere that can put an audience in front
 * of it. The two remain separate decisions and this one never relaxes that one
 * — see the last rule.
 *
 * Seven rules. The first is the whole feature.
 *
 * **Authentication is not authorisation.** "Sign in with GitHub" admits every
 * GitHub account in the world — something over a hundred million of them. A
 * portal behind a GitHub OAuth prompt and nothing else is a public portal with a
 * turnstile in front of it, and it is *worse* than an obviously public one,
 * because the turnstile is what persuades somebody to publish the cost figures
 * and the risk register. The allowlist is what turns a sign-in into an audience,
 * and a host that can do the first but not the second is reported as
 * `authenticated-but-open` rather than as protected.
 *
 * **AtlasMind declares; the host enforces.** Nothing in this module makes a page
 * private. It records a decision and tells you which console the enforcement
 * actually lives in. A switch here that looked like a gate would be the single
 * most dangerous control in the product, for exactly the reason above.
 *
 * **GitHub Pages cannot restrict an audience at all**, unless the whole of
 * Enterprise Cloud plus an organization-owned private-or-internal repository
 * plus a project site line up — and then the audience is *whoever can read the
 * repository*, which is a different list from the one you chose here. A
 * **public** repository is the loudest case and gets its own warning: the page
 * is public and so is every draft that produced it.
 *
 * **Unknown is treated as unable to restrict.** A custom host is something
 * AtlasMind knows nothing about, so it is assessed as offering no protection.
 * The assumption that keeps a secret, and the same one
 * `producerReportPublication` makes about unreadable repository visibility.
 *
 * **An audience member who cannot be expressed is reported, never dropped.** An
 * allowlist is built from identifiers a host understands — an email address, a
 * GitHub login — and a contact recorded only as a directory reference has
 * neither. Silently leaving them out produces a list that looks complete and one
 * person locked out with nothing to explain why.
 *
 * **The allowlist stores contact ids, never contact details.** `project_memory/`
 * is committed, and the Project Director module goes to some trouble to prefer a
 * system-of-record reference over raw personal data. An audience that quietly
 * became a committed list of email addresses would undo that, so resolution to
 * host identifiers happens at the point of use and is reported rather than
 * stored.
 *
 * **A restricted audience is not a reason to publish more.** It is tempting, and
 * it is the caller's decision rather than this module's: the restriction is
 * enforced by somebody else's product, configured in a console AtlasMind cannot
 * see, and one wrong policy makes it public again. Publication scope stays with
 * `producerReportPublication`, which still assumes the worst.
 *
 * Pure decisions plus `fs`-only persistence; `vscode`-free and unit-tested.
 *
 * The declaration is a **committed file** rather than a setting, for the reason
 * `workflowConfig` gives about its own: where a report is hosted and who may
 * read it is a statement about how a team works, and two developers must not be
 * able to hold different answers with nothing to arbitrate.
 */

import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DirectorContact } from '../types.js';

export const PORTAL_HOSTING_SSOT_PATH = 'project_memory/operations/portal-hosting.json';
export const PORTAL_HOSTING_SUMMARY_SSOT_PATH = 'project_memory/operations/portal-hosting.md';

/**
 * When each host's access-control facts were last read from its own
 * documentation. Pinned rather than implied, as `utilityPacks` and
 * `ACP_SPEC_VERIFIED_AT` are: plan tiers move, and a reader deserves to know how
 * old this is rather than to find out.
 */
export const PORTAL_HOSTING_VERIFIED_AT = '2026-09-09';

export const PORTAL_HOSTS = [
  'github-pages',
  'cloudflare-pages',
  'netlify',
  'vercel',
  'custom',
] as const;

export type PortalHost = typeof PORTAL_HOSTS[number];

/**
 * How far a host can go towards deciding who sees the portal.
 *
 * The distinction that matters runs between `named-audience` and everything
 * above it: only the first is a list of people you chose. `platform-members`
 * and `repository-readers` are real restrictions and they are *somebody else's
 * list*, which is a different thing and is worth saying out loud.
 */
export type AudienceControl =
  /** Cannot restrict at all. Anybody with the URL. */
  | 'none'
  /** One shared password. Not an audience — a password is passed on. */
  | 'shared-password'
  /** A list of people you name. The thing this feature is for. */
  | 'named-audience'
  /** Whoever is on your account at that platform, which costs a seat each. */
  | 'platform-members'
  /** Whoever can read the repository. Managed on GitHub, not here. */
  | 'repository-readers'
  /** AtlasMind does not know. Treated as `none`. */
  | 'unknown';

export interface PortalHostCapability {
  host: PortalHost;
  label: string;
  /** The best it can do, on the plan named in `audienceCost`. */
  control: AudienceControl;
  /** True when it can sign somebody in *with GitHub* specifically. */
  githubSignIn: boolean;
  /** What actually enforces it. Never AtlasMind — that is the point. */
  enforcedBy: string;
  /** What a named audience costs here, verified on the pinned date. */
  audienceCost: string;
  /** Prerequisites a person has to satisfy themselves. */
  requires: string;
  /** Everything else worth knowing before choosing it. */
  notes: string;
}

/**
 * What each host can actually do, read from each vendor's own documentation.
 *
 * Ordered by how well it answers the question this feature exists for: sign in
 * with GitHub, and restrict to people I name. Only one of them does that
 * without an enterprise contract, which is a fact worth putting first rather
 * than burying in a table.
 */
export const PORTAL_HOST_CAPABILITIES: readonly PortalHostCapability[] = [
  {
    host: 'cloudflare-pages',
    label: 'Cloudflare Pages',
    control: 'named-audience',
    githubSignIn: true,
    enforcedBy: 'Cloudflare Access, configured in the Cloudflare Zero Trust dashboard',
    audienceCost: 'Free for up to 50 users on the Zero Trust free plan; beyond that it is per user per month.',
    requires: 'A Cloudflare account with the site proxied through it, and an Access application covering the portal path.',
    notes: 'The only host here that both signs somebody in with GitHub and restricts to a list you name, without an enterprise plan. A policy can allow an explicit set of email addresses, an email domain, or membership of a GitHub organization.',
  },
  {
    host: 'vercel',
    label: 'Vercel',
    control: 'platform-members',
    githubSignIn: true,
    enforcedBy: 'Vercel Deployment Protection, configured in the Vercel project settings',
    audienceCost: 'Vercel Authentication is on every plan including Hobby, but it admits your Vercel team — so each viewer costs a seat. A shared password needs Enterprise or the Advanced Deployment Protection add-on on Pro; an external identity provider (Passport) is Enterprise only.',
    requires: 'Every viewer added to the Vercel team, or an enterprise plan for anything else.',
    notes: 'The audience is your Vercel team rather than a list you keep here. That is a real restriction and it is somebody else\'s list: adding a stakeholder to view a report means giving them an account on your deployment platform.',
  },
  {
    host: 'netlify',
    label: 'Netlify',
    control: 'shared-password',
    githubSignIn: false,
    enforcedBy: 'Netlify site protection, configured in the Netlify site settings',
    audienceCost: 'Site-wide password protection is on Pro. A named audience needs role-based access control with JWT, which is Enterprise only.',
    requires: 'A Pro plan for a password; an Enterprise plan for an audience.',
    notes: 'A shared password is not an audience: it is one secret, passed on, with no record of who used it and no way to remove one person. Useful against a search engine, not against disclosure.',
  },
  {
    host: 'github-pages',
    label: 'GitHub Pages',
    control: 'repository-readers',
    githubSignIn: true,
    enforcedBy: 'GitHub Pages access control, configured in the repository settings',
    audienceCost: 'Enterprise Cloud only.',
    requires: 'GitHub Enterprise Cloud, a private or internal repository owned by an organization, and a project site. Not a user site and not an organization site.',
    notes: 'Without all of that a Pages site is public even when the repository is private. Where it does apply, the audience is everybody with read access to the repository — managed on GitHub, not here, and usually a wider list than the one you would choose for a report.',
  },
  {
    host: 'custom',
    label: 'A host you run yourself',
    control: 'unknown',
    githubSignIn: false,
    enforcedBy: 'Whatever you put in front of it. AtlasMind cannot see it.',
    audienceCost: 'Unknown to AtlasMind — whatever your host charges for access control, if it offers any at all.',
    requires: 'Whatever that host requires. AtlasMind cannot check it and does not try.',
    notes: 'Recorded, not assessed. AtlasMind treats an unknown host as offering no protection, because assuming otherwise is the assumption that loses a secret.',
  },
];

const CAPABILITY_BY_HOST = new Map(PORTAL_HOST_CAPABILITIES.map(entry => [entry.host, entry]));

export function portalHostCapability(host: PortalHost): PortalHostCapability | undefined {
  return CAPABILITY_BY_HOST.get(host);
}

/**
 * True only where the host can restrict to a list of people you chose.
 *
 * `platform-members` and `repository-readers` deliberately answer false: they
 * are restrictions, and they are not *this* audience, and a surface that
 * conflated them would tell somebody their five named stakeholders had access
 * when the real answer was "everyone in the org".
 */
export function enforcesNamedAudience(host: PortalHost): boolean {
  return CAPABILITY_BY_HOST.get(host)?.control === 'named-audience';
}

// ── The declaration ──────────────────────────────────────────────

export interface PortalHostingConfig {
  version: 1;
  host: PortalHost;
  /** Where it is served. Display only; never used to decide anything. */
  siteUrl?: string;
  /**
   * Contact ids permitted to view. **Ids, never addresses** — see the PII rule.
   */
  audienceContactIds: string[];
  /**
   * When somebody asserted the host-side restriction is actually in place.
   *
   * A human's claim, never inferred: AtlasMind cannot see a Cloudflare Access
   * policy and must not pretend it can. It is cleared whenever the host changes,
   * because an assertion about Netlify says nothing about Vercel.
   */
  accessConfiguredAt?: string;
  /** Who asserted it, so the claim has a name against it. */
  accessConfiguredBy?: string;
  updatedAt?: string;
}

export function seedPortalHostingConfig(): PortalHostingConfig {
  // GitHub Pages is the default because it is where `/portal` already points,
  // and it is the one with the loudest warning. Defaulting to the safest host
  // would hide the problem rather than surface it.
  return { version: 1, host: 'github-pages', audienceContactIds: [] };
}

// ── Warnings ─────────────────────────────────────────────────────

export type PortalWarningSeverity = 'critical' | 'warning' | 'note';

export interface PortalWarning {
  code: string;
  severity: PortalWarningSeverity;
  message: string;
}

export type RepositoryVisibility = 'public' | 'private' | 'unknown';

/**
 * What is wrong, or worth knowing, about this combination.
 *
 * Ordered by consequence, and declaration order *is* the ranking so the list
 * cannot shuffle between renders. The GitHub Pages cases come first because
 * they are the ones where somebody believes they have protection and does not.
 */
export function portalHostingWarnings(
  config: PortalHostingConfig,
  visibility: RepositoryVisibility,
): PortalWarning[] {
  const warnings: PortalWarning[] = [];
  const capability = CAPABILITY_BY_HOST.get(config.host);
  const hasAudience = config.audienceContactIds.length > 0;

  if (config.host === 'github-pages') {
    if (visibility === 'public') {
      warnings.push({
        code: 'pages-public-repo',
        severity: 'critical',
        message: 'This repository is public and GitHub Pages cannot restrict who sees the portal. The page will be readable by anyone, and so is the source it was generated from. Nothing you set here changes that.',
      });
    } else if (visibility === 'private') {
      warnings.push({
        code: 'pages-private-repo',
        severity: 'critical',
        message: 'A GitHub Pages site is public even when the repository is private. Access control for Pages needs Enterprise Cloud, an organization-owned private or internal repository, and a project site — and then the audience is everybody with read access to the repository, not the list below.',
      });
    } else {
      warnings.push({
        code: 'pages-unknown-visibility',
        severity: 'critical',
        message: 'Repository visibility could not be read, so the portal is assumed public. A Pages site is public even when the repository is private, unless every Enterprise Cloud condition is met.',
      });
    }
  }

  // The rule the whole module exists for, applied to any host that can sign
  // somebody in and cannot then decide who.
  if (capability && capability.githubSignIn && capability.control !== 'named-audience'
    && config.host !== 'github-pages') {
    warnings.push({
      code: 'authenticated-but-open',
      severity: 'critical',
      message: `${capability.label} can ask somebody to sign in, but not restrict which signed-in people get through to a list you choose. Signing in with GitHub admits every GitHub account there is. A sign-in without an allowlist is a public portal with a turnstile in front of it.`,
    });
  }

  if (config.host === 'custom') {
    warnings.push({
      code: 'custom-host-unknown',
      severity: 'warning',
      message: 'AtlasMind knows nothing about this host and assesses it as offering no protection. That is the safe assumption, not a judgement about your setup — record what you have done in the note so the next person can read it.',
    });
  }

  if (config.host === 'netlify') {
    warnings.push({
      code: 'shared-password-is-not-an-audience',
      severity: 'warning',
      message: 'A shared site password is one secret that gets passed on. There is no record of who used it and no way to remove one person from it, so it is not the audience below.',
    });
  }

  if (config.host === 'vercel') {
    warnings.push({
      code: 'audience-costs-a-seat',
      severity: 'warning',
      message: 'Vercel Authentication admits your Vercel team, so every stakeholder who needs to read the portal needs an account on your deployment platform. That is a real restriction and it is a different list from the one below.',
    });
  }

  if (hasAudience && !enforcesNamedAudience(config.host)) {
    warnings.push({
      code: 'audience-not-enforceable',
      severity: 'critical',
      message: `${config.audienceContactIds.length} ${config.audienceContactIds.length === 1 ? 'person is' : 'people are'} listed as the portal audience, and ${capability?.label ?? 'this host'} cannot enforce a list. The names below are a record of intent, not a restriction, and nothing is stopping anybody else reading the page.`,
    });
  }

  if (enforcesNamedAudience(config.host) && !hasAudience) {
    warnings.push({
      code: 'no-audience-declared',
      severity: 'warning',
      message: 'This host can restrict the portal to people you name, and nobody is named. Until somebody is, an Access policy allowing "anyone who can sign in" is the same as no policy.',
    });
  }

  if (enforcesNamedAudience(config.host) && hasAudience && config.accessConfiguredAt === undefined) {
    warnings.push({
      code: 'access-not-confirmed',
      severity: 'warning',
      message: 'Nobody has confirmed the host-side policy is actually in place. AtlasMind cannot see it — this list is a declaration until somebody says they configured it.',
    });
  }

  return warnings;
}

// ── Resolving the audience ───────────────────────────────────────

export interface ResolvedAudienceMember {
  contactId: string;
  name: string;
  /** The identifier a host allowlist would use, when one is recorded. */
  identifier?: string;
  identifierKind?: 'email' | 'github';
  /** Stated when they cannot be put on any allowlist. Never silently dropped. */
  unresolvedReason?: string;
}

export interface ResolvedAudience {
  members: ResolvedAudienceMember[];
  /** Members with a usable identifier — the list you could paste into a policy. */
  resolvable: ResolvedAudienceMember[];
  /** Members who would be locked out. Reported loudly, never omitted. */
  unresolvable: ResolvedAudienceMember[];
  /** Contact ids naming nobody on the roster any more. */
  missingContactIds: string[];
}

function identifierFor(contact: DirectorContact): { value: string; kind: 'email' | 'github' } | undefined {
  // Email first: every host that takes an allowlist takes email addresses, and
  // only some take a GitHub login.
  const email = contact.links.find(link => link.kind === 'email' && link.handle.trim().length > 0);
  if (email) {
    return { value: email.handle.trim(), kind: 'email' };
  }
  const github = contact.links.find(link => link.kind === 'github' && link.handle.trim().length > 0);
  return github ? { value: github.handle.trim().replace(/^@/, ''), kind: 'github' } : undefined;
}

/**
 * Turn declared contact ids into identifiers a host allowlist could use.
 *
 * Resolution happens **here, at the point of use**, and the result is not
 * stored: the declaration keeps contact ids so a committed file never quietly
 * becomes a list of email addresses.
 *
 * A contact with no email and no GitHub handle is `unresolvable` and is
 * reported. That is the whole point — a person who cannot be expressed will not
 * get in, and a short allowlist that looks complete is how somebody spends an
 * afternoon wondering why the link does not work for them.
 */
export function resolvePortalAudience(
  config: PortalHostingConfig,
  contacts: readonly DirectorContact[],
): ResolvedAudience {
  const byId = new Map(contacts.map(contact => [contact.id, contact]));
  const members: ResolvedAudienceMember[] = [];
  const missingContactIds: string[] = [];

  for (const contactId of config.audienceContactIds) {
    const contact = byId.get(contactId);
    if (!contact) {
      // Named and no longer on the roster. Reported rather than dropped: an
      // audience quietly shrinking as people leave the contact list is how
      // somebody loses access with no record of it.
      missingContactIds.push(contactId);
      continue;
    }
    const identifier = identifierFor(contact);
    members.push(identifier
      ? {
        contactId,
        name: contact.name,
        identifier: identifier.value,
        identifierKind: identifier.kind,
      }
      : {
        contactId,
        name: contact.name,
        unresolvedReason: 'No email address or GitHub handle is recorded for this contact, so they cannot be put on any host allowlist.',
      });
  }

  return {
    members,
    resolvable: members.filter(member => member.identifier !== undefined),
    unresolvable: members.filter(member => member.identifier === undefined),
    missingContactIds,
  };
}

// ── Assessment ───────────────────────────────────────────────────

export interface PortalAccessAssessment {
  host: PortalHost;
  capability: PortalHostCapability;
  /** What this host can do, with `unknown` collapsed to `none`. */
  effectiveControl: Exclude<AudienceControl, 'unknown'>;
  /** True only when the declared list is genuinely enforced somewhere. */
  audienceEnforceable: boolean;
  warnings: PortalWarning[];
  audience: ResolvedAudience;
  /** One sentence a surface can show without restating the warnings. */
  summary: string;
}

/**
 * Everything a surface needs, decided in one place.
 *
 * `effectiveControl` collapses `unknown` to `none` rather than carrying it
 * through, so no caller can accidentally treat "we do not know" as a kind of
 * protection.
 */
export function assessPortalAccess(
  config: PortalHostingConfig,
  visibility: RepositoryVisibility,
  contacts: readonly DirectorContact[],
): PortalAccessAssessment {
  const capability = CAPABILITY_BY_HOST.get(config.host) ?? CAPABILITY_BY_HOST.get('custom')!;
  const effectiveControl = capability.control === 'unknown' ? 'none' : capability.control;
  const audience = resolvePortalAudience(config, contacts);
  const warnings = portalHostingWarnings(config, visibility);
  const audienceEnforceable = enforcesNamedAudience(config.host)
    && config.audienceContactIds.length > 0
    && config.accessConfiguredAt !== undefined;

  return {
    host: config.host,
    capability,
    effectiveControl,
    audienceEnforceable,
    warnings,
    audience,
    summary: describePortalAccess(capability, effectiveControl, audienceEnforceable, audience),
  };
}

function describePortalAccess(
  capability: PortalHostCapability,
  control: Exclude<AudienceControl, 'unknown'>,
  enforceable: boolean,
  audience: ResolvedAudience,
): string {
  if (enforceable) {
    const count = audience.resolvable.length;
    const gap = audience.unresolvable.length > 0
      ? ` ${audience.unresolvable.length} listed ${audience.unresolvable.length === 1 ? 'person has' : 'people have'} no identifier a policy could use and will not get in.`
      : '';
    return `Restricted to ${count} named ${count === 1 ? 'person' : 'people'} by ${capability.enforcedBy}.${gap}`;
  }
  switch (control) {
    case 'named-audience':
      return `${capability.label} can restrict the portal to people you name; that is not set up yet, so anyone with the URL can read it.`;
    case 'platform-members':
      return `${capability.label} restricts the portal to your platform team rather than to a list kept here.`;
    case 'shared-password':
      return `${capability.label} can put one shared password in front of the portal, which is not an audience.`;
    case 'repository-readers':
      return `${capability.label} restricts the portal to people who can read the repository, and only where every Enterprise Cloud condition is met. Otherwise it is public.`;
    default:
      return 'Anyone with the URL can read the portal. Nothing is restricting it.';
  }
}

/**
 * What a person has to do, in somebody else's console, to make this real.
 *
 * Steps rather than configuration: AtlasMind does not hold a Cloudflare token
 * and should not. Naming the console is the honest half of a feature whose
 * enforcement lives outside the editor.
 */
export function portalAccessSteps(host: PortalHost): string[] {
  switch (host) {
    case 'cloudflare-pages':
      return [
        'Deploy the prepared portal folder to Cloudflare Pages.',
        'In the Cloudflare Zero Trust dashboard, add an Access application covering the portal hostname and path.',
        'Add GitHub as a login method on that application, if you want people to sign in with GitHub.',
        'Add a policy that allows only the identifiers below — an explicit email list, an email domain, or a GitHub organization. Without this step the sign-in admits every GitHub account there is.',
        'Open the portal in a private window and confirm you are asked to sign in, and that an account outside the list is refused.',
      ];
    case 'vercel':
      return [
        'Deploy the prepared portal folder to Vercel.',
        'In the project settings, turn on Deployment Protection with Vercel Authentication.',
        'Add each viewer to the Vercel team, which is what that setting admits. Every viewer costs a seat.',
        'Open the portal in a private window and confirm an account outside the team is refused.',
      ];
    case 'netlify':
      return [
        'Deploy the prepared portal folder to Netlify.',
        'In the site settings, set a site-wide password (Pro plan or above).',
        'Share the password only with the people below, and remember that removing one person means changing it for everybody.',
        'For a real audience rather than a shared secret, role-based access control needs an Enterprise plan.',
      ];
    case 'github-pages':
      return [
        'Confirm whether every condition for private Pages applies: Enterprise Cloud, an organization-owned private or internal repository, and a project site.',
        'If it does, set the Pages visibility to private in the repository settings. The audience is then everybody with read access to that repository.',
        'If it does not — which is the usual case — the portal is public. Decide what may be published on that basis, or move it to a host that can restrict an audience.',
      ];
    default:
      return [
        'Put the prepared portal folder wherever you host it.',
        'Restrict it there. AtlasMind cannot see what you have done and assesses this host as offering no protection.',
        'Record what you set up, so the next person reading this knows what is protecting it.',
      ];
  }
}

// ── Persistence and the untrusted boundary ───────────────────────

const MAX_AUDIENCE = 200;
const MAX_FIELD = 240;

function clampField(value: unknown, max: number): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ').trim().slice(0, max)
    : '';
}

function sanitizeIsoDate(value: unknown): string | undefined {
  const raw = clampField(value, 40);
  if (!raw) {
    return undefined;
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

/**
 * Coerce a stored payload into a declaration.
 *
 * An unrecognised host reads as `custom`, never as one that can restrict: the
 * file is committed and hand-editable, and the reassuring direction is the one
 * worth refusing. A `siteUrl` that is not `https` is dropped rather than shown,
 * since it reaches a surface as a link.
 */
export function sanitizePortalHostingConfig(input: unknown): PortalHostingConfig {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return seedPortalHostingConfig();
  }
  const raw = input as Record<string, unknown>;
  const declared = clampField(raw['host'], 40) as PortalHost;
  const host: PortalHost = PORTAL_HOSTS.includes(declared) ? declared : 'custom';

  const seen = new Set<string>();
  const audienceContactIds: string[] = [];
  if (Array.isArray(raw['audienceContactIds'])) {
    for (const entry of raw['audienceContactIds'].slice(0, MAX_AUDIENCE * 2)) {
      const id = clampField(entry, 120);
      // Constrained to an identifier charset: this is a contact id, and it
      // reaches a lookup rather than being rendered as prose.
      if (!id || seen.has(id) || !/^[A-Za-z0-9._~:@+-]{1,120}$/.test(id)) {
        continue;
      }
      seen.add(id);
      audienceContactIds.push(id);
      if (audienceContactIds.length >= MAX_AUDIENCE) {
        break;
      }
    }
  }

  const siteUrl = clampField(raw['siteUrl'], MAX_FIELD);
  const accessConfiguredAt = sanitizeIsoDate(raw['accessConfiguredAt']);
  const accessConfiguredBy = clampField(raw['accessConfiguredBy'], MAX_FIELD);
  const updatedAt = sanitizeIsoDate(raw['updatedAt']);

  return {
    version: 1,
    host,
    ...(siteUrl.startsWith('https://') ? { siteUrl } : {}),
    audienceContactIds,
    // Only kept alongside a date: "somebody confirmed it" with no when is a
    // claim nobody can age, and this is the field that turns a declaration into
    // an assertion of enforcement.
    ...(accessConfiguredAt === undefined ? {} : { accessConfiguredAt }),
    ...(accessConfiguredAt !== undefined && accessConfiguredBy ? { accessConfiguredBy } : {}),
    ...(updatedAt === undefined ? {} : { updatedAt }),
  };
}

/**
 * Change the host, clearing the confirmation.
 *
 * The clear is the point. An assertion that a Netlify password is in place says
 * nothing about a Vercel deployment, and carrying it across would leave a
 * portal reading as enforced on a host nobody has configured. The site URL goes
 * with it, because it belonged to the previous host.
 */
export function setPortalHost(
  config: PortalHostingConfig,
  host: PortalHost,
  at: string,
): PortalHostingConfig {
  if (config.host === host) {
    return config;
  }
  return {
    version: 1,
    host,
    audienceContactIds: config.audienceContactIds,
    updatedAt: at,
  };
}

/** Add somebody to the audience. Ids only — never their details. */
export function addPortalViewer(
  config: PortalHostingConfig,
  contactId: string,
  at: string,
): PortalHostingConfig {
  if (config.audienceContactIds.includes(contactId) || config.audienceContactIds.length >= MAX_AUDIENCE) {
    return config;
  }
  return {
    ...config,
    audienceContactIds: [...config.audienceContactIds, contactId],
    updatedAt: at,
  };
}

/**
 * Remove somebody.
 *
 * Removing them here does **not** remove their access: the policy that admits
 * them lives in the host's console. The caller says so; this only keeps the
 * record straight.
 */
export function removePortalViewer(
  config: PortalHostingConfig,
  contactId: string,
  at: string,
): PortalHostingConfig {
  if (!config.audienceContactIds.includes(contactId)) {
    return config;
  }
  return {
    ...config,
    audienceContactIds: config.audienceContactIds.filter(id => id !== contactId),
    updatedAt: at,
  };
}

/** Record that somebody has configured the host-side restriction. */
export function confirmPortalAccess(
  config: PortalHostingConfig,
  by: string | undefined,
  at: string,
): PortalHostingConfig {
  return {
    ...config,
    accessConfiguredAt: at,
    ...(by === undefined ? {} : { accessConfiguredBy: by }),
    updatedAt: at,
  };
}

export function readPortalHostingConfig(workspaceRoot: string): PortalHostingConfig | undefined {
  try {
    return sanitizePortalHostingConfig(
      JSON.parse(readFileSync(path.join(workspaceRoot, PORTAL_HOSTING_SSOT_PATH), 'utf8')),
    );
  } catch {
    // Absent means never declared, which is a different thing from a default —
    // the caller decides whether to seed, and seeding on read would write a
    // committed file because somebody opened a tab.
    return undefined;
  }
}

export async function writePortalHostingConfig(
  workspaceRoot: string,
  config: PortalHostingConfig,
  contacts: readonly DirectorContact[],
  visibility: RepositoryVisibility,
): Promise<void> {
  const jsonPath = path.join(workspaceRoot, PORTAL_HOSTING_SSOT_PATH);
  const summaryPath = path.join(workspaceRoot, PORTAL_HOSTING_SUMMARY_SSOT_PATH);
  await mkdir(path.dirname(jsonPath), { recursive: true });
  await Promise.all([
    writeFile(jsonPath, JSON.stringify(config, null, 2), 'utf-8'),
    writeFile(summaryPath, renderPortalHostingMarkdown(config, contacts, visibility), 'utf-8'),
  ]);
}

/**
 * The human-readable mirror.
 *
 * Names people rather than their addresses, for the reason the declaration
 * stores ids: this file is committed, and a roster of email addresses in git is
 * exactly what the Project Director module avoids.
 */
export function renderPortalHostingMarkdown(
  config: PortalHostingConfig,
  contacts: readonly DirectorContact[],
  visibility: RepositoryVisibility,
): string {
  const assessment = assessPortalAccess(config, visibility, contacts);
  const lines: string[] = [
    '# Portal hosting',
    '',
    '> Generated from `portal-hosting.json` by AtlasMind. Hand edits to this file are lost.',
    '',
    `- **Host:** ${assessment.capability.label}`,
    `- **Enforced by:** ${assessment.capability.enforcedBy}`,
    `- **Audience declared:** ${config.audienceContactIds.length}`,
    `- **Enforced right now:** ${assessment.audienceEnforceable ? 'yes' : 'no'}`,
    '',
    assessment.summary,
    '',
    '**Authentication is not authorisation.** Signing in with GitHub admits every',
    'GitHub account there is. The allowlist is what turns a sign-in into an audience,',
    'and a host that can do the first but not the second is not protecting anything.',
    '',
    '**AtlasMind declares; the host enforces.** Nothing recorded here makes the portal',
    'private. The list below is a decision about who *should* see it; the policy that',
    'admits or refuses somebody lives in the host’s own console.',
    '',
  ];

  if (assessment.warnings.length > 0) {
    lines.push('## Warnings', '');
    for (const warning of assessment.warnings) {
      lines.push(`- **${warning.severity}** — ${warning.message}`);
    }
    lines.push('');
  }

  lines.push(`## Audience (${assessment.audience.members.length})`, '');
  if (assessment.audience.members.length === 0) {
    lines.push('_Nobody is named. That is not the same as nobody having access._', '');
  } else {
    for (const member of assessment.audience.members) {
      lines.push(member.identifier === undefined
        ? `- **${member.name}** — cannot be put on an allowlist: ${member.unresolvedReason ?? 'no usable identifier'}`
        : `- **${member.name}** — by ${member.identifierKind}`);
    }
    lines.push('');
  }

  if (assessment.audience.missingContactIds.length > 0) {
    lines.push(
      `_${assessment.audience.missingContactIds.length} named id${assessment.audience.missingContactIds.length === 1 ? '' : 's'} no longer match anybody on the roster._`,
      '',
    );
  }

  lines.push('## What has to be done, and where', '');
  for (const step of portalAccessSteps(config.host)) {
    lines.push(`1. ${step}`);
  }
  lines.push('', `_Host facts read ${PORTAL_HOSTING_VERIFIED_AT}. Last updated: ${config.updatedAt ?? 'never'}._`, '');
  return lines.join('\n');
}

/** Holds the declaration for the extension host. */
export class PortalHostingManager {
  private config: PortalHostingConfig | undefined;

  constructor(private readonly workspaceRoot: string | undefined) {
    this.config = workspaceRoot ? readPortalHostingConfig(workspaceRoot) : undefined;
  }

  /** Undefined until somebody declares one. Never seeded on read. */
  get(): PortalHostingConfig | undefined {
    return this.config;
  }

  /** The declaration, or the default, without writing anything. */
  getOrDefault(): PortalHostingConfig {
    return this.config ?? seedPortalHostingConfig();
  }

  reload(): void {
    this.config = this.workspaceRoot ? readPortalHostingConfig(this.workspaceRoot) : undefined;
  }

  async save(
    config: PortalHostingConfig,
    contacts: readonly DirectorContact[],
    visibility: RepositoryVisibility,
  ): Promise<void> {
    this.config = config;
    if (this.workspaceRoot) {
      await writePortalHostingConfig(this.workspaceRoot, config, contacts, visibility);
    }
  }
}
