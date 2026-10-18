import { describe, expect, it } from 'vitest';
import { planDevServerRender } from '../../src/core/uiSurfaceRender.ts';
import {
  confirmAndStartDevServer,
  type DevServerChild,
  type DevServerStartDeps,
} from '../../src/views/uiSurfaceRenderHost.ts';

/**
 * Starting a dev server is the one act in rendering that runs something, so
 * the order is the policy: resolve (so the dialog shows the argv that will
 * really run), confirm, check the dry run, and only then spawn.
 */

function readyPlan() {
  const plan = planDevServerRender({ packageJson: { scripts: { dev: 'vite' } }, lockfiles: new Set(), surfacePath: 'src/App.tsx' });
  if (plan.status !== 'ready') {
    throw new Error('expected a ready plan');
  }
  return plan;
}

function fakeChild(): DevServerChild {
  return { pid: 1, once: () => undefined, kill: () => true };
}

function deps(overrides: Partial<DevServerStartDeps>, calls: string[]): DevServerStartDeps {
  return {
    resolve: (command, args) => {
      calls.push('resolve');
      return { status: 'node', command: '/usr/bin/node', args: ['/lib/npm-cli.js', ...args], viaShim: command };
    },
    confirm: async () => {
      calls.push('confirm');
      return true;
    },
    intercept: () => {
      calls.push('intercept');
      return undefined;
    },
    spawn: () => {
      calls.push('spawn');
      return fakeChild();
    },
    ...overrides,
  };
}

describe('starting a dev server to render a surface', () => {
  it('resolves, confirms, checks the dry run, then spawns — in that order', async () => {
    const calls: string[] = [];
    let shown = '';
    let spawned: readonly string[] = [];
    const outcome = await confirmAndStartDevServer(readyPlan(), '/work', deps({
      confirm: async (_title, detail) => {
        calls.push('confirm');
        shown = detail;
        return true;
      },
      spawn: (command, args) => {
        calls.push('spawn');
        spawned = [command, ...args];
        return fakeChild();
      },
    }, calls));
    expect(calls).toEqual(['resolve', 'confirm', 'intercept', 'spawn']);
    expect(outcome.status).toBe('started');
    // The dialog shows exactly what is then spawned.
    expect(shown.split('\n')[0]).toBe(spawned.join(' '));
    expect(spawned).toEqual(['/usr/bin/node', '/lib/npm-cli.js', 'run', 'dev']);
  });

  it('spawns nothing without an explicit yes', async () => {
    const calls: string[] = [];
    const outcome = await confirmAndStartDevServer(readyPlan(), '/work', deps({
      confirm: async () => {
        calls.push('confirm');
        return false;
      },
    }, calls));
    expect(outcome.status).toBe('declined');
    expect(calls).not.toContain('spawn');
    expect(calls).not.toContain('intercept');
  });

  it('spawns nothing in a dry run, after asking as the real path would', async () => {
    const calls: string[] = [];
    const outcome = await confirmAndStartDevServer(readyPlan(), '/work', deps({
      intercept: effect => {
        calls.push('intercept');
        expect(effect).toMatchObject({ kind: 'process', wouldHaveAsked: true, surface: 'ui-studio-dev-server' });
        return { recorded: true };
      },
    }, calls));
    expect(outcome.status).toBe('dry-run');
    expect(calls).toEqual(['resolve', 'confirm', 'intercept']);
  });

  it('refuses a command that cannot run without a shell before asking anybody', async () => {
    const calls: string[] = [];
    const outcome = await confirmAndStartDevServer(readyPlan(), '/work', deps({
      resolve: () => {
        calls.push('resolve');
        return { status: 'unresolved', reason: 'npm was not found on PATH.' };
      },
    }, calls));
    expect(outcome).toEqual({ status: 'unresolved', reason: 'npm was not found on PATH.' });
    expect(calls).toEqual(['resolve']);
  });
});
