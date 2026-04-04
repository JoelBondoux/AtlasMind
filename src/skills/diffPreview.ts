import type { SkillDefinition } from '../types.js';

export const diffPreviewSkill: SkillDefinition = {
  id: 'diff-preview',
  name: 'Diff Preview',
  builtIn: true,
  description:
    'Review all pending changes in the workspace before committing. ' +
    'Shows a summary of modified/added/deleted files, lines changed, and the full unified diff including untracked files.',
  parameters: {
    type: 'object',
    properties: {
      staged: {
        type: 'boolean',
        description: 'If true, show only staged changes. Default: false (all changes).',
      },
    },
  },
  async execute(params, context) {
    const staged = params['staged'] === true;

    const status = await context.getGitStatus();
    const diff = await context.getGitDiff({ staged });

    const statusLines = status.split(/\r?\n/).filter(l => l.trim().length > 0);

    // Count file changes by status
    let modified = 0;
    let added = 0;
    let deleted = 0;
    let other = 0;
    for (const line of statusLines) {
      const code = line.substring(0, 2).trim();
      if (code === 'M' || code === 'MM') { modified++; }
      else if (code === 'A' || code === '??' || code === 'AM') { added++; }
      else if (code === 'D') { deleted++; }
      else if (!line.startsWith('##')) { other++; }
    }

    // Count diff stats
    let linesAdded = 0;
    let linesRemoved = 0;
    for (const line of diff.split(/\r?\n/)) {
      if (line.startsWith('+') && !line.startsWith('+++')) { linesAdded++; }
      else if (line.startsWith('-') && !line.startsWith('---')) { linesRemoved++; }
    }

    const summary = [
      '## Change Summary',
      `Modified: ${modified} | Added: ${added} | Deleted: ${deleted}${other > 0 ? ` | Other: ${other}` : ''}`,
      `Lines: +${linesAdded} / -${linesRemoved}`,
      '',
      '## Status',
      status,
    ];

    if (diff.trim().length > 0) {
      summary.push('', '## Diff', diff);
    } else {
      summary.push('', '(No diff available — changes may be untracked. Use `git add` first.)');
    }

    return summary.join('\n');
  },
};
