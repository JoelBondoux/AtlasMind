import type { MemoryEntry, SkillDefinition } from '../types.js';

/** Maximum snippet length accepted from agents. */
const MAX_SNIPPET_INPUT = 4000;

export const memoryWriteSkill: SkillDefinition = {
  id: 'memory-write',
  name: 'Write Memory',
  builtIn: true,
  description:
    'Add or update an entry in the project SSOT memory. ' +
    'The entry is persisted to disk so it survives across sessions. ' +
    'Path must be a relative SSOT path ending in a text extension (e.g. "decisions/use-vitest.md").',
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
        description: 'Title of the memory entry (max 200 characters).',
      },
      snippet: {
        type: 'string',
        description: 'Content or summary to store (max 4000 characters).',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional tags for categorisation (max 12 tags, 50 chars each).',
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
    if (snippet.length > MAX_SNIPPET_INPUT) {
      return `Error: snippet exceeds ${MAX_SNIPPET_INPUT} character limit. Summarise the content before writing.`;
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
    const result = context.upsertMemory(entry);
    if (result.status === 'rejected') {
      return `Error: memory write rejected — ${result.reason}`;
    }
    return `Memory entry ${result.status}: ${path}`;
  },
};
