import type { MemoryEntry, SkillDefinition } from '../types.js';

export const memoryWriteSkill: SkillDefinition = {
  id: 'memory-write',
  name: 'Write Memory',
  description: 'Add or update an entry in the project SSOT in-memory index.',
  parameters: {
    type: 'object',
    required: ['path', 'title', 'snippet'],
    properties: {
      path: {
        type: 'string',
        description: 'Relative path of the SSOT entry (e.g. "decisions/use-vitest.md").',
      },
      title: {
        type: 'string',
        description: 'Title of the memory entry.',
      },
      snippet: {
        type: 'string',
        description: 'Content or summary to store.',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional tags for categorisation.',
      },
    },
  },
  async execute(params, context) {
    const path = params['path'];
    const title = params['title'];
    const snippet = params['snippet'];
    if (
      typeof path !== 'string' ||
      typeof title !== 'string' ||
      typeof snippet !== 'string'
    ) {
      return 'Error: "path", "title", and "snippet" are required strings.';
    }
    const rawTags = params['tags'];
    const tags = Array.isArray(rawTags)
      ? rawTags.filter((t): t is string => typeof t === 'string')
      : [];

    const entry: MemoryEntry = {
      path,
      title,
      tags,
      lastModified: new Date().toISOString(),
      snippet,
    };
    context.upsertMemory(entry);
    return `Memory entry written: ${path}`;
  },
};
