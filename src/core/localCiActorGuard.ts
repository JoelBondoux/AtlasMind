/**
 * Who may start a GitHub job that reaches a machine AtlasMind lends.
 *
 * A trusted workflow authorises its one routed job with an actor condition, and
 * the local runner checks the same fact again before lending the machine: the
 * queued run it is about to claim must have been started by that actor.
 *
 * A personal repository has an owner account, and the condition is
 * `github.actor == github.repository_owner`. An organisation-owned repository
 * has none. There `github.repository_owner` is the organisation's name, which no
 * actor's login can equal, so that condition skips the job on every run, the
 * organisation's own members included, before GitHub consults a runner. The one
 * account allowed to start the job is pinned instead: `github.actor_id == '<id>'`.
 * The id rather than the login, because a login can be renamed and then claimed
 * by somebody else, while an id never moves.
 *
 * The workflow is read as text, like the rest of the trusted-workflow policy, but
 * comments are set aside first. A generated file explains its condition in prose,
 * and a condition that only appears in a comment authorises nothing.
 */

import { runGhOrThrow } from './ghClient.js';

/** A GitHub account a trusted workflow pins. */
export interface LocalCiAuthorizedAccount {
  /** GitHub's numeric account id. This is what the workflow compares. */
  id: number;
  /** The login when the pin was written, for people to read. Never compared. */
  login: string;
}

/** The actor condition a trusted workflow authorises its job with. */
export type LocalCiActorGuard =
  | { kind: 'repository-owner' }
  | { kind: 'account'; id: number };

export type LocalCiActorGuardRead =
  | { ok: true; guard: LocalCiActorGuard }
  | { ok: false; reason: string };

export type LocalCiRepositoryOwnerType = 'User' | 'Organization';

/** An account as GitHub reported it, with the repository's owner type where it was asked for. */
export interface LocalCiIdentity {
  login: string;
  id: number;
  ownerType?: LocalCiRepositoryOwnerType;
}

