import type { SkillDefinition } from '../types.js';
import { optionalString, optionalIntMin } from './validation.js';

const LOG_GLOB_PATTERNS = [
  '**/*.log',
  '**/logs/*.txt',
  '**/.pm2/logs/*.log',
  '**/tmp/*.log',
  '**/temp/*.log',
];

const MAX_BYTES = 50_000;

export const logFileTailSkill: SkillDefinition = {
  id: 'log-file-tail',
  name: 'Log File Tail',
  builtIn: true,
  description:
    'Find and read recent lines from workspace log files. ' +
    'Use action "list" to discover log files matching common patterns (*.log, logs/*.txt, etc.). ' +
    'Use action "read" to tail the last N lines of a specific log file. ' +
    'Use action "search" to grep for a pattern across all workspace log files. ' +
    'Useful for diagnosing runtime errors, server logs, crash reports, and build output.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'read', 'search'],
        description: '"list" finds log files; "read" tails a file; "search" finds matching lines.',
      },
      path: {
        type: 'string',
        description: 'Absolute path to the log file (required for action "read").',
      },
      lines: {
        type: 'integer',
        description: 'Number of trailing lines to return for action "read" (default 100, max 500).',
      },
      pattern: {
        type: 'string',
        description: 'Text or regex pattern to search for (required for action "search").',
      },
    },
  },
  async execute(params, context) {
    const action = typeof params['action'] === 'string' ? params['action'] : 'list';
    const root = context.workspaceRootPath;
    if (!root) { return 'Error: No workspace is open.'; }

    if (action === 'list') {
      const allFiles: string[] = [];
      for (const glob of LOG_GLOB_PATTERNS) {
        const found = await context.findFiles(glob);
        allFiles.push(...found);
      }
      const unique = [...new Set(allFiles)].slice(0, 50);
      if (unique.length === 0) {
        return 'No log files found in the workspace (searched for *.log, logs/*.txt, and similar patterns).';
      }
      return `Log files found (${unique.length}):\n${unique.join('\n')}`;
    }

    if (action === 'read') {
      const pathErr = optionalString(params, 'path');
      if (pathErr) { return pathErr; }
      const filePath = typeof params['path'] === 'string' ? params['path'].trim() : '';
      if (!filePath) { return 'Error: "path" is required when action is "read".'; }

      const linesErr = optionalIntMin(params, 'lines', 1);
      if (linesErr) { return linesErr; }
      const requestedLines = typeof params['lines'] === 'number'
        ? Math.min(params['lines'], 500)
        : 100;

      let content: string;
      try {
        content = await context.readFile(filePath);
      } catch {
        return `Error: Could not read "${filePath}". Check the path is correct.`;
      }

      // Keep only the last N lines, within MAX_BYTES budget
      const allLines = content.split('\n');
      const tail = allLines.slice(-requestedLines);
      const result = tail.join('\n');
      if (result.length > MAX_BYTES) {
        return result.slice(-MAX_BYTES);
      }
      return `Last ${tail.length} lines of ${filePath}:\n${result}`;
    }

    if (action === 'search') {
      const patternErr = optionalString(params, 'pattern');
      if (patternErr) { return patternErr; }
      const pattern = typeof params['pattern'] === 'string' ? params['pattern'].trim() : '';
      if (!pattern) { return 'Error: "pattern" is required when action is "search".'; }

      const results = await context.searchInFiles(pattern, {
        includePattern: '**/*.log',
        maxResults: 200,
      });
      if (results.length === 0) {
        return `No matches for "${pattern}" in workspace log files.`;
      }
      const lines = results.map(r => `${r.path}:${r.line}: ${r.text.trim()}`);
      return `Matches for "${pattern}" in log files (${lines.length}):\n${lines.join('\n')}`;
    }

    return `Error: Unknown action "${action}". Use "list", "read", or "search".`;
  },
};
