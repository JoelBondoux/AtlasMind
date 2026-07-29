import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { isProjectDashboardMessage } from '../../src/views/projectDashboardPanel.ts';

/**
 * Applying a role writes settings that affect everyone who opens the repository,
 * and generating CODEOWNERS writes a file GitHub reads to route review. Both are
 * outward-facing in a way the Director page has not been before, so the
 * properties that make them safe are pinned against the real source.
 */

const PANEL = readFileSync(
  path.join(process.cwd(), 'src', 'views', 'projectDashboardPanel.ts'),
  'utf8',
);
const WEBVIEW = readFileSync(
  path.join(process.cwd(), 'media', 'projectDashboard.js'),
  'utf8',
);

function handler(name: string, until: string): string {
  const start = PANEL.indexOf(`private async ${name}(`);
  expect(start, `${name} is missing`).toBeGreaterThan(-1);
  const end = PANEL.indexOf(until, start);
  return PANEL.slice(start, end === -1 ? start + 9000 : end);
}

describe('the boundary accepts an id, never a payload of settings', () => {
  it('accepts a slug-shaped role id', () => {
    expect(isProjectDashboardMessage({ type: 'applyTeamRole', payload: { roleId: 'maintainer' } })).toBe(true);
  });

  it('refuses anything that is not a slug', () => {
    for (const roleId of ['Has Caps', '-leading', '', 'a'.repeat(80), 42, undefined, null]) {
      expect(isProjectDashboardMessage({ type: 'applyTeamRole', payload: { roleId } }), String(roleId)).toBe(false);
    }
  });

  it('takes no payload at all for CODEOWNERS', () => {
    // The content comes entirely from the persisted roster, so the webview
    // cannot influence what gets written into a file GitHub reads.
    expect(isProjectDashboardMessage({ type: 'generateCodeowners' })).toBe(true);
    const source = handler('handleGenerateCodeowners', 'Hand an issue to chat');
    expect(source).not.toMatch(/payload/);
  });

  it('never lets the webview supply setting values', () => {
    const source = handler('handleApplyTeamRole', 'Write the managed CODEOWNERS');
    // Values come from `roleWorkspaceSettings(role)`, derived from the resolved
    // role — not from anything that crossed the boundary.
    expect(source).toContain('roleWorkspaceSettings(role)');
    expect(source).not.toMatch(/payload\['?(value|key|settings)/);
  });
});

describe('applying a role is confirmed and bounded', () => {
  const source = handler('handleApplyTeamRole', 'Write the managed CODEOWNERS');

  it('confirms modally before writing anything', () => {
    expect(source).toContain('{ modal: true, detail: describeRoleApplication(role) }');
    expect(source).toMatch(/if \(confirmation !== 'Yes, apply it'\) \{\s*return;/);
  });

  it('writes to workspace scope, which is what makes a role apply to the team', () => {
    expect(source).toContain('vscode.ConfigurationTarget.Workspace');
  });

  it('resolves the role from the persisted list rather than trusting the id', () => {
    expect(source).toContain('resolveTeamRoles(config?.roles)');
    expect(source).toMatch(/if \(!role\) \{[\s\S]{0,200}?return;/);
  });

  it('tells the user afterwards that they can still be stricter', () => {
    expect(source).toContain('more restrictive');
    expect(source).toContain('until they turn it on');
  });
});

describe('CODEOWNERS is written without clobbering hand-written rules', () => {
  const source = handler('handleGenerateCodeowners', 'Hand an issue to chat');

  it('writes through the managed block rather than replacing the file', () => {
    // Replacing somebody's hand-written rules would reassign review for paths
    // nobody asked about.
    expect(source).toContain('upsertManagedBlock(existing, block, CODEOWNERS_MARKERS)');
    expect(source).not.toMatch(/writeFile\(file,\s*block/);
  });

  it('shows the exact block before writing it', () => {
    expect(source).toContain('{ modal: true, detail }');
    expect(source).toMatch(/if \(confirmation !== 'Yes, write it'\) \{\s*return;/);
  });

  it('refuses to write when nothing resolved, and says why', () => {
    // Writing an empty managed block would silently remove previously generated
    // rules, so an empty result stops rather than proceeding.
    expect(source).toMatch(/if \(entries\.length === 0\)/);
    expect(source).toContain('No responsibility has both a path pattern');
  });

  it('reports what was left out rather than dropping it silently', () => {
    expect(source).toContain('Left out:');
  });

  it('reads GitHub handles from the contact rather than inventing them', () => {
    expect(source).toContain("link.kind === 'github'");
  });
});

describe('the surface states what a role is not', () => {
  const card = WEBVIEW.slice(
    WEBVIEW.indexOf('function renderTeamRoles'),
    WEBVIEW.indexOf('function renderDirectorResponsibilities'),
  );

  it('says plainly that a role is not a permission boundary', () => {
    // The obvious reading of "roles and restrictions" is a permission system,
    // and AtlasMind cannot be one. Saying so here is cheaper than somebody
    // discovering it later.
    expect(card).toContain('not</strong> a permission boundary');
    expect(card).toContain('cannot enforce one');
  });

  it('says where restriction actually bites', () => {
    expect(card).toContain('GitHub enforces that');
  });

  it('says applying a role does not turn the workflow on', () => {
    expect(card).toContain('never turns the workflow on');
  });

  it('escapes every role field it renders', () => {
    for (const field of ['role.label', 'role.blurb', 'role.ceiling', 'role.id']) {
      const escaped = new RegExp(`escape(Html|Attr)\\(${field.replace('.', '\\.')}\\)`);
      expect(escaped.test(card), field).toBe(true);
    }
  });

  it('uses no inline event handlers', () => {
    expect(card).not.toMatch(/\son(click|change|input)=/);
  });
});
