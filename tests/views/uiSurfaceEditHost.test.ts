import { describe, expect, it } from 'vitest';
import { parseHtmlSource } from '../../src/core/htmlSourceMap.ts';
import { planHtmlElementEdit, type ReadyHtmlEditPlan } from '../../src/core/uiSurfaceElementEdit.ts';
import { confirmAndApplyHtmlEdit, type HtmlEditApplyDeps } from '../../src/views/uiSurfaceEditHost.ts';

/**
 * Writing an element edit is the one act in element editing that changes the
 * project, so the order is the policy: check the file still is the one the
 * plan was made from, confirm with the lines before and after, check the dry
 * run, check the file again, and only then write.
 */

const ORIGINAL = '<main>\n  <h1>Old</h1>\n</main>\n';

function plan(): ReadyHtmlEditPlan {
  const doc = parseHtmlSource(ORIGINAL);
  const h1 = doc.elements.find(element => element.tagName === 'h1')!;
  const planned = planHtmlElementEdit(doc, { kind: 'set-text', elementId: h1.id, text: 'New' });
  if (planned.status !== 'ready') {
    throw new Error(planned.reason);
  }
  return planned;
}

function deps(calls: string[], overrides: Partial<HtmlEditApplyDeps> = {}): HtmlEditApplyDeps & { written: string[] } {
  const written: string[] = [];
  return {
    written,
    read: () => {
      calls.push('read');
      return ORIGINAL;
    },
    confirm: async () => {
      calls.push('confirm');
      return true;
    },
    intercept: () => {
      calls.push('intercept');
      return undefined;
    },
    write: text => {
      calls.push('write');
      written.push(text);
    },
    ...overrides,
  };
}

describe('applying an element edit', () => {
  it('reads, confirms with the before and after, checks the dry run, reads again, then writes', async () => {
    const calls: string[] = [];
    let shown = '';
    const harness = deps(calls, {
      confirm: async (_title, detail) => {
        calls.push('confirm');
        shown = detail;
        return true;
      },
    });
    const outcome = await confirmAndApplyHtmlEdit('site/index.html', plan(), harness);
    expect(calls).toEqual(['read', 'confirm', 'intercept', 'read', 'write']);
    expect(outcome.status).toBe('written');
    expect(harness.written).toEqual(['<main>\n  <h1>New</h1>\n</main>\n']);
    expect(shown).toContain('Before:\n  <h1>Old</h1>');
    expect(shown).toContain('After:\n  <h1>New</h1>');
  });

  it('writes nothing when the person declines', async () => {
    const calls: string[] = [];
    const harness = deps(calls, { confirm: async () => false });
    expect(await confirmAndApplyHtmlEdit('a.html', plan(), harness)).toEqual({ status: 'declined' });
    expect(harness.written).toEqual([]);
  });

  it('writes nothing in a dry run, and says the real path would have asked', async () => {
    const calls: string[] = [];
    const effects: unknown[] = [];
    const harness = deps(calls, {
      intercept: effect => {
        effects.push(effect);
        return { recorded: true };
      },
    });
    expect(await confirmAndApplyHtmlEdit('a.html', plan(), harness)).toEqual({ status: 'dry-run' });
    expect(harness.written).toEqual([]);
    expect(effects[0]).toMatchObject({ surface: 'ui-studio-element-edit', kind: 'source-edit', wouldHaveAsked: true });
  });

  it('does not ask about an edit to a file that has already changed', async () => {
    const calls: string[] = [];
    const harness = deps(calls, { read: () => `${ORIGINAL}<!-- edited elsewhere -->` });
    const outcome = await confirmAndApplyHtmlEdit('a.html', plan(), harness);
    expect(outcome.status).toBe('diverged');
    expect(calls).not.toContain('confirm');
    expect(harness.written).toEqual([]);
  });

  it('does not overwrite a change made while the dialog was open', async () => {
    const calls: string[] = [];
    let reads = 0;
    const harness = deps(calls, {
      read: () => {
        reads += 1;
        return reads === 1 ? ORIGINAL : ORIGINAL.replace('Old', 'Changed meanwhile');
      },
    });
    const outcome = await confirmAndApplyHtmlEdit('a.html', plan(), harness);
    expect(outcome.status).toBe('diverged');
    expect(harness.written).toEqual([]);
  });

  it('writes nothing when the file cannot be read faithfully', async () => {
    const calls: string[] = [];
    const harness = deps(calls, { read: () => undefined });
    expect(await confirmAndApplyHtmlEdit('a.html', plan(), harness)).toEqual({ status: 'unreadable' });
    expect(calls).not.toContain('confirm');
  });
});
