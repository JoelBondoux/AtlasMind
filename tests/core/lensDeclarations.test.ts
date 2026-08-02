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

    expect(inspectLensDeclarations(root).files.map(file => file.status)).toEqual(['missing', 'missing']);

    writeFileSync(path.join(root, '.atlasmind', 'lens-state.json'), buildLensDeclarationStarter('state'), 'utf8');
    writeFileSync(path.join(root, '.atlasmind', 'lens-config.json'), buildLensDeclarationStarter('config'), 'utf8');

    const snapshot = inspectLensDeclarations(root);
    expect(snapshot.files.map(file => file.status)).toEqual(['empty', 'empty']);
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
    expect(snapshot.files).toEqual([
      expect.objectContaining({ kind: 'state', status: 'ready', declarationCount: 1 }),
      expect.objectContaining({ kind: 'config', status: 'invalid', declarationCount: 0 }),
    ]);
    expect(snapshot.readyCount).toBe(1);
    expect(lensDeclarationStatusLabel(snapshot.files[1]!.status)).toBe('Invalid');
  });

  it('builds valid starters without pretending to know project semantics', () => {
    expect(JSON.parse(buildLensDeclarationStarter('state'))).toEqual({ version: 1, machines: [] });
    expect(JSON.parse(buildLensDeclarationStarter('config'))).toEqual({ version: 1, settings: [] });
  });
});
