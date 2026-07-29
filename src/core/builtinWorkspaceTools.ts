import type { SkillDefinition, SkillExecutionContext } from '../types.js';

/**
 * Built-in workspace tool SkillDefinitions used by project subtask agents.
 * The planner assigns these IDs in its system prompt; registering them here
 * ensures they are resolved when the agentic loop dispatches tool calls.
 *
 * Path safety: writeFile, deleteFile, and moveFile already enforce workspace
 * root confinement inside SkillExecutionContext. No additional validation
 * is needed at this layer.
 */

function makeFileReadTool(): SkillDefinition {
  return {
    id: 'file-read',
    name: 'Read File',
    description: 'Read the UTF-8 text content of a file by absolute workspace path.',
    builtIn: true,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the file to read.' },
      },
      required: ['path'],
    },
    execute: async (params: Record<string, unknown>, ctx: SkillExecutionContext): Promise<string> => {
      const filePath = String(params['path'] ?? '');
      return ctx.readFile(filePath);
    },
  };
}

function makeFileWriteTool(): SkillDefinition {
  return {
    id: 'file-write',
    name: 'Write File',
    description: 'Write UTF-8 text content to a file by absolute workspace path. Creates the file if it does not exist. Rejects paths outside the workspace root.',
    builtIn: true,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the file to write.' },
        content: { type: 'string', description: 'Full UTF-8 content to write.' },
      },
      required: ['path', 'content'],
    },
    execute: async (params: Record<string, unknown>, ctx: SkillExecutionContext): Promise<string> => {
      const filePath = String(params['path'] ?? '');
      const content = String(params['content'] ?? '');
      await ctx.writeFile(filePath, content);
      return `Written: ${filePath}`;
    },
  };
}

function makeFileEditTool(): SkillDefinition {
  return {
    id: 'file-edit',
    name: 'Edit File',
    description: 'Apply a targeted find-and-replace edit to a file. Reads the file, replaces the first occurrence of old_string with new_string, and writes it back. Fails if old_string is not found.',
    builtIn: true,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the file to edit.' },
        old_string: { type: 'string', description: 'Exact text to find and replace.' },
        new_string: { type: 'string', description: 'Replacement text.' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
    execute: async (params: Record<string, unknown>, ctx: SkillExecutionContext): Promise<string> => {
      const filePath = String(params['path'] ?? '');
      const oldStr = String(params['old_string'] ?? '');
      const newStr = String(params['new_string'] ?? '');
      const current = await ctx.readFile(filePath);
      if (!current.includes(oldStr)) {
        throw new Error(`old_string not found in ${filePath}. Read the file first to get the exact current content.`);
      }
      await ctx.writeFile(filePath, current.replace(oldStr, newStr));
      return `Edited: ${filePath}`;
    },
  };
}

function makeFileSearchTool(): SkillDefinition {
  return {
    id: 'file-search',
    name: 'Search Files',
    description: 'Search for files by glob pattern or search for text content across workspace files.',
    builtIn: true,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text or regex pattern to search for in file contents.' },
        glob: { type: 'string', description: 'Optional glob pattern to restrict the search (e.g. "**/*.ts").' },
        is_regexp: { type: 'boolean', description: 'If true, treat query as a regular expression.' },
        max_results: { type: 'number', description: 'Maximum number of results to return (default 30).' },
      },
      required: ['query'],
    },
    execute: async (params: Record<string, unknown>, ctx: SkillExecutionContext): Promise<string> => {
      const query = String(params['query'] ?? '');
      const globPattern = typeof params['glob'] === 'string' ? params['glob'] : undefined;
      const isRegexp = Boolean(params['is_regexp'] ?? false);
      const maxResults = typeof params['max_results'] === 'number' ? params['max_results'] : 30;
      const hits = await ctx.searchInFiles(query, { isRegexp, includePattern: globPattern, maxResults });
      if (hits.length === 0) {
        return 'No matches found.';
      }
      return hits.map(h => `${h.path}:${h.line}: ${h.text.trim()}`).join('\n');
    },
  };
}

function makeMemoryQueryTool(): SkillDefinition {
  return {
    id: 'memory-query',
    name: 'Query Project Memory',
    description: 'Search the SSOT project memory for entries relevant to a query. Returns titles and snippets.',
    builtIn: true,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural-language query to search project memory.' },
        max_results: { type: 'number', description: 'Maximum number of results (default 5).' },
      },
      required: ['query'],
    },
    execute: async (params: Record<string, unknown>, ctx: SkillExecutionContext): Promise<string> => {
      const query = String(params['query'] ?? '');
      const maxResults = typeof params['max_results'] === 'number' ? params['max_results'] : 5;
      const entries = await ctx.queryMemory(query, maxResults);
      if (entries.length === 0) {
        return 'No relevant memory entries found.';
      }
      return entries.map(e => `### ${e.title}\n${e.snippet}`).join('\n\n');
    },
  };
}

