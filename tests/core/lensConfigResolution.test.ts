import { describe, expect, it } from 'vitest';

import {
  buildLensConfigResolutionMap,
  normalizeLensConfigFile,
} from '../../src/core/lensConfigResolution';

describe('Lens configuration resolution', () => {
  it('orders declared sources and identifies the highest applying source without putting values in targets', () => {
    const file = normalizeLensConfigFile({
      version: 1,
      settings: [{
        id: 'api-base', key: 'app.apiBase', label: 'API base URL', valuePolicy: 'display',
        sources: [
          { id: 'default', label: 'Built-in default', kind: 'default', precedence: 0, applies: true, value: 'https://default.example' },
          { id: 'file', label: 'Production config', kind: 'config-file', precedence: 20, applies: true, value: 'https://api.example', source: { workspacePath: 'config/production.json' } },
          { id: 'runtime', label: 'Runtime override', kind: 'runtime-override', precedence: 50, applies: false, value: 'https://override.example' },
        ],
      }],
    });
    expect(file).toBeDefined();

    const map = buildLensConfigResolutionMap(file!.settings[0]!, { name: 'web', index: 0 });

    expect(map.winnerSourceId).toBe('file');
    expect(map.sources.map(source => [source.id, source.status])).toEqual([
      ['default', 'shadowed'], ['file', 'winner'], ['runtime', 'inactive'],
    ]);
    expect(map.sources[1]?.target?.detail).not.toContain('https://api.example');
    expect(map.sources[1]?.target).toEqual(expect.objectContaining({ kind: 'command', workspacePath: 'config/production.json' }));
  });

  it('forbids values in masked settings and refuses ambiguous precedence or unsafe paths', () => {
    const masked = normalizeLensConfigFile({
      version: 1,
      settings: [{
        id: 'token', key: 'service.token', valuePolicy: 'masked',
        sources: [{ id: 'env', label: 'SERVICE_TOKEN', kind: 'environment', precedence: 10, applies: true, present: true }],
      }],
    });
    expect(masked).toBeDefined();
    const map = buildLensConfigResolutionMap(masked!.settings[0]!, { name: 'api', index: 0 });
    expect(map.sources[0]?.displayValue).toBe('present — value hidden');
    expect(JSON.stringify(map)).not.toContain('service-secret');

    expect(normalizeLensConfigFile({
      version: 1,
      settings: [{
        id: 'bad', key: 'bad', valuePolicy: 'masked',
        sources: [{ id: 'env', label: 'TOKEN', kind: 'environment', precedence: 1, applies: true, present: true, value: 'service-secret' }],
      }],
    })).toBeUndefined();
    expect(normalizeLensConfigFile({
      version: 1,
      settings: [{
        id: 'bad', key: 'bad', valuePolicy: 'display',
        sources: [
          { id: 'a', label: 'A', kind: 'default', precedence: 1, applies: true, value: false },
          { id: 'b', label: 'B', kind: 'config-file', precedence: 1, applies: true, value: true },
        ],
      }],
    })).toBeUndefined();
    expect(normalizeLensConfigFile({
      version: 1,
      settings: [{
        id: 'bad', key: 'bad', valuePolicy: 'display',
        sources: [{ id: 'a', label: 'A', kind: 'config-file', precedence: 1, applies: true, value: true, source: { workspacePath: '../outside' } }],
      }],
    })).toBeUndefined();
  });
});
