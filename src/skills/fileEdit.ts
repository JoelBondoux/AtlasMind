import type { SkillDefinition } from '../types.js';
import { requireString, optionalBoolean, optionalPositiveInt } from './validation.js';

export const fileEditSkill: SkillDefinition = {
  id: 'file-edit',
  name: 'Edit File',
  builtIn: true,
  description:
    'Perform targeted literal search-and-replace edits inside a workspace file. ' +
    'Fails when the expected match count does not line up, reducing accidental rewrites.',
  parameters: {
    type: 'object',
    required: ['path', 'search', 'replace'],
    properties: {
      path: {
        type: 'string',
        description: 'Absolute path to the file to edit.',
      },
      search: {
        type: 'string',
        description: 'Literal text to find.',
      },
      replace: {
        type: 'string',
        description: 'Replacement text.',
      },
      replaceAll: {
        type: 'boolean',
        description: 'When true, replace every occurrence instead of only the first.',
      },
      expectedMatches: {
        type: 'integer',
        description: 'Optional exact match count required before the edit is applied.',
      },
    },
  },
  async execute(params, context) {
    const search = params['search'];
    const replace = params['replace'];

    const pathErr = requireString(params, 'path');
    if (pathErr) { return pathErr; }
    if (typeof search !== 'string' || search.length === 0) {
      return 'Error: "search" parameter is required and must be a non-empty string.';
    }
    if (typeof replace !== 'string') {
      return 'Error: "replace" parameter is required and must be a string.';
    }
    const replaceAllErr = optionalBoolean(params, 'replaceAll');
    if (replaceAllErr) { return replaceAllErr; }
    const matchErr = optionalPositiveInt(params, 'expectedMatches');
    if (matchErr) { return matchErr; }

    const absolutePath = (params['path'] as string).trim();
    const replaceAll = params['replaceAll'];
    const expectedMatches = params['expectedMatches'];
    const original = await context.readFile(absolutePath);
    const matchCount = countLiteralMatches(original, search);

    if (matchCount === 0) {
      return `Error: search text was not found in ${absolutePath}.`;
    }
    if (typeof expectedMatches === 'number' && matchCount !== expectedMatches) {
      return `Error: expected ${expectedMatches} matches but found ${matchCount}.`;
    }

    const updated = replaceAll === true
      ? original.split(search).join(replace)
      : original.replace(search, replace);

    if (updated === original) {
      return `No changes were applied to ${absolutePath}.`;
    }

    await context.writeFile(absolutePath, updated);
    return `Updated ${absolutePath} (${replaceAll === true ? matchCount : 1} replacement${replaceAll === true && matchCount !== 1 ? 's' : ''}).`;
  },
};

function countLiteralMatches(haystack: string, needle: string): number {
  if (needle.length === 0) {
    return 0;
  }

  let count = 0;
  let index = 0;
  while (index <= haystack.length - needle.length) {
    const found = haystack.indexOf(needle, index);
    if (found === -1) {
      break;
    }
    count += 1;
    index = found + needle.length;
  }

  return count;
}