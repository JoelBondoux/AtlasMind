import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { ACP_SIGN_IN_COMMANDS } from '../../src/providers/acp.ts';
import { BUZZ_SETUP_COMMANDS } from '../../src/core/buzzSetupPlan.ts';

/**
 * `atlasmind.setup.prepareCommand` — the one command that puts text in a
 * terminal.
 *
 * It exists because "run it once in a terminal and complete its own login" is
 * not an instruction anybody can follow when it names no command. It is also the
 * single place where AtlasMind writes into a shell, and it is reachable from a
 * webview, so the two properties that make it safe are asserted rather than
 * described:
 *
 * 1. **It types; it does not run.** `sendText(text, false)` leaves the cursor on
 *    a composed line. Every one of these commands opens a browser and asks for
 *    an account password, and an extension that submitted that unattended would
 *    be doing something nobody asked it to.
 * 2. **The payload names a command rather than being one.** A webview chooses
 *    from a list AtlasMind wrote; it cannot supply shell text of its own.
 */

const extensionSource = readFileSync(path.join(process.cwd(), 'src/extension.ts'), 'utf8');
const handler = /registerCommand\('atlasmind\.setup\.prepareCommand'[\s\S]*?\n {4}\}\),/.exec(extensionSource)?.[0] ?? '';

describe('the setup terminal types a command and stops', () => {
  it('is registered at all — the id was allowlisted before anything answered it', () => {
    expect(handler, 'handler not found in src/extension.ts').not.toBe('');
  });

  it('never submits what it typed', () => {
    expect(handler).toContain('sendText(text, false)');
    expect(handler).not.toMatch(/sendText\([^)]*,\s*true\)/);
  });

  it('checks the payload against a list AtlasMind wrote', () => {
    expect(handler).toContain('ACP_SIGN_IN_COMMANDS');
    expect(handler).toContain('BUZZ_SETUP_COMMANDS');
    expect(handler).toContain('allowed.includes(text)');
    // And says so when it refuses, rather than doing nothing visible.
    expect(handler).toMatch(/showWarningMessage/);
  });
});

describe('what the setup terminal is allowed to type', () => {
  it('is only ever a plain command — no shell metacharacters', () => {
    // Nothing is passed to a shell by AtlasMind, but the user presses Enter in
    // one. A chained or redirected command in this list would be running on
    // their machine with their approval and nobody else having read it.
    for (const command of [...BUZZ_SETUP_COMMANDS, ...ACP_SIGN_IN_COMMANDS]) {
      expect(command, command).not.toMatch(/[;&|><$`\n]/);
    }
  });

  it('installs nothing and enables nothing on the sign-in path', () => {
    for (const command of ACP_SIGN_IN_COMMANDS) {
      expect(command, command).not.toMatch(/\b(npm|npx|pip|cargo|curl|wget|iwr|sh|bash|powershell)\b/);
    }
  });
});
