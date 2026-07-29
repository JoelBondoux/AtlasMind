import { describe, expect, it } from 'vitest';
import {
  BUILTIN_TEAM_ROLES,
  CODEOWNERS_MARKERS,
  buildCodeownersBlock,
  builtInRole,
  describeRoleApplication,
  normalizeGithubOwner,
  resolveTeamRoles,
  roleWorkspaceSettings,
  sanitizeTeamRole,
} from '../../src/core/teamRoles.ts';
import { upsertManagedBlock } from '../../src/utils/managedBlock.ts';

const role = (id: string) => {
  const found = builtInRole(id);
  expect(found, `${id} is missing`).toBeDefined();
  return found!;
};

describe('the shipped roles are meaningfully different', () => {
  it('ships the five documented roles', () => {
    expect(BUILTIN_TEAM_ROLES.map(r => r.id))
      .toEqual(['director', 'maintainer', 'contributor', 'reviewer', 'observer']);
  });

  it('gives every role a blurb that says what it is for', () => {
    // A role nobody can tell apart from another is a menu item, not a capability.
    for (const r of BUILTIN_TEAM_ROLES) {
      expect(r.blurb.length, r.id).toBeGreaterThan(40);
    }
  });

  it('grants protected-branch writes to the Director alone', () => {
    const granted = BUILTIN_TEAM_ROLES.filter(r => r.capabilities.protectedRefWrites);
    expect(granted.map(r => r.id)).toEqual(['director']);
  });

  it('separates preparing a release from promoting one', () => {
    // A maintainer can bump and draft; the promotion into a protected branch
    // still needs the Director. That split is why both roles exist.
    expect(role('maintainer').capabilities.releaseWrites).toBe(true);
    expect(role('maintainer').capabilities.protectedRefWrites).toBe(false);
  });

  it('stops a contributor merging their own work', () => {
    // The separation a review requirement exists to create.
    expect(role('contributor').capabilities.pullRequestWrites).toBe(false);
    expect(role('contributor').ceiling).toBe('draft');
  });

  it('gives reviewer and observer no write capability at all', () => {
    for (const id of ['reviewer', 'observer']) {
      const caps = role(id).capabilities;
      expect(Object.values(caps), id).toEqual([false, false, false, false]);
      expect(role(id).ceiling, id).toBe('observe');
    }
  });

  it('never grants auto to any shipped role', () => {
    // Unattended action is a decision an individual makes, not one a role
    // hands out on assignment.
    for (const r of BUILTIN_TEAM_ROLES) {
      expect(r.ceiling, r.id).not.toBe('auto');
    }
  });
});

describe('a role configures but never arms', () => {
  it('never writes the master switch', () => {
    // The master switch is described to users as the one control they need in
    // order to be certain. A role flipping it would take that away.
    for (const r of BUILTIN_TEAM_ROLES) {
      const keys = roleWorkspaceSettings(r).map(change => change.key);
      expect(keys, r.id).not.toContain('atlasmind.workflow.enabled');
    }
  });

  it('writes exactly the ceiling and the four capabilities', () => {
    const keys = roleWorkspaceSettings(role('maintainer')).map(c => c.key);
    expect(keys).toEqual([
      'atlasmind.workflow.maxAutomationLevel',
      'atlasmind.workflow.allowIssueWrites',
      'atlasmind.workflow.allowPullRequestWrites',
      'atlasmind.workflow.allowReleaseWrites',
      'atlasmind.workflow.allowProtectedRefWrites',
    ]);
  });

  it('gives every change a reason, so nobody approves what they cannot read', () => {
    for (const r of BUILTIN_TEAM_ROLES) {
      for (const change of roleWorkspaceSettings(r)) {
        expect(change.reason.length, `${r.id}/${change.key}`).toBeGreaterThan(10);
      }
    }
  });

  it('writes false explicitly rather than omitting a denied capability', () => {
    // Omission would leave a previously-granted capability in place, so
    // assigning a stricter role would not actually restrict anything.
    const changes = roleWorkspaceSettings(role('observer'));
    expect(changes.filter(c => c.value === false)).toHaveLength(4);
  });

  it('says in the confirmation that the workflow stays off and people can be stricter', () => {
    const text = describeRoleApplication(role('director'));
    expect(text).toContain('does not turn the workflow on');
    expect(text).toContain('more restrictive than the role');
  });

  it('builds the confirmation from the same values it will write', () => {
    const text = describeRoleApplication(role('contributor'));
    for (const change of roleWorkspaceSettings(role('contributor'))) {
      expect(text, change.key).toContain(`${change.key} = ${String(change.value)}`);
    }
  });

  it('warns in the reason when protected-branch writes are being granted', () => {
    const change = roleWorkspaceSettings(role('director'))
      .find(c => c.key === 'atlasmind.workflow.allowProtectedRefWrites');
    expect(change?.reason).toContain('Rarely correct');
  });
});

