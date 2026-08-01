import { describe, expect, it } from 'vitest';
import { toJsonPreview } from '../../src/core/toolPreview.js';

describe('toJsonPreview', () => {
  it('should serialize a simple object to a JSON string', () => {
    const input = { a: 1, b: 'hello' };
    const expected = '{"a":1,"b":"hello"}';
    expect(toJsonPreview(input)).toBe(expected);
  });

  it('does not present a non-empty object as empty when custom serialization collapses it', () => {
    const input = {
      action: 'deploy',
      toJSON: () => ({}),
    };

    expect(toJsonPreview(input)).toBe('[unserializable arguments]');
  });
});
