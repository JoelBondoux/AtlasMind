import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyUiRepositoryMappingCommand,
  assessUiRepositoryMappings,
  fingerprintUiRepositoryDesignTarget,
  fingerprintUiRepositorySource,
  normalizeWorkspaceRelativePath,
  parseUiRepositoryMappingCommand,
  sanitizeUiRepositoryMappings,
  UI_REPOSITORY_SOURCE_MAX_BYTES,
  type UiRepositoryMappingDraft,
} from '../../src/core/uiRepositoryMapping.ts';
import { createDefaultWebsiteWorkspace } from '../../src/core/websiteWorkspaceManager.ts';
import type { UiDesignGraph, UiRepositoryMapping } from '../../src/types.ts';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

function graphWithComponent(): UiDesignGraph {
  const graph = createDefaultWebsiteWorkspace().designGraph;
  return {
    ...graph,
    components: [{
      id: 'button', label: 'Button', description: 'Primary action', rootKind: 'cta',
      properties: [{ id: 'label', label: 'Label', kind: 'text', defaultValue: 'Continue' }],
      slots: [{ id: 'icon', label: 'Icon', required: false, allowedKinds: ['image'], maxChildren: 1 }],
      variants: [{ id: 'primary', label: 'Primary', propertyValues: {} }],
      states: ['default', 'hover'],
    }],
    tokens: [{ id: 'color-primary', label: 'Primary', kind: 'color', value: '#2563eb' }],
  };
}

function draft(overrides: Partial<UiRepositoryMappingDraft> = {}): UiRepositoryMappingDraft {
  return {
    id: 'button-react',
    label: 'Button implementation',
    adapterId: 'react',
    target: { kind: 'component', id: 'button' },
    sourcePath: 'src/components/Button.tsx',
    sourceSymbol: 'Button',
    propertyMappings: { label: 'children' },
    slotMappings: { icon: 'icon' },
    coverage: 'declared',
    limitations: [],
    ...overrides,
  };
}

async function workspaceWithSource(contents = 'export function Button() { return null; }'): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'atlasmind-repository-mapping-'));
  temporaryRoots.push(root);
  await writeFile(path.join(root, 'Button.tsx'), contents, 'utf8');
  return root;
}

function sourceDraft(overrides: Partial<UiRepositoryMappingDraft> = {}): UiRepositoryMappingDraft {
  return draft({ sourcePath: 'Button.tsx', ...overrides });
}