describe('normalizeGithubOwner validates rather than sanitises', () => {
  it('accepts a user and a team', () => {
    expect(normalizeGithubOwner('octocat')).toBe('@octocat');
    expect(normalizeGithubOwner('@octocat')).toBe('@octocat');
    expect(normalizeGithubOwner('acme/platform-team')).toBe('@acme/platform-team');
  });

  it('rejects anything GitHub would silently ignore', () => {
    // A plausible-but-wrong handle is worse than a rejected one: GitHub ignores
    // an owner it cannot resolve, so the path ends up with no reviewer and
    // nobody finds out until a change lands unreviewed.
    for (const bad of ['', '   ', '-leading', 'trailing-', 'has space', 'a--b', 'a'.repeat(40), 'e@mail.com']) {
      expect(normalizeGithubOwner(bad), JSON.stringify(bad)).toBeUndefined();
    }
    expect(normalizeGithubOwner(undefined)).toBeUndefined();
  });
});

describe('CODEOWNERS generation', () => {
  const build = (responsibilities: Parameters<typeof buildCodeownersBlock>[0]['responsibilities']) =>
    buildCodeownersBlock({ responsibilities });

  it('writes a path per responsibility with its owners', () => {
    const result = build([
      { area: 'Payments', paths: ['src/payments/'], ownerHandles: ['ana'] },
    ]);
    expect(result.block).toContain('src/payments/ @ana');
    expect(result.block).toContain('# Payments');
  });

  it('includes the backup as a second owner', () => {
    const result = build([
      { area: 'Payments', paths: ['src/payments/'], ownerHandles: ['ana'], backupHandles: ['ben'] },
    ]);
    expect(result.block).toContain('src/payments/ @ana @ben');
  });

  it('preserves input order, because CODEOWNERS is last-match-wins', () => {
    // Reordering entries silently changes who reviews what.
    const result = build([
      { area: 'All source', paths: ['src/'], ownerHandles: ['ana'] },
      { area: 'Payments', paths: ['src/payments/'], ownerHandles: ['ben'] },
    ]);
    expect(result.entries.map(e => e.path)).toEqual(['src/', 'src/payments/']);
    expect(result.block.indexOf('src/ @ana')).toBeLessThan(result.block.indexOf('src/payments/ @ben'));
  });

  it('refuses an overbroad pattern that would override every specific rule', () => {
    for (const path of ['*', '/*', '**']) {
      const result = build([{ area: 'Everything', paths: [path], ownerHandles: ['ana'] }]);
      expect(result.entries, path).toEqual([]);
      expect(result.warnings.join(' '), path).toContain('every file');
    }
  });

  it('drops an invalid owner and says so', () => {
    const result = build([
      { area: 'Payments', paths: ['src/payments/'], ownerHandles: ['ana', 'not a handle'] },
    ]);
    expect(result.block).toContain('src/payments/ @ana');
    expect(result.warnings.join(' ')).toContain('not a handle');
  });

  it('leaves out a responsibility with no usable owner rather than writing a reviewer-less rule', () => {
    const result = build([
      { area: 'Payments', paths: ['src/payments/'], ownerHandles: ['not a handle'] },
    ]);
    expect(result.entries).toEqual([]);
    expect(result.warnings.join(' ')).toContain('left out');
  });

  it('says when a responsibility has no paths, rather than silently skipping it', () => {
    const result = build([{ area: 'Design', ownerHandles: ['ana'] }]);
    expect(result.entries).toEqual([]);
    expect(result.warnings.join(' ')).toContain('no paths');
  });

  it('de-duplicates owners', () => {
    const result = build([
      { area: 'Payments', paths: ['src/payments/'], ownerHandles: ['ana', '@ana'], backupHandles: ['ana'] },
    ]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.owners).toEqual(['@ana']);
    expect(result.block).not.toContain('@ana @ana');
  });

  it('produces a block that says where to edit and that the rest is untouched', () => {
    const result = build([{ area: 'Payments', paths: ['src/'], ownerHandles: ['ana'] }]);
    expect(result.block).toContain('Project Director roster');
    expect(result.block).toContain('never touched');
  });
});

