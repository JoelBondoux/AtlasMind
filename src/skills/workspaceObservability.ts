import type { SkillDefinition } from '../types.js';

export const workspaceObservabilitySkill: SkillDefinition = {
  id: 'workspace-state',
  name: 'Workspace State',
  builtIn: true,
  description:
    'Return a snapshot of the active VS Code workspace state: output channel availability, active debug sessions, ' +
    'and a summary of the current workspace problems. Use this before answering questions about the live state of the project.',
  parameters: {
    type: 'object',
    properties: {},
  },
  async execute(_params, context) {
    const [channelNames, debugSessions, diagnostics] = await Promise.all([
      context.getOutputChannelNames(),
      context.getDebugSessions(),
      context.getDiagnostics(),
    ]);

    const lines: string[] = ['=== Workspace State ==='];

    // Output channels
    lines.push(`\nOutput Channels (${channelNames.length}):`);
    if (channelNames.length === 0) {
      lines.push('  (none detected)');
    } else {
      for (const name of channelNames) {
        lines.push(`  - ${name}`);
      }
    }

    // Debug sessions
    lines.push(`\nDebug Sessions (${debugSessions.length}):`);
    if (debugSessions.length === 0) {
      lines.push('  No active debug sessions.');
    } else {
      for (const session of debugSessions) {
        lines.push(`  - ${session.name} [${session.type}]`);
      }
    }

    // Problems summary
    const errors = diagnostics.filter(d => d.severity === 'error');
    const warnings = diagnostics.filter(d => d.severity === 'warning');
    lines.push(`\nWorkspace Problems: ${errors.length} error(s), ${warnings.length} warning(s)`);
    if (errors.length > 0) {
      const sample = errors.slice(0, 5);
      for (const err of sample) {
        lines.push(`  ✗ ${err.path}:${err.line} — ${err.message}`);
      }
      if (errors.length > 5) {
        lines.push(`  ... and ${errors.length - 5} more error(s)`);
      }
    }

    return lines.join('\n');
  },
};
