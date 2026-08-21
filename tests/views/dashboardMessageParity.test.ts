import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A dashboard message exists in three places: the `ProjectDashboardMessage`
 * union, the `handleMessage` switch, and the `isProjectDashboardMessage`
 * runtime gate. The three are maintained by hand, and nothing bound them:
 * fifteen canvas messages shipped in the union and the switch but not the
 * gate, so every canvas mutation — drags, saves, links, Calculate tree, the
 * Atlas pills — was silently dropped at the validation branch while the
 * webview looked perfectly wired. No unit test could see it, because the
 * webview tests asserted the post and the handler tests called past the gate.
 *
 * This test pins the three lists to each other, so a message cannot be
 * declared without being handled, or handled without being admitted.
 */

const SOURCE = readFileSync(path.join(process.cwd(), 'src', 'views', 'projectDashboardPanel.ts'), 'utf8');

function unionTypes(): Set<string> {
  const start = SOURCE.indexOf('type ProjectDashboardMessage =');
  expect(start, 'the message union is missing').toBeGreaterThan(-1);
  // The union ends at the first statement that is not a `|` member — the next
  // top-level declaration.
  const block = SOURCE.slice(start, SOURCE.indexOf('\ntype ', start + 10) > -1
    ? SOURCE.indexOf('\ntype ', start + 10)
    : SOURCE.indexOf('\ninterface ', start + 10));
  return new Set([...block.matchAll(/type: '([A-Za-z]+)'/g)].map(match => match[1] as string));
}

function switchCases(): Set<string> {
  const start = SOURCE.indexOf('switch (message.type)');
  expect(start, 'the handleMessage switch is missing').toBeGreaterThan(-1);
  const block = SOURCE.slice(start, SOURCE.indexOf('\n  private ', start));
  return new Set([...block.matchAll(/case '([A-Za-z]+)':/g)].map(match => match[1] as string));
}

function validatedTypes(): Set<string> {
  const start = SOURCE.indexOf('export function isProjectDashboardMessage');
  expect(start, 'the message gate is missing').toBeGreaterThan(-1);
  // The gate is a top-level function, so the first column-zero brace after it
  // closes it — slicing to a `return false;` would stop at the null guard.
  const end = SOURCE.indexOf('\n}', start);
  const block = SOURCE.slice(start, end);
  return new Set([...block.matchAll(/candidate\['type'\] === '([A-Za-z]+)'/g)].map(match => match[1] as string));
}

describe('dashboard message parity', () => {
  const union = unionTypes();
  const handled = switchCases();
  const validated = validatedTypes();

  it('extracts a plausible number of message types from each surface', () => {
    // Guards the extraction itself: a refactor that moves one of the three
    // blocks must fail here as "extraction broke", not as a shrunken list
    // quietly passing the set comparisons below.
    expect(union.size).toBeGreaterThan(100);
    expect(handled.size).toBeGreaterThan(100);
    expect(validated.size).toBeGreaterThan(100);
  });

  it('every declared message type is handled by the switch', () => {
    expect([...union].filter(type => !handled.has(type)).sort()).toEqual([]);
  });

  it('every declared message type is admitted by the runtime gate', () => {
    // The regression this file exists for: handled-but-dropped is a page of
    // dead buttons with nothing anywhere saying why.
    expect([...union].filter(type => !validated.has(type)).sort()).toEqual([]);
  });

  it('the switch handles nothing the union does not declare', () => {
    expect([...handled].filter(type => !union.has(type)).sort()).toEqual([]);
  });

  it('the gate admits nothing the union does not declare', () => {
    expect([...validated].filter(type => !union.has(type)).sort()).toEqual([]);
  });
});
