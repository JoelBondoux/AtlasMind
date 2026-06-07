import type { SkillDefinition } from '../types.js';
import { requireString, optionalIntMin } from './validation.js';

export const gitBlameSkill: SkillDefinition = {
  id: 'git-blame',
  name: 'Git Blame',
  builtIn: true,
  description:
    'Show which commit last modified each line of a file (git blame). ' +
    'Optionally restrict to a specific line range. ' +
    'Useful for understanding the history behind a bug or a particular code block ' +
    'and identifying the author, commit message, and date of each change.',
  parameters: {
    type: 'object',
    required: ['path'],
    properties: {
      path: {
        type: 'string',
        description: 'Absolute path to the file to blame.',
      },
      startLine: {
        type: 'integer',
        description: 'Optional 1-based start line for a focused range.',
      },
      endLine: {
        type: 'integer',
        description: 'Optional 1-based end line for a focused range.',
      },
    },
  },
  async execute(params, context) {
    const pathErr = requireString(params, 'path');
    if (pathErr) { return pathErr; }
    const filePath = (params['path'] as string).trim();

    const startErr = optionalIntMin(params, 'startLine', 1);
    if (startErr) { return startErr; }
    const endErr = optionalIntMin(params, 'endLine', 1);
    if (endErr) { return endErr; }

    const startLine = typeof params['startLine'] === 'number' ? params['startLine'] : undefined;
    const endLine = typeof params['endLine'] === 'number' ? params['endLine'] : undefined;

    if (startLine !== undefined && endLine !== undefined && endLine < startLine) {
      return 'Error: "endLine" must be >= "startLine".';
    }

    const args = ['blame', '--porcelain'];
    if (startLine !== undefined && endLine !== undefined) {
      args.push(`-L${startLine},${endLine}`);
    } else if (startLine !== undefined) {
      args.push(`-L${startLine},+50`);
    }
    args.push(filePath);

    const result = await context.runCommand('git', args);
    if (!result.ok && result.exitCode !== 0) {
      return `git blame failed (exit ${result.exitCode}):\n${result.stderr || result.stdout}`;
    }

    // Parse porcelain output into readable summary
    const lines = (result.stdout || result.stderr).split('\n');
    const entries: string[] = [];
    let currentHash = '';
    let author = '';
    let timestamp = '';
    let lineNum = 0;

    for (const line of lines) {
      if (/^[0-9a-f]{40}/.test(line)) {
        const parts = line.split(' ');
        currentHash = parts[0]?.slice(0, 8) ?? '';
        lineNum = parseInt(parts[2] ?? '0', 10);
      } else if (line.startsWith('author ')) {
        author = line.slice(7);
      } else if (line.startsWith('summary ')) {
      } else if (line.startsWith('author-time ')) {
        const epoch = parseInt(line.slice(12), 10);
        timestamp = new Date(epoch * 1000).toISOString().slice(0, 10);
      } else if (line.startsWith('\t')) {
        const code = line.slice(1);
        entries.push(`${String(lineNum).padStart(4)} ${currentHash} ${timestamp} ${author.padEnd(20).slice(0, 20)} | ${code}`);
        author = '';
        timestamp = '';
      }
    }

    if (entries.length === 0) {
      return result.stdout || result.stderr || 'No blame output returned.';
    }

    // Add commit summaries at top
    const summaryMap = new Map<string, string>();
    let currentSummaryHash = '';
    for (const line of lines) {
      if (/^[0-9a-f]{40}/.test(line)) {
        currentSummaryHash = line.slice(0, 8);
      } else if (line.startsWith('summary ') && currentSummaryHash) {
        summaryMap.set(currentSummaryHash, line.slice(8));
      }
    }

    const commitList = [...summaryMap.entries()].map(([h, s]) => `  ${h}: ${s}`);
    const header = `Commits referenced:\n${commitList.join('\n')}\n\nLine  Commit   Date       Author               | Code`;
    return `${header}\n${entries.join('\n')}`;
  },
};
