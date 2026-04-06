import type { SkillDefinition } from '../types.js';

export const workspaceObservabilitySkill: SkillDefinition = {
  id: 'workspace-observability',
  name: 'Workspace Observability',
  builtIn: true,
  description:
    'Get a snapshot of the current VS Code workspace state: active debug session, open terminals, ' +
    'and the most recent test run summary. Use this to orient yourself before diagnosing problems or ' +
    'suggesting next steps.',
  parameters: {
    type: 'object',
    properties: {},
  },
  async execute(_params, context) {
    const [debugSession, terminals, testResults] = await Promise.all([
      context.getActiveDebugSession(),
      context.listTerminals(),
      context.getTestResults(),
    ]);

    const sections: string[] = [];

    // Debug session
    if (debugSession) {
      sections.push(`## Active Debug Session\nName: ${debugSession.name}\nType: ${debugSession.type}\nID: ${debugSession.id}`);
    } else {
      sections.push('## Active Debug Session\nNone');
    }

    // Terminals
    if (terminals.length === 0) {
      sections.push('## Open Terminals\nNone');
    } else {
      const terminalList = terminals.map(t => `- ${t.name}`).join('\n');
      sections.push(`## Open Terminals\n${terminalList}`);
    }

    // Test results
    if (testResults.length === 0) {
      sections.push('## Test Results\nNo test runs recorded in this session.');
    } else {
      const resultLines = testResults.map(r => {
        const parts = Object.entries(r.counts)
          .filter(([, v]) => v > 0)
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ');
        const duration = r.durationMs !== undefined ? ` (${r.durationMs}ms)` : '';
        return `- Run ${r.id}${duration}: ${parts || 'no counts'}`;
      });
      sections.push(`## Test Results\n${resultLines.join('\n')}`);
    }

    return sections.join('\n\n');
  },
};
