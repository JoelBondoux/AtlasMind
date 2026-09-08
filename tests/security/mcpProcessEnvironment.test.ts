import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import { getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * What an MCP server process inherits from the editor.
 *
 * An MCP server is somebody else's program, spawned on the user's machine. It
 * should receive what it needs to run and what the user declared for it, and
 * nothing else.
 *
 * It used to receive `{ ...process.env, ...declared }`, which had a shape worth
 * stating plainly: a server declaring **no** variables got `undefined`, and the
 * SDK then supplied `getDefaultEnvironment()` — a deliberately filtered list.
 * A server declaring **one** variable inherited the entire extension-host
 * environment. So asking for `GITHUB_TOKEN` also handed over `ANTHROPIC_API_KEY`,
 * every `AWS_*`, npm tokens, and whatever else was in the shell VS Code was
 * launched from. Declaring a requirement made the server *more* trusted.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CLIENT = path.join(REPO_ROOT, 'src', 'mcp', 'mcpClient.ts');

/** The transport call, comments stripped — this file now discusses the hazard at length. */
function transportEnvExpression(): string {
  const source = readFileSync(CLIENT, 'utf8')
    .split(/\r?\n/)
    .filter(line => !/^\s*(?:\*|\/\/|\/\*)/.test(line))
    .join('\n');

  const start = source.indexOf('new StdioClientTransport(');
  expect(start, 'The stdio transport construction has moved.').toBeGreaterThan(-1);
  return source.slice(start, start + 900);
}

describe('an MCP server does not inherit the editor environment', () => {
  it('does not spread process.env into the spawned process', () => {
    expect(
      /\.\.\.process\.env/.test(transportEnvExpression()),
      'A spawned MCP server is being handed the full extension-host environment, which carries '
      + 'every provider key and cloud credential the editor was started with.',
    ).toBe(false);
  });

  it('layers declared variables onto the SDK\'s filtered default instead', () => {
    expect(transportEnvExpression()).toContain('getDefaultEnvironment()');
  });

  it('the filtered default really is filtered', () => {
    // The fix is only worth anything if the thing it falls back to is smaller
    // than what it replaced. Asserted rather than assumed, because it is a
    // property of somebody else's library and could change under us.
    const safe = Object.keys(getDefaultEnvironment());

    expect(safe.length).toBeGreaterThan(0);
    expect(safe.length).toBeLessThan(Object.keys(process.env).length);
  });

  it('carries no obviously secret-bearing variable', () => {
    // Not exhaustive, and cannot be: the point is that the *shape* is an
    // allowlist. This catches the SDK widening its list into something that
    // would reintroduce the problem.
    const leaked = Object.keys(getDefaultEnvironment())
      .filter(name => /(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name));

    expect(leaked, 'The SDK default environment now carries credential-shaped variables.').toEqual([]);
  });
});
