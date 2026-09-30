import { describe, expect, it } from 'vitest';
import {
  isLocalCiAuthorizedAccount,
  localCiActorBlocker,
  parseLocalCiIdentity,
  readLocalCiActorGuard,
} from '../../src/core/localCiActorGuard.ts';

function workflowWith(actorLine: string, extra = ''): string {
  return `name: Trusted local CI
${extra}
on:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  trusted-quality:
    if: >-
      github.repository == 'Hill-To-Die-On/Director-Of-Realms' &&
      github.ref == 'refs/heads/main' &&
      ${actorLine}
    runs-on: [atlasmind-trusted-linux-x64]
    steps:
      - run: npm test
`;
}

/**
 * An organisation owns no account, so `github.repository_owner` there is the
 * organisation's name and `github.actor == github.repository_owner` is false on
 * every run. The pinned account id is the condition that can hold, and the
 * reader has to tell the two apart without being fooled by prose about them.
 */
describe('reading the actor condition a trusted workflow authorises its job with', () => {
  it('reads the repository-owner condition a personal repository uses', () => {
    expect(readLocalCiActorGuard(workflowWith('github.actor == github.repository_owner')))
      .toEqual({ ok: true, guard: { kind: 'repository-owner' } });
  });

  it('reads one pinned account id, in either quote style and beside a trailing comment', () => {
    expect(readLocalCiActorGuard(workflowWith("github.actor_id == '6105707'")))
      .toEqual({ ok: true, guard: { kind: 'account', id: 6105707 } });
    expect(readLocalCiActorGuard(workflowWith('github.actor_id == "6105707"')))
      .toEqual({ ok: true, guard: { kind: 'account', id: 6105707 } });
    expect(readLocalCiActorGuard(workflowWith("github.actor_id == '6105707' # JoelBondoux")))
      .toEqual({ ok: true, guard: { kind: 'account', id: 6105707 } });
  });

  it('ignores a condition that appears only in a comment', () => {
    const quotedInProse = workflowWith(
      "github.event_name == 'workflow_dispatch'",
      "# Only JoelBondoux may start it: github.actor_id == '6105707'\n# not github.actor == github.repository_owner",
    );
    const read = readLocalCiActorGuard(quotedInProse);
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.reason).toMatch(/does not require the triggering actor/);
    }
  });

  it('keeps the real pin when the owner condition is only mentioned in a comment', () => {
    const explained = workflowWith(
      "github.actor_id == '6105707'",
      '# It is not `github.actor == github.repository_owner`: that names the organisation.',
    );
    expect(readLocalCiActorGuard(explained)).toEqual({ ok: true, guard: { kind: 'account', id: 6105707 } });
  });

  it('refuses a job that names both the owner and an account, or two accounts', () => {
    const both = readLocalCiActorGuard(workflowWith("github.actor == github.repository_owner || github.actor_id == '6105707'"));
    expect(both.ok).toBe(false);
    if (!both.ok) {
      expect(both.reason).toMatch(/exactly one/);
    }
    const two = readLocalCiActorGuard(workflowWith("(github.actor_id == '6105707' || github.actor_id == '42')"));
    expect(two.ok).toBe(false);
    if (!two.ok) {
      expect(two.reason).toMatch(/2 different accounts/);
    }
  });

  it('reads the same account pinned twice as one account', () => {
    const twice = workflowWith("github.actor_id == '6105707' && github.actor_id == '6105707'");
    expect(readLocalCiActorGuard(twice)).toEqual({ ok: true, guard: { kind: 'account', id: 6105707 } });
  });

  it('does not accept a comparison GitHub would never make true or never make at all', () => {
    // actor_id is a string: an unquoted number, a leading zero, or an inequality
    // is not the pin the generator writes, and is refused rather than guessed.
    for (const line of [
      'github.actor_id == 6105707',
      "github.actor_id == '06105707'",
      "github.actor_id != '6105707'",
      "github.actor == 'JoelBondoux'",
    ]) {
      expect({ line, ok: readLocalCiActorGuard(workflowWith(line)).ok }).toEqual({ line, ok: false });
    }
  });
});