describe('CODEOWNERS writing never clobbers hand-written entries', () => {
  it('preserves rules outside the managed block', () => {
    // CODEOWNERS routes review. Replacing somebody's hand-written rules would
    // reassign review for paths nobody asked about.
    const existing = '# hand written\ndocs/ @tech-writers\n';
    const { block } = buildCodeownersBlock({
      responsibilities: [{ area: 'Payments', paths: ['src/payments/'], ownerHandles: ['ana'] }],
    });
    const written = upsertManagedBlock(existing, block, CODEOWNERS_MARKERS);

    expect(written).toContain('docs/ @tech-writers');
    expect(written).toContain('src/payments/ @ana');
    expect(written).toContain(CODEOWNERS_MARKERS.start);
    expect(written).toContain(CODEOWNERS_MARKERS.end);
  });

  it('replaces only the managed block on a second write', () => {
    const first = upsertManagedBlock(
      'docs/ @tech-writers\n',
      buildCodeownersBlock({ responsibilities: [{ area: 'A', paths: ['a/'], ownerHandles: ['ana'] }] }).block,
      CODEOWNERS_MARKERS,
    );
    const second = upsertManagedBlock(
      first,
      buildCodeownersBlock({ responsibilities: [{ area: 'B', paths: ['b/'], ownerHandles: ['ben'] }] }).block,
      CODEOWNERS_MARKERS,
    );

    expect(second).toContain('docs/ @tech-writers');
    expect(second).toContain('b/ @ben');
    expect(second).not.toContain('a/ @ana');
    expect(second.match(new RegExp(CODEOWNERS_MARKERS.start, 'g'))).toHaveLength(1);
  });
});

describe('a malformed role grants nothing', () => {
  it('defaults every capability to false and the ceiling to observe', () => {
    // A role document is editable by hand, and a missing field must never read
    // as consent.
    const role = sanitizeTeamRole({ id: 'partial' });
    expect(role?.ceiling).toBe('observe');
    expect(role?.capabilities).toEqual({
      issueWrites: false, pullRequestWrites: false, releaseWrites: false, protectedRefWrites: false,
    });
  });

  it('treats a non-boolean capability as denied', () => {
    const role = sanitizeTeamRole({
      id: 'sneaky',
      capabilities: { issueWrites: 'true', pullRequestWrites: 1, releaseWrites: {}, protectedRefWrites: 'yes' },
    });
    expect(Object.values(role!.capabilities)).toEqual([false, false, false, false]);
  });

  it('reads an unrecognised ceiling as observe rather than as the caller intended', () => {
    expect(sanitizeTeamRole({ id: 'x', ceiling: 'ludicrous' })?.ceiling).toBe('observe');
    expect(sanitizeTeamRole({ id: 'x', ceiling: 'AUTO' })?.ceiling).toBe('observe');
    expect(sanitizeTeamRole({ id: 'x', ceiling: 'auto' })?.ceiling).toBe('auto');
  });

  it('rejects an unusable id rather than coercing it', () => {
    for (const bad of [{}, null, { id: '' }, { id: 'Has Caps' }, { id: '-leading' }, { id: 42 }]) {
      expect(sanitizeTeamRole(bad), JSON.stringify(bad)).toBeUndefined();
    }
  });

  it('strips control characters from label and blurb', () => {
    const NUL = String.fromCharCode(0);
    const role = sanitizeTeamRole({ id: 'x', label: `a${NUL}b`, blurb: `c${NUL}d` });
    expect(role?.label).toBe('a b');
    expect(role?.blurb).toBe('c d');
  });
});

describe('resolveTeamRoles', () => {
  it('returns the built-ins when nothing is persisted', () => {
    expect(resolveTeamRoles(undefined).map(r => r.id))
      .toEqual(BUILTIN_TEAM_ROLES.map(r => r.id));
    expect(resolveTeamRoles('not an array').map(r => r.id))
      .toEqual(BUILTIN_TEAM_ROLES.map(r => r.id));
  });

  it('keeps an edit to a built-in', () => {
    const roles = resolveTeamRoles([{ id: 'contributor', label: 'Engineer', ceiling: 'propose' }]);
    const edited = roles.find(r => r.id === 'contributor');
    expect(edited?.label).toBe('Engineer');
    expect(edited?.ceiling).toBe('propose');
    expect(edited?.builtIn).toBe(true);
  });

  it('restores a built-in that was deleted', () => {
    // Deleting one would silently remove the expectations attached to everybody
    // already assigned it.
    const roles = resolveTeamRoles([{ id: 'contributor' }]);
    expect(roles.map(r => r.id)).toEqual(expect.arrayContaining(BUILTIN_TEAM_ROLES.map(r => r.id)));
  });

  it('appends custom roles after the built-ins', () => {
    const roles = resolveTeamRoles([{ id: 'auditor', label: 'Auditor' }]);
    expect(roles.at(-1)?.id).toBe('auditor');
    expect(roles.at(-1)?.builtIn).toBe(false);
  });

  it('drops an unusable persisted entry without losing the rest', () => {
    const roles = resolveTeamRoles([{ id: 'ok-role' }, null, { nope: true }, 'string']);
    expect(roles.some(r => r.id === 'ok-role')).toBe(true);
    expect(roles.length).toBe(BUILTIN_TEAM_ROLES.length + 1);
  });
});
