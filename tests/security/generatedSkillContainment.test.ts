import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import { loadSkillFromSource } from '../../src/core/skillDrafting.ts';

/**
 * What a generated skill can reach when it is evaluated.
 *
 * These are executed escapes, not arguments about them. Every route below was
 * first run against the previous implementation
 * (`new Function('module','exports','require', source)`) to establish that it
 * worked: **seven of the eight reached `node:fs`**, including `import('node:fs')`
 * — dynamic import is syntax, so shadowing the `require` identifier never
 * touched it — and `process.mainModule.require('node:fs')`.
 *
 * The last test in this file is the important one. It asserts the boundary's
 * *hole*, so nobody can later describe this as a sandbox and be technically
 * right.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..');

/** Each returns a truthy value only if it reached something it should not have. */
const ESCAPE_ROUTES: ReadonlyArray<{ name: string; source: string }> = [
  {
    name: 'require, the one the old implementation blocked',
    source: `module.exports.skill = { id:'x', name:'x', execute: () => require('node:fs') };`,
  },
  {
    name: 'dynamic import(), which shadowing require never touched',
    source: `module.exports.skill = { id:'x', name:'x', execute: () => import('node:fs') };`,
  },
  {
    name: 'process.mainModule.require',
    source: `module.exports.skill = { id:'x', name:'x', execute: () => process.mainModule.require('node:fs') };`,
  },
  {
    name: 'createRequire reached through process',
    source: `module.exports.skill = { id:'x', name:'x', execute: () => process.mainModule.require('node:module').createRequire('/x.js')('node:fs') };`,
  },
  {
    name: 'the Function constructor without naming Function',
    source: `module.exports.skill = { id:'x', name:'x', execute: () => (function(){}).constructor('return process')() };`,
  },
  {
    name: 'module.constructor, a host object in the old implementation',
    source: `module.exports.skill = { id:'x', name:'x', execute: () => module.constructor.constructor('return process')() };`,
  },
  {
    name: 'process.env',
    source: `module.exports.skill = { id:'x', name:'x', execute: () => process.env.PATH };`,
  },
  {
    name: 'fetch, an ambient host global',
    source: `module.exports.skill = { id:'x', name:'x', execute: () => fetch };`,
  },
];

describe('evaluation reaches nothing ambient', () => {
  it.each(ESCAPE_ROUTES.map(route => [route.name, route.source] as const))(
    'refuses %s',
    async (_name, source) => {
      const loaded = loadSkillFromSource(source);

      // Some routes fail at evaluation, others when the export is called. Both
      // are refusals; what must never happen is a usable host capability
      // coming back.
      if ('error' in loaded) {
        expect(loaded.error).toBeTruthy();
        return;
      }

      await expect(
        Promise.resolve().then(() => (loaded.skill.execute as () => unknown)()),
      ).rejects.toThrow();
    },
  );

  it('still loads an ordinary skill', () => {
    // A containment boundary that refuses everything is not a boundary, it is
    // a disablement wearing one's clothes — and the tests above would pass just
    // as well against it.
    const loaded = loadSkillFromSource(`
      module.exports.skill = {
        id: 'greet',
        name: 'Greet',
        description: 'says hello',
        parameters: { type: 'object', properties: {} },
        execute: async (args) => 'hello ' + (args && args.who ? args.who : 'world'),
      };
    `);

    expect('error' in loaded).toBe(false);
    if ('error' in loaded) { return; }
    expect(loaded.skill.id).toBe('greet');
  });

  it('answers a runaway top level rather than hanging the host', async () => {
    // The module's top level runs the moment it is evaluated, which used to be
    // before anybody had approved anything.
    const loaded = loadSkillFromSource('while (true) {}');

    expect('error' in loaded).toBe(true);
    if (!('error' in loaded)) { return; }
    expect(loaded.error).toMatch(/timed out/i);
  });

  it('rejects source that exports nothing usable', () => {
    const loaded = loadSkillFromSource('var unused = 1;');

    expect('error' in loaded).toBe(true);
  });

  it('refuses a host global read at the module top level, approval or not', () => {
    // `no-process-env` is a *warning* rule, so a skill reading it could be
    // approved and would then run with the real environment. The scanner was
    // the only thing between a generated skill and `process.env.AWS_SECRET`,
    // and it was advisory. Now the read fails before the skill exists, which is
    // what makes that warning worth having rather than the whole defence.
    const loaded = loadSkillFromSource(
      'const home = process.env.HOME;\n'
      + 'module.exports.skill = { id:"p", name:"p", execute: async () => String(home) };',
    );

    expect('error' in loaded).toBe(true);
    if (!('error' in loaded)) { return; }
    expect(loaded.error).toMatch(/process is not defined/i);
  });
});

describe('containment is not a sandbox, and the hole is asserted', () => {
  /**
   * The residual route, kept as a passing test on purpose.
   *
   * A skill's `execute(args, ctx)` receives a real `SkillExecutionContext`.
   * Any host object crossing the boundary carries the host realm's `Function`
   * on its prototype chain, so a generated skill that is *called* can still
   * reach out. This is inherent to giving a skill callbacks at all.
   *
   * If someone later closes it, this test fails and they can delete it with
   * good news. Until then it stops the boundary being described as something
   * it is not.
   */
  it('a host callback handed to execute() still reaches the host realm', async () => {
    const loaded = loadSkillFromSource(`
      module.exports.skill = {
        id: 'probe', name: 'probe', description: '', parameters: {},
        execute: async (args, ctx) => typeof ctx.readFile.constructor.constructor('return process')(),
      };
    `);

    if ('error' in loaded) { throw new Error(`expected the skill to load: ${loaded.error}`); }

    const hostContext = { readFile: async (p: string) => `contents of ${p}` };
    const reached = await (loaded.skill.execute as (a: unknown, c: unknown) => Promise<string>)({}, hostContext);

    expect(
      reached,
      'If this now reports "undefined", the execution surface was closed too — delete this test and say so.',
    ).toBe('object');
  });

  it('never claims to be a sandbox', () => {
    // The word claims a security boundary, and this one has a measured hole in
    // it — asserted directly above. Banning the substring outright is the wrong
    // rule though: the honest disclaimer has to *use* the word to deny it. So
    // the rule is that every occurrence must be a denial.
    const source = readFileSync(path.join(REPO_ROOT, 'src', 'core', 'skillDrafting.ts'), 'utf8');

    const occurrences = [...source.matchAll(/sandbox/gi)];
    const claims = occurrences.filter(match => {
      const preceding = source.slice(Math.max(0, match.index - 24), match.index);
      return !/\bnot\s+a\s+$/i.test(preceding);
    });

    expect(
      claims.map(match => source.slice(Math.max(0, match.index - 40), match.index + 10).replace(/\s+/g, ' ')),
      'Every mention of a sandbox here must be a denial of being one.',
    ).toEqual([]);
    expect(source).toMatch(/containment, not a sandbox/i);
  });
});
