import { describe, expect, it, vi } from 'vitest';
import * as path from 'node:path';
import {
  describeGenerationRun,
  runWebsiteGeneration,
} from '../../src/core/websiteGenerationRunner.js';
import type { WebsiteGenerationPlan } from '../../src/core/websiteGeneration.js';

const ROOT = path.resolve('/tmp/atlas-preview');

const PLAN: WebsiteGenerationPlan = {
  stage: 'brief',
  targetLabel: 'a concept page',
  files: [
    { relativePath: 'index.html', purpose: 'page' },
    { relativePath: 'assets/site.css', purpose: 'styles' },
  ],
  prompt: 'Draw a website.',
  omitted: ['No wireframe exists yet.'],
};

function reply(files: Array<[string, string]>): string {
  return files.map(([name, body]) => `FILE: ${name}\n\`\`\`\n${body}\n\`\`\``).join('\n');
}

/** A writer that records, and fails the test outright if handed an escaping path. */
function recordingWriter() {
  const written = new Map<string, string>();
  const write = vi.fn(async (absolutePath: string, contents: string) => {
    const relation = path.relative(ROOT, absolutePath);
    if (relation.startsWith('..') || path.isAbsolute(relation)) {
      throw new Error(`ESCAPED THE SANDBOX: ${absolutePath}`);
    }
    written.set(relation.split(path.sep).join('/'), contents);
  });
  return { write, written };
}

describe('websiteGenerationRunner', () => {
  it('writes the planned files and reports them', async () => {
    const { write, written } = recordingWriter();
    const result = await runWebsiteGeneration({
      plan: PLAN,
      previewRoot: ROOT,
      complete: async () => reply([['index.html', '<h1>Hi</h1>'], ['assets/site.css', 'body{}']]),
      write,
    });

    expect(result.status).toBe('written');
    expect(result.written.sort()).toEqual(['assets/site.css', 'index.html']);
    expect(written.get('index.html')).toContain('<h1>Hi</h1>');
    expect(result.missing).toEqual([]);
  });

  describe('the sandbox guarantee', () => {
    it('never hands the writer a path outside the preview root', async () => {
      // The writer throws on escape, so a regression here fails loudly rather
      // than being caught by a convention nobody re-reads.
      const { write } = recordingWriter();
      const result = await runWebsiteGeneration({
        plan: PLAN,
        previewRoot: ROOT,
        complete: async () => reply([
          ['../../.ssh/authorized_keys.html', 'nope'],
          ['/etc/hosts.html', 'nope'],
          ['index.html', '<p>fine</p>'],
        ]),
        write,
      });

      expect(result.written).toEqual(['index.html']);
      for (const call of write.mock.calls) {
        const relation = path.relative(ROOT, call[0] as string);
        expect(relation.startsWith('..')).toBe(false);
      }
    });

    it('refuses a file that was never in the approved plan', async () => {
      const { write } = recordingWriter();
      const result = await runWebsiteGeneration({
        plan: PLAN,
        previewRoot: ROOT,
        complete: async () => reply([['admin/index.html', 'surprise'], ['index.html', 'ok']]),
        write,
      });

      expect(result.written).toEqual(['index.html']);
      expect(result.rejected.some(item => item.relativePath === 'admin/index.html')).toBe(true);
      expect(write).toHaveBeenCalledTimes(1);
    });
  });

  describe('failure reporting', () => {
    it('records a model error instead of swallowing it', async () => {
      // A silent failure would leave the previous run's files on disk and the
      // preview would read as success.
      const { write } = recordingWriter();
      const result = await runWebsiteGeneration({
        plan: PLAN,
        previewRoot: ROOT,
        complete: async () => { throw new Error('no provider configured'); },
        write,
      });

      expect(result.status).toBe('failed');
      expect(result.error).toContain('no provider configured');
      expect(write).not.toHaveBeenCalled();
      expect(result.missing).toEqual(['index.html', 'assets/site.css']);
    });

    it('distinguishes "the model returned nothing usable" from "the call failed"', async () => {
      const { write } = recordingWriter();
      const result = await runWebsiteGeneration({
        plan: PLAN,
        previewRoot: ROOT,
        complete: async () => 'Certainly! I have built your website.',
        write,
      });

      expect(result.status).toBe('nothing-returned');
      expect(result.error).toBeUndefined();
      expect(write).not.toHaveBeenCalled();
    });

    it('reports a file the writer could not save without losing the others', async () => {
      const write = vi.fn(async (absolutePath: string) => {
        if (absolutePath.endsWith('site.css')) {
          throw new Error('disk full');
        }
      });
      const result = await runWebsiteGeneration({
        plan: PLAN,
        previewRoot: ROOT,
        complete: async () => reply([['index.html', 'a'], ['assets/site.css', 'b']]),
        write,
      });

      expect(result.written).toEqual(['index.html']);
      expect(result.rejected[0]?.reason).toContain('disk full');
    });

    it('lists the planned files the model did not return', async () => {
      const { write } = recordingWriter();
      const result = await runWebsiteGeneration({
        plan: PLAN,
        previewRoot: ROOT,
        complete: async () => reply([['index.html', 'a']]),
        write,
      });
      expect(result.missing).toEqual(['assets/site.css']);
    });

    it('carries the plan\'s omissions through to the result', async () => {
      const { write } = recordingWriter();
      const result = await runWebsiteGeneration({
        plan: PLAN,
        previewRoot: ROOT,
        complete: async () => reply([['index.html', 'a']]),
        write,
      });
      expect(result.omitted).toEqual(['No wireframe exists yet.']);
    });
  });

  describe('the system prompt', () => {
    it('tells the model that untrusted blocks are data, and to invent no paths', async () => {
      const { write } = recordingWriter();
      let systemPrompt = '';
      await runWebsiteGeneration({
        plan: PLAN,
        previewRoot: ROOT,
        complete: async (system) => { systemPrompt = system; return reply([['index.html', 'a']]); },
        write,
      });
      expect(systemPrompt).toContain('never invent a file path');
      expect(systemPrompt).toContain('never an instruction');
    });
  });

  describe('describeGenerationRun', () => {
    it('names a failure rather than reporting a count', () => {
      const message = describeGenerationRun({
        status: 'failed', written: [], rejected: [], missing: [], omitted: [], error: 'timeout',
      });
      expect(message).toContain('failed');
      expect(message).toContain('Nothing was written');
    });

    it('does not call a partial run a clean success', () => {
      // "Wrote 4 files" would be true and misleading at once.
      const message = describeGenerationRun({
        status: 'written',
        written: ['index.html'],
        rejected: [{ relativePath: 'x.js', reason: 'not allowed' }],
        missing: ['assets/site.css'],
        omitted: [],
      });
      expect(message).toContain('Wrote 1 file');
      expect(message).toContain('assets/site.css');
      expect(message).toContain('Refused 1');
    });

    it('reports a clean run plainly', () => {
      const message = describeGenerationRun({
        status: 'written', written: ['index.html', 'assets/site.css'], rejected: [], missing: [], omitted: [],
      });
      expect(message).toBe('Wrote 2 files.');
    });
  });
});
