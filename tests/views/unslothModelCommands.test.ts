import { describe, expect, it } from 'vitest';

import { formatBytes, normalizeStudioBaseUrl } from '../../src/views/unslothModelCommands.js';

describe('the Unsloth Studio address', () => {
  it('accepts the origin or the /v1 base and always gives back the /v1 base', () => {
    expect(normalizeStudioBaseUrl('http://127.0.0.1:8888')).toEqual({
      baseUrl: 'http://127.0.0.1:8888/v1', origin: 'http://127.0.0.1:8888', plaintextOffLoopback: false,
    });
    expect(normalizeStudioBaseUrl(' http://localhost:8888/v1/ ')).toMatchObject({ baseUrl: 'http://localhost:8888/v1' });
  });

  it('flags plain HTTP to another machine, because the key would cross the network unencrypted', () => {
    expect(normalizeStudioBaseUrl('http://192.168.1.20:8888/v1')).toMatchObject({ plaintextOffLoopback: true });
    expect(normalizeStudioBaseUrl('https://studio.example.net/v1')).toMatchObject({ plaintextOffLoopback: false });
    expect(normalizeStudioBaseUrl('http://[::1]:8888')).toMatchObject({ plaintextOffLoopback: false });
  });

  it('refuses what it would otherwise have to guess at', () => {
    for (const bad of ['not a url', 'ftp://127.0.0.1:8888', 'http://user:pass@127.0.0.1:8888', 'http://127.0.0.1:8888/proxy/v1', 'http://127.0.0.1:8888/v1?x=1']) {
      expect(normalizeStudioBaseUrl(bad), bad).toHaveProperty('error');
    }
  });
});

describe('sizes', () => {
  it('says unknown rather than zero', () => {
    expect(formatBytes(undefined)).toBe('size unknown');
    expect(formatBytes(0)).toBe('size unknown');
    expect(formatBytes(9 * 1024 ** 3)).toBe('9.0 GB');
    expect(formatBytes(300 * 1024 ** 2)).toBe('300 MB');
  });
});
