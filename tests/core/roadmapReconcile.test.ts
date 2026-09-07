import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assessUnmanagedRoadmap,
  planRoadmapReconcile,
  MAX_RECONCILED_ITEMS,
  ROADMAP_ITEMS_START_MARKER,
  ROADMAP_ITEMS_END_MARKER,
} from '../../src/core/roadmapReconcile.ts';

const managed = (body: string) => [
  '# Developer Roadmap',
  '## Prioritized Backlog',
  ROADMAP_ITEMS_START_MARKER,
  body,
  ROADMAP_ITEMS_END_MARKER,
].join('\n');

describe('spotting a document a save would duplicate', () => {
  it('says nothing is at risk when both markers are present', () => {
    const assessment = assessUnmanagedRoadmap(managed('- [ ] Ship the thing'));
    expect(assessment.managed).toBe(true);
    expect(assessment.wouldDuplicate).toBe(false);
    // Managed content is the dashboard's already; counting it would report every
    // item as an orphan the moment one marker went missing.
    expect(assessment.orphanItemTexts).toEqual([]);
  });

  it('flags an unmanaged document that carries items', () => {
    // The condition the whole module exists for: this is what got appended
    // verbatim and produced 123 lines where there were 72.
    const assessment = assessUnmanagedRoadmap('# Roadmap\n\n- [ ] Ship the thing\n- [x] Done already');
    expect(assessment.managed).toBe(false);
    expect(assessment.wouldDuplicate).toBe(true);
    expect(assessment.orphanItemTexts).toEqual(['Ship the thing', 'Done already']);
  });

  it('leaves an unmanaged document of pure prose alone', () => {
    // Preserving prose was never the bug, and refusing here would block a save
    // for a file that cannot duplicate anything.
    const assessment = assessUnmanagedRoadmap('# Notes\n\nSome thoughts about the plan.');
    expect(assessment.wouldDuplicate).toBe(false);
    expect(assessment.orphanItemTexts).toEqual([]);
  });

  it('keeps prose and items apart', () => {
    const assessment = assessUnmanagedRoadmap('## Context\nWhy this exists.\n\n- [ ] Do the work');
    expect(assessment.orphanItemTexts).toEqual(['Do the work']);
    expect(assessment.noteLines.join('\n')).toContain('Why this exists.');
    expect(assessment.noteLines.join('\n')).not.toContain('Do the work');
  });

  it('ignores a checkbox inside a fence', () => {
    // An example in documentation is not somebody's backlog item.
    const assessment = assessUnmanagedRoadmap('```md\n- [ ] Example item\n```\n\n- [ ] Real item');
    expect(assessment.orphanItemTexts).toEqual(['Real item']);
  });

  it('ignores items inside a managed block even when a marker is missing elsewhere', () => {
    const document = `${ROADMAP_ITEMS_START_MARKER}\n- [ ] Managed one\n${ROADMAP_ITEMS_END_MARKER}\n\n- [ ] Loose one`;
    expect(assessUnmanagedRoadmap(document).orphanItemTexts).toEqual(['Loose one']);
  });

  it('caps what it counts and says so', () => {
    const lines = Array.from({ length: MAX_RECONCILED_ITEMS + 10 }, (_, i) => `- [ ] Item ${i}`);
    const assessment = assessUnmanagedRoadmap(lines.join('\n'));
    expect(assessment.orphanItemTexts).toHaveLength(MAX_RECONCILED_ITEMS);
    expect(assessment.truncated).toBe(true);
  });
});

describe('planning what a reconcile would adopt', () => {
  it('adopts an orphan the dashboard does not already hold', () => {
    const plan = planRoadmapReconcile('- [ ] Write the docs', ['Ship the thing']);
    expect(plan.adopted).toEqual(['Write the docs']);
    expect(plan.alreadyPresent).toBe(0);
  });

  it('drops an orphan the incoming set already has, rather than merging it', () => {
    // The incoming line is the one carrying the durable anchor. Merging text
    // into it would rewrite an item nobody edited.
    const plan = planRoadmapReconcile('- [ ] Ship  the   THING!', ['Ship the thing']);
    expect(plan.adopted).toEqual([]);
    expect(plan.alreadyPresent).toBe(1);
  });

  it('does not adopt the same orphan twice', () => {
    const plan = planRoadmapReconcile('- [ ] Same item\n- [ ] same ITEM', []);
    expect(plan.adopted).toEqual(['Same item']);
    expect(plan.alreadyPresent).toBe(1);
  });

  it('keeps the prose as notes, without the lifted items', () => {
    const plan = planRoadmapReconcile('# Old plan\n\n- [ ] A task\n\nA closing thought.', []);
    expect(plan.notes).toContain('# Old plan');
    expect(plan.notes).toContain('A closing thought.');
    expect(plan.notes).not.toContain('A task');
    // The gaps left where items were lifted out collapse.
    expect(plan.notes).not.toMatch(/\n{3,}/);
  });

  it('reports no notes for a document that was only items', () => {
    expect(planRoadmapReconcile('- [ ] One\n- [ ] Two', []).notes).toBe('');
  });

  it('plans nothing for an already-managed document', () => {
    const plan = planRoadmapReconcile(managed('- [ ] Ship the thing'), ['Ship the thing']);
    expect(plan.adopted).toEqual([]);
  });
});

describe('the serializer cannot duplicate, whoever calls it', () => {
  const PANEL = readFileSync(path.join(process.cwd(), 'src/views/projectDashboardPanel.ts'), 'utf8');
  const body = PANEL.slice(
    PANEL.indexOf('function serializeDashboardRoadmapDocument('),
    PANEL.indexOf('function serializeDashboardRoadmapDocument(') + 4000,
  );

  it('adopts loose items into the block instead of preserving them beside it', () => {
    // Five call sites reach this function and two run with nobody watching --
    // the anchor writer runs on render -- so not duplicating cannot depend on
    // somebody having been asked.
    expect(body).toContain('planRoadmapReconcile(existing, items.map(item => item.text)).adopted');
  });

  it('preserves prose only, never the raw previous document', () => {
    // `## Existing Notes` holding the old body verbatim is the duplication.
    expect(body).toContain('planRoadmapReconcile(existing, []).notes');
    expect(body).not.toContain('`\n\n## Existing Notes\n${existing.trim()}\n`');
  });
});
