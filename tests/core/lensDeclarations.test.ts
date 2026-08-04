import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildLensDeclarationStarter,
  inspectLensDeclarations,
  lensDeclarationStatusLabel,
} from '../../src/core/lensDeclarations.js';

const roots: string[] = [];

function workspace(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'atlasmind-lens-declarations-'));
  roots.push(root);
  mkdirSync(path.join(root, '.atlasmind'), { recursive: true });
  return root;
}

function write(root: string, relativePath: string, value: unknown): void {
  const absolutePath = path.join(root, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, JSON.stringify(value), 'utf8');
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('Lens declaration status', () => {
  it('distinguishes missing files from valid empty starters', () => {
    const root = workspace();

    expect(inspectLensDeclarations(root).files.map(file => file.status))
      .toEqual(['missing', 'missing', 'missing', 'missing']);

    writeFileSync(path.join(root, '.atlasmind', 'lens-state.json'), buildLensDeclarationStarter('state'), 'utf8');
    writeFileSync(path.join(root, '.atlasmind', 'lens-config.json'), buildLensDeclarationStarter('config'), 'utf8');

    const snapshot = inspectLensDeclarations(root);
    expect(snapshot.files.map(file => file.status)).toEqual(['empty', 'empty', 'missing', 'missing']);
    expect(snapshot.readyCount).toBe(0);
  });

  it('reports populated valid declarations as ready and malformed declarations as invalid', () => {
    const root = workspace();
    write(root, '.atlasmind/lens-state.json', {
      version: 1,
      machines: [{
        id: 'job',
        label: 'Job',
        initial: 'queued',
        states: [{ id: 'queued', label: 'Queued' }],
        transitions: [],
      }],
    });
    write(root, '.atlasmind/lens-config.json', { version: 1, settings: 'not-an-array' });

    const snapshot = inspectLensDeclarations(root);
    expect(snapshot.files.slice(0, 2)).toEqual([
      expect.objectContaining({ kind: 'state', status: 'ready', declarationCount: 1 }),
      expect.objectContaining({ kind: 'config', status: 'invalid', declarationCount: 0 }),
    ]);
    expect(snapshot.readyCount).toBe(1);
    expect(lensDeclarationStatusLabel(snapshot.files[1]!.status)).toBe('Invalid');
  });

  it('builds valid starters without pretending to know project semantics', () => {
    expect(JSON.parse(buildLensDeclarationStarter('state'))).toEqual({ version: 1, machines: [] });
    expect(JSON.parse(buildLensDeclarationStarter('config'))).toEqual({ version: 1, settings: [] });
    expect(JSON.parse(buildLensDeclarationStarter('mappings'))).toEqual({ version: 1, mappings: [], suppressions: [] });
    expect(JSON.parse(buildLensDeclarationStarter('trust'))).toEqual({ version: 1, fields: [] });
  });
});

describe('required declarations versus optional refinements', () => {
  it('counts only the two gates, so a project that declared both is finished', () => {
    const root = workspace();
    write(root, '.atlasmind/lens-state.json', {
      version: 1,
      machines: [{ id: 'job', label: 'Job', initial: 'queued', states: [{ id: 'queued', label: 'Queued' }], transitions: [] }],
    });
    write(root, '.atlasmind/lens-config.json', {
      version: 1,
      settings: [{
        id: 'log-level',
        key: 'LOG_LEVEL',
        valuePolicy: 'display',
        sources: [{ id: 'default', label: 'Default', kind: 'default', precedence: 0, applies: true, value: 'info' }],
      }],
    });

    const snapshot = inspectLensDeclarations(root);
    // The two optional files are still absent, and that must not make the
    // required pair read as incomplete — this is the count a stat card turns
    // green on.
    expect(snapshot.readyCount).toBe(2);
    expect(snapshot.totalCount).toBe(2);
    expect(snapshot.optionalReadyCount).toBe(0);
    expect(snapshot.optionalTotalCount).toBe(2);
  });

  it('marks each file required or optional according to whether a lens is gated on it', () => {
    const snapshot = inspectLensDeclarations(workspace());
    expect(snapshot.files.map(file => [file.kind, file.required])).toEqual([
      ['state', true],
      ['config', true],
      ['mappings', false],
      ['trust', false],
    ]);
  });

  it('counts a mappings file that only suppresses as declared, not as an untouched starter', () => {
    const root = workspace();
    write(root, '.atlasmind/lens-mappings.json', {
      version: 1,
      mappings: [],
      suppressions: [{ id: 'legacy', field: { contractId: 'db.customers', fieldPath: 'legacy_id' }, reason: 'Import only.' }],
    });
    const file = inspectLensDeclarations(root).files.find(candidate => candidate.kind === 'mappings');
    expect(file?.status).toBe('ready');
    expect(file?.declarationCount).toBe(1);
  });

  it('reads a populated data-trust policy as ready', () => {
    const root = workspace();
    write(root, '.atlasmind/lens-data-trust.json', {
      version: 1,
      fields: [{
        id: 'user-email',
        contractId: 'api.User',
        fieldPath: 'emailAddress',
        classification: 'confidential',
        controls: ['consent'],
      }],
    });
    const file = inspectLensDeclarations(root).files.find(candidate => candidate.kind === 'trust');
    expect(file?.status).toBe('ready');
    expect(file?.declarationCount).toBe(1);
  });

  it('gives every declaration a purpose line, so no surface has to write its own', () => {
    for (const file of inspectLensDeclarations(workspace()).files) {
      expect(file.purpose.length).toBeGreaterThan(20);
    }
  });
});
