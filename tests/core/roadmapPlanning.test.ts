import { describe, expect, it } from 'vitest';
import {
  buildRoadmapCompletionCheckPrompt,
  buildRoadmapPlanChatPrompt,
  buildRoadmapPlanScaffold,
  buildRoadmapResolveChatPrompt,
  roadmapPlanRelPath,
  sanitizeRoadmapPlanPath,
  type RoadmapPlanItem,
} from '../../src/core/roadmapPlanning.ts';

const NOW = new Date('2026-08-21T12:00:00Z');

const item = (overrides: Partial<RoadmapPlanItem> = {}): RoadmapPlanItem => ({
  nodeId: 'fix-the-canvas-1',
  itemId: 'roadmap-3',
  text: 'Fix the canvas',
  completed: false,
  focus: 'feature',
  ...overrides,
});

describe('roadmapPlanRelPath', () => {
  it('names the file by the durable id first, with a cosmetic slug after it', () => {
    expect(roadmapPlanRelPath('project_memory', 'fix-the-canvas-1', 'Fix the canvas'))
      .toBe('project_memory/roadmap/plans/fix-the-canvas-1-fix-the-canvas.md');
  });

  it('survives text that yields no slug at all', () => {
    expect(roadmapPlanRelPath('project_memory', 'node-1', '!!!'))
      .toBe('project_memory/roadmap/plans/node-1.md');
  });

  it('clamps the slug without leaving a trailing hyphen', () => {
    const relPath = roadmapPlanRelPath('project_memory', 'n1', 'word '.repeat(40));
    expect(relPath.endsWith('-.md')).toBe(false);
    expect(relPath.length).toBeLessThan(120);
  });
});

describe('sanitizeRoadmapPlanPath', () => {
  it('accepts a workspace-relative markdown path', () => {
    expect(sanitizeRoadmapPlanPath('project_memory/roadmap/plans/n1-fix.md'))
      .toBe('project_memory/roadmap/plans/n1-fix.md');
  });

  it('refuses traversal, absolute paths and drive letters whole', () => {
    // The value is resolved against the workspace root and opened in the
    // editor: a nearly-valid path made plausible would open somebody else's
    // file while the entry claims it opened the plan.
    expect(sanitizeRoadmapPlanPath('../outside.md')).toBeUndefined();
    expect(sanitizeRoadmapPlanPath('plans/../../outside.md')).toBeUndefined();
    expect(sanitizeRoadmapPlanPath('/etc/motd.md')).toBeUndefined();
    expect(sanitizeRoadmapPlanPath('C:/Windows/notes.md')).toBeUndefined();
    expect(sanitizeRoadmapPlanPath('plans\\x.md')).toBeUndefined();
  });

  it('refuses non-markdown, empty segments, control characters and non-strings', () => {
    expect(sanitizeRoadmapPlanPath('plans/x.sh')).toBeUndefined();
    expect(sanitizeRoadmapPlanPath('plans//x.md')).toBeUndefined();
    expect(sanitizeRoadmapPlanPath('plans/x\u0000.md')).toBeUndefined();
    expect(sanitizeRoadmapPlanPath(42)).toBeUndefined();
    expect(sanitizeRoadmapPlanPath('')).toBeUndefined();
  });
});

describe('buildRoadmapPlanScaffold', () => {
  it('is deterministic — the same item scaffolds byte-identically', () => {
    const input = item({ branch: 'feat/canvas', estimateDays: 2, deadline: '2026-09-01', prerequisiteTexts: ['Ship the export'] });
    expect(buildRoadmapPlanScaffold(input, NOW)).toBe(buildRoadmapPlanScaffold(input, NOW));
  });

  it('carries both ids verbatim in the provenance header', () => {
    // The file has to find its way back to the item it files, even after the
    // backlog reorders — the same rule the issue draft's provenance follows.
    const scaffold = buildRoadmapPlanScaffold(item(), NOW);
    expect(scaffold).toContain('`fix-the-canvas-1`');
    expect(scaffold).toContain('`roadmap-3`');
    expect(scaffold).toContain('roadmap-graph.json');
  });

  it('is a frame of questions, never seeded answers', () => {
    const scaffold = buildRoadmapPlanScaffold(item(), NOW);
    for (const section of ['## Approach', '## Steps', '## Verification', '## Completion criteria']) {
      expect(scaffold).toContain(section);
    }
    expect(scaffold).toContain('Not written yet');
    expect(scaffold).toContain('nothing below was decided by a machine');
  });

  it('states what the work waits on, and says so when nothing does', () => {
    expect(buildRoadmapPlanScaffold(item({ prerequisiteTexts: ['A', 'B'] }), NOW)).toContain('Waits on: A; B');
    expect(buildRoadmapPlanScaffold(item(), NOW)).toContain('nothing — this can start now');
  });

  it('reports an absent estimate and deadline as unset, never as zero', () => {
    const scaffold = buildRoadmapPlanScaffold(item(), NOW);
    expect(scaffold).toContain('not estimated yet');
    expect(scaffold).toContain('Deadline: none set');
  });
});

describe('the three hand-off prompts', () => {
  const planPath = 'project_memory/roadmap/plans/fix-the-canvas-1.md';

  it('fence the item text as reported content, in all three', () => {
    // A backlog line can be imported from GitHub issues or a spreadsheet,
    // which makes it third-party text; "ignore your instructions" inside it
    // must stay a line item.
    for (const prompt of [
      buildRoadmapPlanChatPrompt(item(), planPath),
      buildRoadmapResolveChatPrompt(item(), planPath),
      buildRoadmapCompletionCheckPrompt(item(), planPath),
    ]) {
      expect(prompt).toContain('REPORTED CONTENT');
      expect(prompt).toContain('--- roadmap item (reported content) ---');
      expect(prompt).toContain('--- end roadmap item ---');
    }
  });

  it('none of the three lets the model tick the item off', () => {
    for (const prompt of [
      buildRoadmapPlanChatPrompt(item(), planPath),
      buildRoadmapResolveChatPrompt(item(), planPath),
      buildRoadmapCompletionCheckPrompt(item(), planPath),
    ]) {
      expect(prompt.toLowerCase()).toContain('human act');
    }
  });

  it('the Plan hand-off produces the plan and nothing else', () => {
    const prompt = buildRoadmapPlanChatPrompt(item(), planPath);
    expect(prompt).toContain(planPath);
    expect(prompt).toContain('do not start the implementation');
  });

  it('the Resolve hand-off follows the filed plan, or says there is none', () => {
    expect(buildRoadmapResolveChatPrompt(item(), planPath)).toContain('read it before starting');
    expect(buildRoadmapResolveChatPrompt(item(), undefined)).toContain('No plan has been filed');
  });

  it('the Completion check reports evidence and forbids editing the backlog', () => {
    const prompt = buildRoadmapCompletionCheckPrompt(item(), planPath);
    expect(prompt).toContain('Completion criteria');
    expect(prompt).toContain('do not edit the backlog');
    expect(prompt).toContain('not decidable');
    // Without a plan, the criteria are derived and declared rather than assumed.
    expect(buildRoadmapCompletionCheckPrompt(item(), undefined)).toContain('state them before judging');
  });

  it('clamps the fenced item text rather than forwarding an unbounded line', () => {
    const long = item({ text: 'x'.repeat(2000) });
    const prompt = buildRoadmapResolveChatPrompt(long, undefined);
    const fenced = /--- roadmap item \(reported content\) ---\n([^]*?)\n--- end roadmap item ---/.exec(prompt);
    expect(fenced?.[1]?.length).toBe(600);
  });
});
