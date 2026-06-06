import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  getLocalModelRecommendationCandidates,
  LOCAL_MODEL_RECOMMENDATION_OVERRIDE_RELATIVE_PATH,
} from '../../src/providers/localModelRecommendationRegistry.js';

function createTempWorkspace(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'atlasmind-local-rec-'));
}

function writeOverrideFile(workspaceRoot: string, content: string): void {
  const overridePath = path.join(workspaceRoot, LOCAL_MODEL_RECOMMENDATION_OVERRIDE_RELATIVE_PATH);
  mkdirSync(path.dirname(overridePath), { recursive: true });
  writeFileSync(overridePath, content, 'utf8');
}

describe('localModelRecommendationRegistry', () => {
  it('returns built-in defaults when no workspace root is provided', () => {
    const candidates = getLocalModelRecommendationCandidates();
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]?.modelFamily).toBe('Qwen 3 14B');
  });

  it('loads override candidates when a valid override file exists', () => {
    const workspaceRoot = createTempWorkspace();
    try {
      writeOverrideFile(
        workspaceRoot,
        JSON.stringify([
          {
            modelFamily: 'Custom Model 10B',
            recommendedTag: 'custom:10b',
            installHint: 'Ollama: ollama pull custom:10b',
            minRamGb: 20,
            minVramGb: 8,
            releaseWeight: 12,
            workloadTags: ['code', 'reasoning'],
          },
        ]),
      );

      const candidates = getLocalModelRecommendationCandidates(workspaceRoot);
      expect(candidates).toHaveLength(1);
      expect(candidates[0]?.modelFamily).toBe('Custom Model 10B');
      expect(candidates[0]?.recommendedTag).toBe('custom:10b');
      expect(candidates[0]?.workloadTags).toEqual(['code', 'reasoning']);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('normalizes override values and falls back to general workload tag when none are valid', () => {
    const workspaceRoot = createTempWorkspace();
    try {
      writeOverrideFile(
        workspaceRoot,
        JSON.stringify([
          {
            modelFamily: '  Normalized Model  ',
            recommendedTag: ' normalized:latest ',
            installHint: ' Ollama: ollama pull normalized ',
            minRamGb: 12.7,
            minVramGb: 0.3,
            releaseWeight: 99,
            workloadTags: ['unsupported', 'also-bad'],
          },
        ]),
      );

      const candidates = getLocalModelRecommendationCandidates(workspaceRoot);
      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toEqual({
        modelFamily: 'Normalized Model',
        recommendedTag: 'normalized:latest',
        installHint: 'Ollama: ollama pull normalized',
        minRamGb: 13,
        minVramGb: 1,
        releaseWeight: 20,
        workloadTags: ['general'],
      });
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('filters invalid entries and preserves valid normalized entries from override files', () => {
    const workspaceRoot = createTempWorkspace();
    try {
      writeOverrideFile(
        workspaceRoot,
        JSON.stringify([
          {
            modelFamily: 'Valid One',
            recommendedTag: 'valid:1',
            installHint: 'Ollama: ollama pull valid:1',
            minRamGb: 8,
            releaseWeight: 5,
            workloadTags: ['code', 'VISION', 123],
          },
          {
            modelFamily: '',
            recommendedTag: 'bad:1',
            installHint: 'bad',
            minRamGb: 8,
            releaseWeight: 5,
            workloadTags: ['general'],
          },
        ]),
      );

      const candidates = getLocalModelRecommendationCandidates(workspaceRoot);
      expect(candidates).toHaveLength(1);
      expect(candidates[0]?.modelFamily).toBe('Valid One');
      expect(candidates[0]?.workloadTags).toEqual(['code', 'vision']);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('falls back to built-in defaults when override JSON is malformed', () => {
    const workspaceRoot = createTempWorkspace();
    try {
      writeOverrideFile(workspaceRoot, '{ not valid json');

      const candidates = getLocalModelRecommendationCandidates(workspaceRoot);
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0]?.modelFamily).toBe('Qwen 3 14B');
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('falls back to built-in defaults when override JSON is not an array', () => {
    const workspaceRoot = createTempWorkspace();
    try {
      writeOverrideFile(workspaceRoot, JSON.stringify({ modelFamily: 'not-an-array' }));

      const candidates = getLocalModelRecommendationCandidates(workspaceRoot);
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0]?.modelFamily).toBe('Qwen 3 14B');
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});