describe('the account a trusted workflow may pin', () => {
  it('accepts a positive integer id and a GitHub-shaped login', () => {
    expect(isLocalCiAuthorizedAccount({ id: 6105707, login: 'JoelBondoux' })).toBe(true);
    expect(isLocalCiAuthorizedAccount({ id: 1, login: 'a' })).toBe(true);
    expect(isLocalCiAuthorizedAccount({ id: 42, login: 'hill-to-die-on-bot' })).toBe(true);
  });

  it('refuses anything that could not be written safely into a workflow', () => {
    for (const value of [
      undefined,
      null,
      'JoelBondoux',
      { id: '6105707', login: 'JoelBondoux' },
      { id: 0, login: 'JoelBondoux' },
      { id: -1, login: 'JoelBondoux' },
      { id: 1.5, login: 'JoelBondoux' },
      { id: Number.MAX_SAFE_INTEGER + 1, login: 'JoelBondoux' },
      { id: 6105707, login: '' },
      { id: 6105707, login: '-JoelBondoux' },
      { id: 6105707, login: 'JoelBondoux-' },
      { id: 6105707, login: 'Joel Bondoux' },
      { id: 6105707, login: "Joel'Bondoux" },
      { id: 6105707, login: 'a'.repeat(40) },
    ]) {
      expect({ value, valid: isLocalCiAuthorizedAccount(value) }).toEqual({ value, valid: false });
    }
  });
});

describe('reading an identity GitHub reported', () => {
  it('reads a login, an id and, where given, the repository owner type', () => {
    expect(parseLocalCiIdentity('{"login":"JoelBondoux","id":6105707,"ownerType":"Organization"}'))
      .toEqual({ login: 'JoelBondoux', id: 6105707, ownerType: 'Organization' });
    expect(parseLocalCiIdentity('{\n  "id": 6105707,\n  "login": "JoelBondoux"\n}\n'))
      .toEqual({ login: 'JoelBondoux', id: 6105707 });
  });

  it('keeps an unknown owner type unknown rather than guessing it', () => {
    expect(parseLocalCiIdentity('{"login":"JoelBondoux","id":6105707,"ownerType":"Enterprise"}'))
      .toEqual({ login: 'JoelBondoux', id: 6105707 });
  });

  it('refuses output that does not name one account', () => {
    for (const raw of ['', 'JoelBondoux', 'null', '[]', '{"login":"JoelBondoux"}', '{"id":6105707}', '{"login":"x y","id":1}', '{"login":"x","id":"1"}']) {
      expect({ raw, parsed: parseLocalCiIdentity(raw) }).toEqual({ raw, parsed: undefined });
    }
  });
});

describe('whether an account may start a job that reaches the lent machine', () => {
  const personal = { repoSlug: 'JoelBondoux/AtlasMind', ownerType: 'User' as const, subject: 'queued-run' as const };
  const organisation = { repoSlug: 'Hill-To-Die-On/Director-Of-Realms', ownerType: 'Organization' as const, subject: 'queued-run' as const };
  const joel = { login: 'JoelBondoux', id: 6105707 };

  it('lets the owner of a personal repository through, whatever the login casing', () => {
    expect(localCiActorBlocker({ kind: 'repository-owner' }, joel, personal)).toBeUndefined();
    expect(localCiActorBlocker({ kind: 'repository-owner' }, { login: 'joelbondoux', id: 6105707 }, personal)).toBeUndefined();
  });

  it('refuses anybody else in a personal repository', () => {
    expect(localCiActorBlocker({ kind: 'repository-owner' }, { login: 'someone', id: 7 }, personal))
      .toMatch(/triggered by someone, not the repository owner JoelBondoux/);
  });

  /**
   * The case that had never worked: in an organisation-owned repository the
   * owner condition is false for everyone, the organisation's own members
   * included, so the refusal has to say what to do instead of naming a person.
   */
  it('explains that an organisation has no owner account to match', () => {
    const reason = localCiActorBlocker({ kind: 'repository-owner' }, joel, organisation);
    expect(reason).toMatch(/Hill-To-Die-On is an organisation/);
    expect(reason).toMatch(/pin/);
  });

  it('matches a pinned account by id, so a renamed login still counts and a reused one does not', () => {
    const pinned = { kind: 'account' as const, id: 6105707 };
    expect(localCiActorBlocker(pinned, joel, organisation)).toBeUndefined();
    expect(localCiActorBlocker(pinned, { login: 'JoelRenamed', id: 6105707 }, organisation)).toBeUndefined();
    expect(localCiActorBlocker(pinned, { login: 'JoelBondoux', id: 99 }, organisation))
      .toMatch(/triggered by JoelBondoux \(account 99\), not the one account this workflow authorises \(6105707\)/);
  });

  it('speaks to the person at the keyboard before a dispatch GitHub would skip', () => {
    const operator = { ...organisation, subject: 'operator' as const };
    expect(localCiActorBlocker({ kind: 'account', id: 6105707 }, { login: 'someone', id: 7 }, operator))
      .toMatch(/signed in to GitHub CLI as someone/);
    expect(localCiActorBlocker({ kind: 'repository-owner' }, { login: 'someone', id: 7 }, { ...personal, subject: 'operator' }))
      .toMatch(/signed in to GitHub CLI as someone.*only the repository owner JoelBondoux/);
  });
});
