import { memoryCache } from '../src/cli/nodeMemoryManager';

describe('nodeMemoryManager caching', () => {
  it('should export memoryCache as a Map', () => {
    expect(memoryCache).toBeInstanceOf(Map);
  });
});
