import fc from 'fast-check';
import { describe, it } from 'vitest';

describe('property: reverse is its own inverse', () => {
  it('holds for any string', () => {
    fc.assert(fc.property(fc.string(), (s) => [...s].reverse().reverse().join('') === s));
  });
});
