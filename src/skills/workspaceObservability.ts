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
    const debugSessionPromise = context.getActiveDebugSession
      ? context.getActiveDebugSession()
      : Promise.reject(new Error('Active debug session access is unavailable in this host.'));
    const terminalsPromise = context.listTerminals
      ? context.listTerminals()
      : Promise.reject(new Error('Integrated terminal access is unavailable in this host.'));
    const testResultsPromise = context.getTestResults
      ? context.getTestResults()
      : Promise.reject(new Error('Test result access is unavailable in this host.'));

    const [debugResult, terminalsResult, testResultsResult] = await Promise.allSettled([
      debugSessionPromise,
      terminalsPromise,
      testResultsPromise,
    ]);

    const sections: string[] = [];

    // Debug session
    if (debugResult.status === 'rejected') {
      sections.push(`## Active Debug Session\nUnavailable: ${String(debugResult.reason)}`);
    } else {
      const debugSession = debugResult.value;
      if (debugSession) {
        sections.push(`## Active Debug Session\nName: ${debugSession.name}\nType: ${debugSession.type}\nID: ${debugSession.id}`);
      } else {
        sections.push('## Active Debug Session\nNone');
      }
    }

    // Terminals
    if (terminalsResult.status === 'rejected') {
      sections.push(`## Open Terminals\nUnavailable: ${String(terminalsResult.reason)}`);
    } else {
      const terminals = terminalsResult.value;
      if (terminals.length === 0) {
        sections.push('## Open Terminals\nNone');
      } else {
        const terminalList = terminals.map(t => `- ${t.name}`).join('\n');
        sections.push(`## Open Terminals\n${terminalList}`);
      }
    }

    // Test results
    if (testResultsResult.status === 'rejected') {
      sections.push(`## Test Results\nUnavailable: ${String(testResultsResult.reason)}`);
    } else {
      const testResults = testResultsResult.value;
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
    }

    return sections.join('\n\n');
  },
};
