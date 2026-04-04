import { describe, expect, it } from 'vitest';
import { getValidatedSsotPath } from '../../src/bootstrap/bootstrapper.ts';

describe('getValidatedSsotPath', () => {
  it('accepts a simple relative path', () => {
    expect(getValidatedSsotPath('project_memory')).toBe('project_memory');
  });

  it('normalises backslashes to forward slashes', () => {
    expect(getValidatedSsotPath('docs\\memory')).toBe('docs/memory');
  });

  it('accepts nested relative paths', () => {
    expect(getValidatedSsotPath('a/b/c')).toBe('a/b/c');
  });

  it('rejects empty input', () => {
    expect(getValidatedSsotPath('')).toBeUndefined();
  });

  it('rejects whitespace-only input', () => {
    expect(getValidatedSsotPath('   ')).toBeUndefined();
  });

  it('rejects absolute paths starting with /', () => {
    expect(getValidatedSsotPath('/etc/passwd')).toBeUndefined();
  });

  it('rejects absolute paths starting with backslash', () => {
    expect(getValidatedSsotPath('\\Windows\\System32')).toBeUndefined();
  });

  it('rejects Windows drive letter paths', () => {
    expect(getValidatedSsotPath('C:\\Users\\project')).toBeUndefined();
  });

  it('rejects paths containing .. traversal', () => {
    expect(getValidatedSsotPath('project_memory/../../../etc')).toBeUndefined();
  });

  it('rejects paths containing single dot segments', () => {
    expect(getValidatedSsotPath('./project_memory')).toBeUndefined();
  });

  it('rejects bare .. path', () => {
    expect(getValidatedSsotPath('..')).toBeUndefined();
  });

  it('strips leading/trailing whitespace and still validates', () => {
    expect(getValidatedSsotPath('  project_memory  ')).toBe('project_memory');
  });

  it('strips duplicate slashes', () => {
    expect(getValidatedSsotPath('a///b//c')).toBe('a/b/c');
  });
});
