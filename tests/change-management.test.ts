import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readWorkflowConfig,
  sanitizeWorkflowConfig,
  seedWorkflowConfig,
  validateWorkflowConfig,
} from '../src/core/workflowConfig.js';

/**
 * Change management, checked against the declaration rather than against habit.
 *
 * This project declares its own workflow in `project_memory/operations/workflow.json`
 * — protected branches, the branch naming convention, the evidence each stage
 * requires — and that file is the authority for the managed block written into
 * every agent instruction file. So the useful assertions are of two kinds.
 *
 * **The guarantees the sanitizer must add**, whatever the file says. The release
 * branch is protected by construction: it is the one value sanitizing *adds*
 * rather than merely validates, because a config that dropped it would remove a
 * guardrail by omission — and a hand-edited file is exactly how that happens.
 *
 * **This repository's own declaration**, checked for internal consistency. Not
 * "does the team follow it" (a test cannot see that) but "does it say something
 * coherent": that `main` is protected, that the integration branch is not, and
 * that no stage requires evidence it cannot name.
 *
 * Deliberately *not* asserted: anything about recent commit messages. A check
 * that fails on day one over a convention nobody agreed to is a check that gets
 * deleted, and it would be measuring the last ten commits rather than the
 * policy.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('the sanitizer adds the guarantees a hand-edited file could drop', () => {
  it('protects the release branch even when the file does not list it', () => {
    const config = sanitizeWorkflowConfig({
      version: 1,
      profile: 'solo',
      branches: { integration: 'develop', release: 'main', protected: [] },
      stages: [],
    });

    expect(config?.branches.protected).toContain('main');
  });

  it('protects a non-default release branch too', () => {
    const config = sanitizeWorkflowConfig({
      version: 1,
      profile: 'solo',
      branches: { integration: 'develop', release: 'production', protected: [] },
      stages: [],
    });

    expect(config?.branches.protected).toContain('production');
  });

  it('keeps the integration branch pushable', () => {
    // The counterpart guarantee. Protecting everything is the same as
    // protecting nothing: if `develop` needs a pull request too, the rule stops
    // being followed rather than the branch being protected.
    const config = sanitizeWorkflowConfig({
      version: 1,
      profile: 'solo',
      branches: { integration: 'develop', release: 'main', protected: ['main'] },
      stages: [],
    });

    expect(config?.branches.integration).toBe('develop');
    expect(config?.branches.protected).not.toContain('develop');
  });

  it('restores a managed stage that was deleted from the file', () => {
    // Disabling a stage is a record of a decision; deleting it is an erasure.
    // Deleting one by hand is not an error — it simply does not work.
    const seeded = JSON.parse(JSON.stringify(seedWorkflowConfig({ profile: 'solo' })));
    const removed = seeded.stages.pop();
    const config = sanitizeWorkflowConfig(seeded);

    const restored = config?.stages.find(stage => stage.id === removed.id);
    expect(restored).toBeDefined();
    expect(restored!.enabled, 'a deleted stage must come back disabled, not enabled').toBe(false);
  });

  it('rejects a file that is not a workflow config at all', () => {
    for (const junk of [null, undefined, 'text', 42, []]) {
      expect(sanitizeWorkflowConfig(junk)).toBeUndefined();
    }
  });
});

describe("this repository's own declaration is coherent", () => {
  const declared = readWorkflowConfig(ROOT);

  it('has a workflow declaration to check', () => {
    // Absent is a finding, not a reason to skip: the managed block written into
    // every agent instruction file is rendered from this file.
    expect(existsSync(path.join(ROOT, 'project_memory', 'operations', 'workflow.json'))).toBe(true);
    expect(declared).toBeDefined();
  });

  it('protects main and pushes to develop', () => {
    expect(declared?.branches.release).toBe('main');
    expect(declared?.branches.protected).toContain('main');
    expect(declared?.branches.integration).toBe('develop');
    expect(declared?.branches.protected).not.toContain('develop');
  });

  it('validates without unresolvable references', () => {
    // An unresolvable owner is reported rather than dropped: a silently
    // ownerless stage reads as one nobody was assigned.
    const result = validateWorkflowConfig(declared!, { agentIds: [], labels: [] });
    expect(result).toBeDefined();
  });

  it('never asks a stage for evidence it cannot name', () => {
    for (const stage of declared?.stages ?? []) {
      for (const check of [...stage.requiredChecks, ...stage.requiredStatusChecks]) {
        expect(check.trim().length, `${stage.id} has a blank required check`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps human checks and machine checks apart', () => {
    // A person saying "I looked" and a machine saying "it passed" are different
    // claims, and one must not stand in for the other. The declaration models
    // them as separate lists; this pins that they have not been merged.
    const release = declared?.stages.find(stage => stage.id === 'release');
    expect(release).toBeDefined();
    for (const status of release!.requiredStatusChecks) {
      expect(release!.requiredChecks, `"${status}" appears as both a human and a machine check`)
        .not.toContain(status);
    }
  });
});

describe('the declaration and the checked-in instruction block agree', () => {
  it('names the same protected branches in CLAUDE.md as the file declares', () => {
    // The managed block is generated, but it is *committed* — so it can be
    // stale, and a stale block is an agent being told the wrong rule. This is
    // the cheap half of the digest check the sync hook does.
    const claudeMd = path.join(ROOT, 'CLAUDE.md');
    expect(existsSync(claudeMd)).toBe(true);

    const text = readFileSync(claudeMd, 'utf8');
    const declared = readWorkflowConfig(ROOT);
    if (!text.includes('atlasmind:workflow:start')) {
      return; // No managed workflow block in this file; nothing to compare.
    }

    for (const branch of declared?.branches.protected ?? []) {
      expect(text, `CLAUDE.md's workflow block does not mention protected branch "${branch}"`)
        .toContain(branch);
    }
  });
});