/** GitHub's login grammar: letters, digits and single inner hyphens, at most 39 characters. */
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const OWNER_CONDITION = /\bgithub\.actor\s*==\s*github\.repository_owner\b/i;
// No leading zero: `actor_id` is compared as a string, so '06105707' matches nobody.
const ACCOUNT_CONDITION = /\bgithub\.actor_id\s*==\s*(['"])([1-9][0-9]{0,15})\1/gi;

function objectOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isAccountId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isLogin(value: unknown): value is string {
  return typeof value === 'string' && GITHUB_LOGIN.test(value);
}

/** True for an account that can be written into a workflow condition and a comment safely. */
export function isLocalCiAuthorizedAccount(value: unknown): value is LocalCiAuthorizedAccount {
  const object = objectOf(value);
  return object !== undefined && isAccountId(object['id']) && isLogin(object['login']);
}

/** The workflow with whole-line and trailing comments set aside. */
function withoutComments(workflowText: string): string {
  return workflowText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter(line => !/^\s*#/.test(line))
    .map(line => line.replace(/\s#.*$/, ''))
    .join('\n');
}

/**
 * The one actor condition a trusted workflow authorises its job with.
 *
 * Exactly one is required. The owner condition beside a pinned account, or two
 * different pins, is refused: read as text the two cannot be told apart from
 * alternatives, and an alternative is a wider door than either one alone.
 */
export function readLocalCiActorGuard(workflowText: string): LocalCiActorGuardRead {
  const code = withoutComments(workflowText);
  const owner = OWNER_CONDITION.test(code);
  const ids = [...new Set([...code.matchAll(ACCOUNT_CONDITION)].map(match => Number(match[2])))];
  if (owner && ids.length > 0) {
    return {
      ok: false,
      reason: 'The job names both the repository owner and a pinned account. It must name exactly one: a pinned account id in an organisation-owned repository, the repository owner otherwise.',
    };
  }
  if (ids.length > 1) {
    return {
      ok: false,
      reason: `The job pins ${ids.length} different accounts. It must name exactly one account, by its GitHub account id.`,
    };
  }
  if (owner) {
    return { ok: true, guard: { kind: 'repository-owner' } };
  }
  if (ids.length === 1) {
    return { ok: true, guard: { kind: 'account', id: ids[0]! } };
  }
  return {
    ok: false,
    reason: "The job does not require the triggering actor to be the repository owner or one pinned account (github.actor_id == '<id>').",
  };
}

/**
 * An identity from `gh api … --jq '{login: …, id: …}'`, or nothing.
 *
 * `ownerType` is kept only when GitHub named one of the two owner kinds; any
 * other value stays unknown rather than being guessed into one of them.
 */
export function parseLocalCiIdentity(raw: string): LocalCiIdentity | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const object = objectOf(value);
  if (!object || !isLogin(object['login']) || !isAccountId(object['id'])) {
    return undefined;
  }
  const ownerType = object['ownerType'];
  return {
    login: object['login'],
    id: object['id'],
    ...(ownerType === 'User' || ownerType === 'Organization' ? { ownerType } : {}),
  };
}

export interface LocalCiActorContext {
  repoSlug: string;
  /** Who owns the repository, where GitHub was asked. */
  ownerType?: LocalCiRepositoryOwnerType;
  /**
   * Whose identity is checked: the actor of the queued run about to be claimed,
   * or the person signed in to GitHub CLI who is about to dispatch one.
   */
  subject: 'queued-run' | 'operator';
}

/**
 * Why this account may not start the job the workflow authorises, or nothing.
 *
 * A pinned account is matched by id alone: a renamed login still matches, and a
 * login somebody else has since claimed does not.
 */
export function localCiActorBlocker(
  guard: LocalCiActorGuard,
  account: Pick<LocalCiIdentity, 'login' | 'id'>,
  context: LocalCiActorContext,
): string | undefined {
  const owner = context.repoSlug.split('/')[0] ?? '';
  const who = context.subject === 'queued-run'
    ? `The queued run was triggered by ${account.login}`
    : `You are signed in to GitHub CLI as ${account.login}`;
  if (guard.kind === 'repository-owner') {
    if (context.ownerType === 'Organization') {
      return `${owner} is an organisation, so no account is this repository's owner and \`github.actor == github.repository_owner\` is never true: GitHub skips the job before any runner is asked. Patch the repository for local CI again so the workflow pins the account allowed to start it.`;
    }
    if (account.login.toLowerCase() !== owner.toLowerCase()) {
      return context.subject === 'queued-run'
        ? `${who}, not the repository owner ${owner}.`
        : `${who}, but only the repository owner ${owner} may start this workflow; GitHub would skip the job it queued.`;
    }
    return undefined;
  }
  if (account.id !== guard.id) {
    return context.subject === 'queued-run'
      ? `${who} (account ${account.id}), not the one account this workflow authorises (${guard.id}).`
      : `${who} (account ${account.id}), but this workflow authorises only account ${guard.id}; GitHub would skip the job it queued.`;
  }
  return undefined;
}

export type LocalCiDispatcherLookup =
  | { ok: true; ownerType: 'User' }
  | { ok: true; ownerType: 'Organization'; account: LocalCiAuthorizedAccount }
  | { ok: false; reason: string };

/**
 * The account a newly written trusted workflow should pin, if any.
 *
 * GitHub says who owns the repository. A personal repository keeps the owner
 * condition, byte for byte the file AtlasMind has always written. An
 * organisation-owned one pins the account signed in to GitHub CLI: the person
 * writing the file, who is also the person who will dispatch it.
 */
export async function lookUpLocalCiDispatcher(
  workspaceRoot: string,
  repoSlug: string,
): Promise<LocalCiDispatcherLookup> {
  try {
    const owner = parseLocalCiRepositoryOwnerType(await runGhOrThrow(workspaceRoot, [
      'api', `repos/${repoSlug}`, '--jq', '{ownerType: .owner.type}',
    ], { timeoutMs: 10_000, maxBufferBytes: 64 * 1024 }));
    if (owner === 'User') {
      return { ok: true, ownerType: 'User' };
    }
    if (owner !== 'Organization') {
      return { ok: false, reason: `GitHub did not say whether an account or an organisation owns ${repoSlug}.` };
    }
    const operator = parseLocalCiIdentity(await runGhOrThrow(workspaceRoot, [
      'api', 'user', '--jq', '{login: .login, id: .id}',
    ], { timeoutMs: 10_000, maxBufferBytes: 64 * 1024 }));
    if (!operator) {
      return { ok: false, reason: 'GitHub CLI did not report the signed-in account.' };
    }
    return { ok: true, ownerType: 'Organization', account: { id: operator.id, login: operator.login } };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error ?? 'unknown error');
    return { ok: false, reason: `GitHub CLI could not be asked who owns ${repoSlug}: ${detail.replace(/\s+/g, ' ').slice(0, 200)}` };
  }
}

/** `{ownerType: …}` from `gh api repos/<slug>`, or nothing. */
export function parseLocalCiRepositoryOwnerType(raw: string): LocalCiRepositoryOwnerType | undefined {
  try {
    const ownerType = objectOf(JSON.parse(raw))?.['ownerType'];
    return ownerType === 'User' || ownerType === 'Organization' ? ownerType : undefined;
  } catch {
    return undefined;
  }
}