function makeMemoryWriteTool(): SkillDefinition {
  return {
    id: 'memory-write',
    name: 'Write Project Memory',
    description: 'Add or update an entry in the SSOT project memory.',
    builtIn: true,
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short title for the memory entry.' },
        content: { type: 'string', description: 'Content to store in the memory entry.' },
        folder: { type: 'string', description: 'Optional SSOT subfolder (e.g. "decisions", "architecture").' },
      },
      required: ['title', 'content'],
    },
    execute: async (params: Record<string, unknown>, ctx: SkillExecutionContext): Promise<string> => {
      const title = String(params['title'] ?? '');
      const snippet = String(params['content'] ?? '');
      const folder = typeof params['folder'] === 'string' ? params['folder'] : 'decisions';
      const slug = title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 60);
      const entryPath = `${folder}/${slug}.md`;
      const result = ctx.upsertMemory({ title, snippet, tags: [], path: entryPath, lastModified: new Date().toISOString() });
      return result.status !== 'rejected' ? `Memory saved: ${title}` : `Memory save failed: ${result.reason ?? 'unknown error'}`;
    },
  };
}

function makeTestRunTool(): SkillDefinition {
  return {
    id: 'test-run',
    name: 'Run Tests',
    description: 'Run the workspace test suite and return the output. Defaults to "npm test" if no command is specified.',
    builtIn: true,
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Test command to run (e.g. "npm test", "npx jest src/foo.test.ts"). Defaults to "npm test".' },
        timeout_ms: { type: 'number', description: 'Timeout in milliseconds (default 120000).' },
      },
    },
    execute: async (params: Record<string, unknown>, ctx: SkillExecutionContext): Promise<string> => {
      const rawCommand = typeof params['command'] === 'string' && params['command'].trim()
        ? params['command'].trim()
        : 'npm test';
      const timeoutMs = typeof params['timeout_ms'] === 'number' ? params['timeout_ms'] : 120_000;
      const parts = rawCommand.split(/\s+/);
      const executable = parts[0] ?? 'npm';
      const args = parts.slice(1);
      const result = await ctx.runCommand(executable, args, { timeoutMs });
      const out = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
      return result.ok
        ? `Tests passed (exit ${result.exitCode}):\n${out}`
        : `Tests failed (exit ${result.exitCode}):\n${out}`;
    },
  };
}

/**
 * Tokenise a shell-style command string into an argv array, respecting single-
 * and double-quoted spans. This prevents commit messages or other arguments
 * that contain spaces from being split into multiple tokens.
 *
 * Rules (POSIX-ish, good enough for the subset of commands agents write):
 *   - Single-quoted spans: contents are literal, no escape processing.
 *   - Double-quoted spans: backslash escapes the next character.
 *   - Outside quotes: backslash escapes the next character; whitespace separates tokens.
 */
function splitShellCommand(cmd: string): string[] {
  const parts: string[] = [];
  let current = '';
  let i = 0;
  while (i < cmd.length) {
    const ch = cmd[i]!;
    if (ch === '"') {
      i++;
      while (i < cmd.length && cmd[i] !== '"') {
        if (cmd[i] === '\\' && i + 1 < cmd.length) {
          i++;
          current += cmd[i];
        } else {
          current += cmd[i];
        }
        i++;
      }
      i++; // skip closing "
    } else if (ch === "'") {
      i++;
      while (i < cmd.length && cmd[i] !== "'") {
        current += cmd[i];
        i++;
      }
      i++; // skip closing '
    } else if (ch === '\\' && i + 1 < cmd.length) {
      i++;
      current += cmd[i];
      i++;
    } else if (/\s/.test(ch)) {
      if (current) {
        parts.push(current);
        current = '';
      }
      i++;
    } else {
      current += ch;
      i++;
    }
  }
  if (current) {
    parts.push(current);
  }
  return parts;
}

function makeTerminalRunTool(): SkillDefinition {
  return {
    id: 'terminal-run',
    name: 'Run Terminal Command',
    description: 'Execute a shell command in the workspace and return stdout/stderr. Use for build steps, linting, installing packages, git staging, or other CLI operations. For git commits, prefer the git-commit tool.',
    builtIn: true,
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to execute (e.g. "npm install", "npx tsc --noEmit"). Quoted arguments are handled correctly.' },
        timeout_ms: { type: 'number', description: 'Timeout in milliseconds (default 60000).' },
      },
      required: ['command'],
    },
    execute: async (params: Record<string, unknown>, ctx: SkillExecutionContext): Promise<string> => {
      const rawCommand = String(params['command'] ?? '');
      const timeoutMs = typeof params['timeout_ms'] === 'number' ? params['timeout_ms'] : 60_000;
      const parts = splitShellCommand(rawCommand);
      const executable = parts[0] ?? '';
      if (!executable) {
        throw new Error('command must not be empty');
      }
      const args = parts.slice(1);
      const result = await ctx.runCommand(executable, args, { timeoutMs });
      const out = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
      return `exit ${result.exitCode}:\n${out || '(no output)'}`;
    },
  };
}

