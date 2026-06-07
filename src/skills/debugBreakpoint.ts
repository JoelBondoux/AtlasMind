import type { SkillDefinition } from '../types.js';
import { requireString, optionalString, optionalIntMin, optionalStringArray } from './validation.js';

export const debugBreakpointSkill: SkillDefinition = {
  id: 'debug-breakpoint',
  name: 'Breakpoint Manager',
  builtIn: true,
  description:
    'List, add, and remove breakpoints in the VS Code workspace. ' +
    'Use action "list" to see all current breakpoints with file, line, and condition. ' +
    'Use action "add" to set a breakpoint at a specific file path and line number, ' +
    'with optional hit condition or log message. ' +
    'Use action "remove" to delete one or more breakpoints by ID. ' +
    'Use action "clear" to remove all breakpoints at once.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'add', 'remove', 'clear'],
        description: '"list" shows all breakpoints; "add" sets one; "remove" deletes by ID; "clear" removes all.',
      },
      path: {
        type: 'string',
        description: 'Absolute path to the source file (required for action "add").',
      },
      line: {
        type: 'integer',
        description: '1-based line number (required for action "add").',
      },
      condition: {
        type: 'string',
        description: 'Optional conditional expression (e.g. "i > 10") for the breakpoint.',
      },
      logMessage: {
        type: 'string',
        description: 'Optional log message to print instead of pausing (logpoint).',
      },
      ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Breakpoint IDs to remove (required for action "remove").',
      },
    },
  },
  async execute(params, context) {
    if (!context.getBreakpoints || !context.addBreakpoint || !context.removeBreakpoints) {
      return 'Breakpoint management is not available in this environment (requires VS Code extension host).';
    }

    const action = typeof params['action'] === 'string' ? params['action'] : 'list';

    if (action === 'list') {
      const bps = await context.getBreakpoints();
      if (bps.length === 0) {
        return 'No breakpoints set.';
      }
      const lines = bps.map(bp => {
        const cond = bp.condition ? ` [condition: ${bp.condition}]` : '';
        const enabled = bp.enabled ? '' : ' [disabled]';
        return `  ${bp.id}  ${bp.path}:${bp.line}${cond}${enabled}`;
      });
      return `Breakpoints (${bps.length}):\n${lines.join('\n')}`;
    }

    if (action === 'add') {
      const pathErr = requireString(params, 'path');
      if (pathErr) { return pathErr; }
      const lineErr = optionalIntMin(params, 'line', 1);
      if (lineErr) { return lineErr; }
      const condErr = optionalString(params, 'condition');
      if (condErr) { return condErr; }
      const logErr = optionalString(params, 'logMessage');
      if (logErr) { return logErr; }

      const filePath = (params['path'] as string).trim();
      const line = typeof params['line'] === 'number' ? params['line'] : 1;
      const condition = typeof params['condition'] === 'string' ? params['condition'].trim() : undefined;
      const logMessage = typeof params['logMessage'] === 'string' ? params['logMessage'].trim() : undefined;

      if (!line) {
        return 'Error: "line" is required when action is "add".';
      }

      const id = await context.addBreakpoint(filePath, line, {
        condition: condition || undefined,
        logMessage: logMessage || undefined,
      });

      const desc = logMessage ? `logpoint "${logMessage}"` : condition ? `conditional breakpoint (${condition})` : 'breakpoint';
      return `Added ${desc} at ${filePath}:${line} (id: ${id})`;
    }

    if (action === 'remove') {
      const idsErr = optionalStringArray(params, 'ids');
      if (idsErr) { return idsErr; }
      const ids = Array.isArray(params['ids'])
        ? (params['ids'] as unknown[]).filter((v): v is string => typeof v === 'string')
        : [];
      if (ids.length === 0) {
        return 'Error: "ids" array is required and must not be empty when action is "remove".';
      }
      const result = await context.removeBreakpoints(ids);
      return `Removed ${result.removed} breakpoint(s).`;
    }

    if (action === 'clear') {
      const bps = await context.getBreakpoints();
      if (bps.length === 0) {
        return 'No breakpoints to clear.';
      }
      const allIds = bps.map(bp => bp.id);
      const result = await context.removeBreakpoints(allIds);
      return `Cleared ${result.removed} breakpoint(s).`;
    }

    return `Error: Unknown action "${action}". Use "list", "add", "remove", or "clear".`;
  },
};
