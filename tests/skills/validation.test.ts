import { describe, expect, it } from 'vitest';
import {
  requireString,
  optionalString,
  optionalBoolean,
  optionalPositiveInt,
  optionalIntMin,
  optionalStringArray,
} from '../../src/skills/validation.ts';

describe('requireString', () => {
  it('returns undefined for a valid non-empty string', () => {
    expect(requireString({ name: 'hello' }, 'name')).toBeUndefined();
  });

  it('returns an error when the key is missing', () => {
    expect(requireString({}, 'name')).toContain('Error');
  });

  it('returns an error for an empty string', () => {
    expect(requireString({ name: '   ' }, 'name')).toContain('Error');
  });

  it('returns an error for a non-string value', () => {
    expect(requireString({ name: 42 }, 'name')).toContain('Error');
  });

  it('returns an error for null', () => {
    expect(requireString({ name: null }, 'name')).toContain('Error');
  });
});

describe('optionalString', () => {
  it('returns undefined when key is absent', () => {
    expect(optionalString({}, 'tag')).toBeUndefined();
  });

  it('returns undefined when value is a string', () => {
    expect(optionalString({ tag: 'abc' }, 'tag')).toBeUndefined();
  });

  it('returns an error when value is not a string', () => {
    expect(optionalString({ tag: 123 }, 'tag')).toContain('Error');
  });
});

describe('optionalBoolean', () => {
  it('returns undefined when key is absent', () => {
    expect(optionalBoolean({}, 'flag')).toBeUndefined();
  });

  it('returns undefined when value is a boolean', () => {
    expect(optionalBoolean({ flag: true }, 'flag')).toBeUndefined();
  });

  it('returns an error when value is not a boolean', () => {
    expect(optionalBoolean({ flag: 'yes' }, 'flag')).toContain('Error');
  });
});

describe('optionalPositiveInt', () => {
  it('returns undefined when key is absent', () => {
    expect(optionalPositiveInt({}, 'count')).toBeUndefined();
  });

  it('returns undefined for a positive integer', () => {
    expect(optionalPositiveInt({ count: 5 }, 'count')).toBeUndefined();
  });

  it('returns an error for zero', () => {
    expect(optionalPositiveInt({ count: 0 }, 'count')).toContain('Error');
  });

  it('returns an error for a negative number', () => {
    expect(optionalPositiveInt({ count: -1 }, 'count')).toContain('Error');
  });

  it('returns an error for a float', () => {
    expect(optionalPositiveInt({ count: 1.5 }, 'count')).toContain('Error');
  });

  it('returns an error for a string', () => {
    expect(optionalPositiveInt({ count: '5' }, 'count')).toContain('Error');
  });
});

describe('optionalIntMin', () => {
  it('returns undefined when key is absent', () => {
    expect(optionalIntMin({}, 'offset', 0)).toBeUndefined();
  });

  it('returns undefined for a value at the minimum', () => {
    expect(optionalIntMin({ offset: 0 }, 'offset', 0)).toBeUndefined();
  });

  it('returns an error for a value below the minimum', () => {
    expect(optionalIntMin({ offset: -1 }, 'offset', 0)).toContain('Error');
  });

  it('returns an error for a float', () => {
    expect(optionalIntMin({ offset: 1.5 }, 'offset', 0)).toContain('Error');
  });
});

describe('optionalStringArray', () => {
  it('returns undefined when key is absent', () => {
    expect(optionalStringArray({}, 'tags')).toBeUndefined();
  });

  it('returns undefined for a valid array of strings', () => {
    expect(optionalStringArray({ tags: ['a', 'b'] }, 'tags')).toBeUndefined();
  });

  it('returns undefined for an empty array', () => {
    expect(optionalStringArray({ tags: [] }, 'tags')).toBeUndefined();
  });

  it('returns an error for a non-array', () => {
    expect(optionalStringArray({ tags: 'a' }, 'tags')).toContain('Error');
  });

  it('returns an error for an array with non-strings', () => {
    expect(optionalStringArray({ tags: ['a', 42] }, 'tags')).toContain('Error');
  });
});