function makeWorkspaceObservabilityTool(): SkillDefinition {
  return {
    id: 'workspace-observability',
    name: 'Workspace Observability',
    description: 'Gather workspace state: git status, recent diff, diagnostics (compiler errors), or directory listing.',
    builtIn: true,
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['git-status', 'git-diff', 'diagnostics', 'list-directory'],
          description: 'What to observe.',
        },
        path: { type: 'string', description: 'Directory path for list-directory, or file paths for diagnostics (comma-separated).' },
        ref: { type: 'string', description: 'Git ref for git-diff (e.g. "HEAD~1").' },
      },
      required: ['kind'],
    },
    execute: async (params: Record<string, unknown>, ctx: SkillExecutionContext): Promise<string> => {
      const kind = String(params['kind'] ?? '');
      switch (kind) {
        case 'git-status':
          return ctx.getGitStatus();
        case 'git-diff': {
          const ref = typeof params['ref'] === 'string' ? params['ref'] : undefined;
          return ctx.getGitDiff({ ref });
        }
        case 'diagnostics': {
          const rawPath = typeof params['path'] === 'string' ? params['path'] : undefined;
          const paths = rawPath ? rawPath.split(',').map(p => p.trim()).filter(Boolean) : undefined;
          const diags = await ctx.getDiagnostics(paths);
          if (diags.length === 0) { return 'No diagnostics found.'; }
          return diags.map(d => `${d.path}:${d.line}:${d.column} [${d.severity}] ${d.message}`).join('\n');
        }
        case 'list-directory': {
          const dirPath = typeof params['path'] === 'string' ? params['path'] : undefined;
          const entries = await ctx.listDirectory(dirPath);
          return entries.map(e => `${e.type === 'directory' ? 'd' : 'f'} ${e.path}`).join('\n') || '(empty)';
        }
        default:
          throw new Error(`Unknown kind: ${kind}. Use one of: git-status, git-diff, diagnostics, list-directory`);
      }
    },
  };
}

/**
 * Ask another agent a question.
 *
 * The first tool here that gains an agent a *capability* rather than a fact, so
 * the description does two jobs: it tells the model what the tool is for, and it
 * tells it what the tool deliberately does not do. Both matter, because the
 * natural assumption — that handing off to a specialist gives you the
 * specialist's tools — is exactly the assumption that would turn every
 * restriction in the system into a suggestion.
 *
 * The policy lives in `agentHandoff.ts` and the execution in the orchestrator.
 * This is only the surface.
 */
function makeAgentHandoffTool(): SkillDefinition {
  return {
    id: 'agent-handoff',
    name: 'Ask Another Agent',
    description:
      'Ask a named specialist agent a question and get their answer. Use when a question genuinely '
      + 'belongs to another specialism — a security judgement, a test-design decision — rather than '
      + 'to save yourself work. The delegate answers; you keep ownership of the task and act on what '
      + 'they say. It runs with YOUR permissions, not its own: a tool you do not have, it does not '
      + 'get either. Delegation is capped in depth and cannot loop back to an agent already in the '
      + 'chain.',
    builtIn: true,
    parameters: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Id of the agent to ask, e.g. "security-reviewer".' },
        reason: { type: 'string', description: 'Why this question belongs to that agent.' },
        question: {
          type: 'string',
          description: 'The question, plus only the context needed to answer it. Not the whole task.',
        },
      },
      required: ['agent_id', 'question'],
    },
    execute: async (params: Record<string, unknown>, ctx: SkillExecutionContext): Promise<string> => {
      if (!ctx.runAgent) {
        // Absent rather than broken: this context has no orchestrator behind it.
        // Saying so beats a stack trace the model will try to work around.
        return 'Handoff refused (unavailable). Delegation is not available in this context — there is '
          + 'no orchestrator to run another agent. Answer with what you have.';
      }
      return ctx.runAgent({
        targetAgentId: String(params['agent_id'] ?? ''),
        reason: String(params['reason'] ?? ''),
        question: String(params['question'] ?? ''),
        // The caller identifies itself through the context the orchestrator
        // installed, never through arguments the model supplies — otherwise an
        // agent could claim to be a more privileged one.
        callerAgentId: '',
        callerTaskId: '',
      });
    },
  };
}

export function getBuiltinWorkspaceTools(): SkillDefinition[] {
  return [
    makeAgentHandoffTool(),
    makeFileReadTool(),
    makeFileWriteTool(),
    makeFileEditTool(),
    makeFileSearchTool(),
    makeMemoryQueryTool(),
    makeMemoryWriteTool(),
    makeTestRunTool(),
    makeTerminalRunTool(),
    makeWorkspaceObservabilityTool(),
  ];
}