describe('UI Studio repository mappings', () => {
  it('normalizes only bounded workspace-relative source paths', () => {
    expect(normalizeWorkspaceRelativePath(' src\\components\\Button.tsx ')).toBe('src/components/Button.tsx');
    expect(normalizeWorkspaceRelativePath('../outside.ts')).toBeUndefined();
    expect(normalizeWorkspaceRelativePath('C:\\outside.ts')).toBeUndefined();
    expect(normalizeWorkspaceRelativePath('/outside.ts')).toBeUndefined();
    expect(normalizeWorkspaceRelativePath('src//Button.tsx')).toBeUndefined();
  });

  it('sanitizes mappings as declarations and never accepts malformed verification data', () => {
    const valid = {
      ...draft(),
      lastVerified: {
        graphRevision: 2,
        designFingerprint: `sha256:${'a'.repeat(64)}`,
        sourceFingerprint: `sha256:${'b'.repeat(64)}`,
        verifiedAt: '2026-08-12T10:00:00.000Z',
      },
    };
    const mappings = sanitizeUiRepositoryMappings([
      valid,
      { ...valid, id: 'duplicate' , sourcePath: '../outside.ts' },
      { ...valid, id: 'custom-lossless', adapterId: 'custom', coverage: 'declared', limitations: [] },
      { ...valid, id: 'partial-without-reason', coverage: 'partial', limitations: [] },
      { ...valid, id: 'bad-baseline', lastVerified: { ...valid.lastVerified, sourceFingerprint: 'not-a-hash' } },
    ]);
    expect(mappings).toHaveLength(2);
    expect(mappings[0]).toEqual(valid);
    expect(mappings[1]).toMatchObject({ id: 'bad-baseline', lastVerified: null });
  });

  it('parses an exact command in any object-key order and rejects extra authority', () => {
    const mapping = draft();
    const reordered = {
      limitations: mapping.limitations,
      coverage: mapping.coverage,
      slotMappings: mapping.slotMappings,
      propertyMappings: mapping.propertyMappings,
      sourceSymbol: mapping.sourceSymbol,
      sourcePath: mapping.sourcePath,
      target: mapping.target,
      adapterId: mapping.adapterId,
      label: mapping.label,
      id: mapping.id,
    };
    expect(parseUiRepositoryMappingCommand({ mapping: reordered, expectedRevision: 0, type: 'add-mapping' }))
      .toMatchObject({ type: 'add-mapping', expectedRevision: 0 });
    expect(parseUiRepositoryMappingCommand({
      type: 'add-mapping', expectedRevision: 0, mapping: { ...mapping, lastVerified: null },
    })).toBeUndefined();
    expect(parseUiRepositoryMappingCommand({
      type: 'verify-mapping', expectedRevision: 0, mappingId: mapping.id,
      sourceFingerprint: `sha256:${'a'.repeat(64)}`,
    })).toBeUndefined();
  });

  it('revisions definition edits, refuses stale commands, and clears verification baselines', async () => {
    const graph = graphWithComponent();
    const root = await workspaceWithSource();
    const added = applyUiRepositoryMappingCommand(0, [], graph, {
      type: 'add-mapping', expectedRevision: 0, mapping: sourceDraft(),
    }, root);
    expect(added).toMatchObject({ ok: true, revision: 1, mappings: [{ lastVerified: null }] });
    if (!added.ok) { return; }

    const stale = applyUiRepositoryMappingCommand(added.revision, added.mappings, graph, {
      type: 'delete-mapping', expectedRevision: 0, mappingId: 'button-react',
    }, root);
    expect(stale).toMatchObject({ ok: false, reason: 'stale-revision', revision: 1 });

    const verified = applyUiRepositoryMappingCommand(1, added.mappings, graph, {
      type: 'verify-mapping', expectedRevision: 1, mappingId: 'button-react',
    }, root, () => '2026-08-12T10:00:00.000Z');
    expect(verified).toMatchObject({
      ok: true,
      revision: 2,
      mappings: [{ lastVerified: { graphRevision: graph.revision, verifiedAt: '2026-08-12T10:00:00.000Z' } }],
    });
    if (!verified.ok) { return; }

    const changed = applyUiRepositoryMappingCommand(2, verified.mappings, graph, {
      type: 'set-mapping', expectedRevision: 2, mappingId: 'button-react',
      mapping: sourceDraft({ label: 'Renamed implementation' }),
    }, root);
    expect(changed).toMatchObject({ ok: true, revision: 3, mappings: [{ lastVerified: null }] });
  });

  it('stores hashes rather than source and distinguishes every divergence state', async () => {
    const graph = graphWithComponent();
    const sourceText = 'export function Button() { return <button>Continue</button>; }';
    const root = await workspaceWithSource(sourceText);
    const initial: UiRepositoryMapping = { ...sourceDraft(), lastVerified: null };
    const verified = applyUiRepositoryMappingCommand(0, [initial], graph, {
      type: 'verify-mapping', expectedRevision: 0, mappingId: initial.id,
    }, root, () => '2026-08-12T10:00:00.000Z');
    expect(verified.ok).toBe(true);
    if (!verified.ok) { return; }
    expect(JSON.stringify(verified.mappings)).not.toContain(sourceText);
    expect(verified.mappings[0]?.lastVerified?.designFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(verified.mappings[0]?.lastVerified?.sourceFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(assessUiRepositoryMappings(graph, verified.mappings, root)[0]?.status).toBe('in-sync');

    const changedGraph: UiDesignGraph = {
      ...graph,
      revision: graph.revision + 1,
      components: graph.components.map(component => component.id === 'button'
        ? { ...component, label: 'Action button' }
        : component),
    };
    expect(assessUiRepositoryMappings(changedGraph, verified.mappings, root)[0]?.status).toBe('design-only');

    await writeFile(path.join(root, 'Button.tsx'), `${sourceText}\n// changed`, 'utf8');
    expect(assessUiRepositoryMappings(graph, verified.mappings, root)[0]?.status).toBe('code-only');
    expect(assessUiRepositoryMappings(changedGraph, verified.mappings, root)[0]?.status).toBe('conflict');

    await rm(path.join(root, 'Button.tsx'));
    expect(assessUiRepositoryMappings(graph, verified.mappings, root)[0]).toMatchObject({
      status: 'code-only', sourceStatus: 'missing',
    });
  });

  it('fingerprints only the mapped design target, while retaining graph revision as provenance', async () => {
    const graph = graphWithComponent();
    const root = await workspaceWithSource();
    const mapping: UiRepositoryMapping = { ...sourceDraft(), lastVerified: null };
    const verified = applyUiRepositoryMappingCommand(0, [mapping], graph, {
      type: 'verify-mapping', expectedRevision: 0, mappingId: mapping.id,
    }, root);
    expect(verified.ok).toBe(true);
    if (!verified.ok) { return; }

    const unrelatedChange: UiDesignGraph = {
      ...graph,
      revision: graph.revision + 1,
      tokens: graph.tokens.map(token => token.id === 'color-primary'
        ? { ...token, value: '#000000' }
        : token),
    };
    expect(fingerprintUiRepositoryDesignTarget(unrelatedChange, mapping.target))
      .toBe(mapping.lastVerified?.designFingerprint ?? verified.mappings[0]?.lastVerified?.designFingerprint);
    expect(assessUiRepositoryMappings(unrelatedChange, verified.mappings, root)[0]?.status).toBe('in-sync');
  });

  it('refuses absent, oversized, and out-of-workspace source authority', async () => {
    const root = await workspaceWithSource();
    expect(fingerprintUiRepositorySource(root, '../outside.ts').status).toBe('refused');
    expect(fingerprintUiRepositorySource(root, 'missing.ts').status).toBe('missing');
    await writeFile(path.join(root, 'large.ts'), Buffer.alloc(UI_REPOSITORY_SOURCE_MAX_BYTES + 1));
    expect(fingerprintUiRepositorySource(root, 'large.ts').status).toBe('refused');

    const result = applyUiRepositoryMappingCommand(0, [{
      ...sourceDraft({ sourcePath: 'missing.ts' }), lastVerified: null,
    }], graphWithComponent(), {
      type: 'verify-mapping', expectedRevision: 0, mappingId: 'button-react',
    }, root);
    expect(result).toMatchObject({ ok: false, reason: 'source-not-found', revision: 0 });
  });

  it('reports missing design targets and declared unsupported coverage without choosing a side', async () => {
    const root = await workspaceWithSource();
    const missing: UiRepositoryMapping = {
      ...sourceDraft({ target: { kind: 'component', id: 'missing' } }), lastVerified: null,
    };
    const unsupported: UiRepositoryMapping = {
      ...sourceDraft({ id: 'unsupported', coverage: 'unsupported', limitations: ['Runtime behavior is source-only.'] }),
      lastVerified: null,
    };
    expect(assessUiRepositoryMappings(graphWithComponent(), [missing, unsupported], root))
      .toMatchObject([{ status: 'unsupported' }, { status: 'unsupported' }]);

    expect(applyUiRepositoryMappingCommand(0, [], graphWithComponent(), {
      type: 'add-mapping', expectedRevision: 0,
      mapping: sourceDraft({ target: { kind: 'component', id: 'missing' } }),
    }, root)).toMatchObject({ ok: false, reason: 'design-target-not-found', revision: 0 });
    expect(applyUiRepositoryMappingCommand(0, [], graphWithComponent(), {
      type: 'add-mapping', expectedRevision: 0,
      mapping: sourceDraft({ propertyMappings: { missing: 'children' } }),
    }, root)).toMatchObject({ ok: false, reason: 'unsupported-mapping', revision: 0 });
  });
});
