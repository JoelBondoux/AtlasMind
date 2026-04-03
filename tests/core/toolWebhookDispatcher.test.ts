import { describe, expect, it } from 'vitest';

import { toJsonPreview, toTextPreview } from '../../src/core/toolWebhookDispatcher.js';

describe('toolWebhookDispatcher preview helpers', () => {
  it('redacts sensitive key fields in JSON previews', () => {
    const preview = toJsonPreview({
      apiKey: 'sk-1234567890abcdefghijklmnop',
      token: 'verysecrettokenvalue12345',
      nested: { password: 'supersecretpw' },
    });

    expect(preview).toContain('[REDACTED]');
    expect(preview).not.toContain('verysecrettokenvalue12345');
    expect(preview).not.toContain('supersecretpw');
  });

  it('truncates long JSON previews', () => {
    const preview = toJsonPreview({ value: 'x'.repeat(200) }, 50);
    expect(preview).toBeDefined();
    expect(preview?.length).toBeLessThanOrEqual(53);
    expect(preview?.endsWith('...')).toBe(true);
  });

  it('redacts sensitive bearer values in text previews', () => {
    const preview = toTextPreview('authorization: bearer abcdefghijklmnopqrstuvwxyz');
    expect(preview.toLowerCase()).toContain('authorization: bearer [redacted]');
  });

  it('truncates long text previews', () => {
    const preview = toTextPreview('x'.repeat(100), 20);
    expect(preview).toBe('x'.repeat(20) + '...');
  });
});
