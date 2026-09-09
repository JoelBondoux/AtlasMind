import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * One press builds and publishes the portal. Collapsing six steps into one is
 * exactly when the guards this codebase spent so long on become easy to skip,
 * so three properties are pinned here rather than trusted.
 */

const WEBVIEW = readFileSync(
  path.join(process.cwd(), 'media', 'projectDashboard.js'),
  'utf8',
).replace(/\r\n/g, '\n');
const COMMAND = readFileSync(
  path.join(process.cwd(), 'src', 'views', 'portalPublishCommand.ts'),
  'utf8',
).replace(/\r\n/g, '\n');

describe('the browser asks for a publication and never describes one', () => {
  it('posts no payload at all', () => {
    const start = WEBVIEW.indexOf("action === 'portal-publish'");
    expect(start).toBeGreaterThan(0);
    // Bounded to this handler: a fixed slice runs into the next one, which
    // does carry a payload, and the assertion would then be meaningless.
    const handler = WEBVIEW.slice(start, WEBVIEW.indexOf("action === 'portal-confirm-access'", start));
    expect(handler).toContain("type: 'publishPortal'");
    expect(handler).not.toContain('payload:');
  });
});

describe('the confirmation shows the plan its own words', () => {
  it('renders the disclosure rather than a summary beside it', () => {
    expect(COMMAND).toContain('plan.disclosure');
    expect(COMMAND).toContain('describePortalPublishCommands');
  });

  it('shows every refusal in full, with what to change', () => {
    // The whole value of refusing is that somebody learns which of two things
    // to change; "cannot publish" teaches nothing.
    expect(COMMAND).toContain('What to change:');
    expect(COMMAND).toContain('if (!plan.canPublish)');
  });

  it('asks a different question when AtlasMind cannot deploy', () => {
    expect(COMMAND).toContain('Build and publish the producer portal');
    expect(COMMAND).toContain('Build the producer portal for');
  });
});

describe('the deploy runs without a shell', () => {
  it('uses the shared execFile path with an argument vector', () => {
    // The folder name comes from a setting, and a folder called `x; rm -rf ~`
    // must stay a folder name.
    expect(COMMAND).toContain('execFileAsync(deploy.command.file, [...deploy.command.args])');
    expect(COMMAND).not.toContain('createTerminal');
    expect(COMMAND).not.toContain('sendText');
    expect(COMMAND).not.toContain('shell: true');
  });

  it('reads repository visibility at the moment it matters', () => {
    expect(COMMAND).toContain('readVisibility(root)');
    expect(COMMAND).toContain("return 'unknown';");
  });

  it('tells you to check the restriction yourself afterwards', () => {
    // AtlasMind cannot see a host access policy and does not claim to.
    expect(COMMAND).toContain('AtlasMind cannot check that for you');
  });
});
