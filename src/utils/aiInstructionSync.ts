import * as path from 'node:path';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import * as vscode from 'vscode';

export interface AiInstructionFileEntry {
  tool: string;
  label: string;
  relativePath: string;
  preview: string;
  sizeLabel: string;
}

export interface AiInstructionSyncResult {
  success: boolean;
  summary: string;
  synced: string[];
}

export const AI_INSTRUCTION_SOURCES = [
  { tool: 'GitHub Copilot', paths: ['.github/copilot-instructions.md'] },
  { tool: 'Claude Code', paths: ['CLAUDE.md', '.claude/CLAUDE.md'] },
  { tool: 'Cursor', paths: ['.cursorrules'] },
  { tool: 'Cline', paths: ['.clinerules', '.cline/system_prompt.md'] },
  { tool: 'Continue', paths: ['.continue/config.json', '.continuerc.json'] },
  { tool: 'OpenAI Codex', paths: ['AGENTS.md'] },
  { tool: 'Gemini CLI', paths: ['GEMINI.md', '.gemini/system.md'] },
  { tool: 'Windsurf', paths: ['WINDSURF.md'] },
  { tool: 'Aider', paths: ['.aider.system.md'] },
] as const;

export const AI_INSTRUCTIONS_SYNC_REL_PATH = 'project_memory/domain/ai-instructions-sync.md';

function isSafeRelativePath(value: string): boolean {
  const normalized = value.trim().replace(/\\/g, '/');
  if (normalized.length === 0 || normalized.includes('\0') || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    return false;
  }
  return normalized.split('/').every(segment => segment.length > 0 && segment !== '..');
}

function resolveRelativePath(workspaceRoot: string, candidate: string): string | undefined {
  if (!isSafeRelativePath(candidate)) {
    return undefined;
  }
  const resolved = path.resolve(workspaceRoot, candidate);
  const relative = path.relative(workspaceRoot, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return undefined;
  }
  return resolved;
}

export function scanAiInstructionFiles(workspaceRoot: string): AiInstructionFileEntry[] {
  const entries: AiInstructionFileEntry[] = [];

  for (const source of AI_INSTRUCTION_SOURCES) {
    for (const relativePath of source.paths) {
      const resolved = resolveRelativePath(workspaceRoot, relativePath);
      if (!resolved || !existsSync(resolved)) {
        continue;
      }
      try {
        const stats = statSync(resolved);
        const sizeLabel = stats.size < 1024 ? `${stats.size} B` : `${(stats.size / 1024).toFixed(1)} KB`;
        const raw = readFileSync(resolved, { encoding: 'utf8' });
        let preview = raw.trim();
        if (relativePath.endsWith('.json')) {
          try {
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            const msg = parsed['systemMessage'] ?? parsed['system'] ?? parsed['instructions'];
            if (typeof msg === 'string' && msg.trim().length > 0) {
              preview = msg.trim();
            }
          } catch {
            // Use raw content
          }
        }
        entries.push({
          tool: source.tool,
          label: relativePath,
          relativePath,
          preview: preview.slice(0, 300).replace(/\r\n/g, '\n'),
          sizeLabel,
        });
      } catch {
        // Skip unreadable files
      }
    }
  }

  for (const [tool, rulesDir] of [['Cursor', '.cursor/rules'], ['Windsurf', '.windsurf/rules']] as [string, string][]) {
    const absRulesDir = resolveRelativePath(workspaceRoot, rulesDir);
    if (!absRulesDir || !existsSync(absRulesDir)) {
      continue;
    }
    try {
      for (const file of readdirSync(absRulesDir)) {
        if (!/\.(md|mdc|txt)$/.test(file)) {
          continue;
        }
        const relPath = `${rulesDir}/${file}`;
        const absFile = resolveRelativePath(workspaceRoot, relPath);
        if (!absFile) {
          continue;
        }
        try {
          const stats = statSync(absFile);
          const sizeLabel = stats.size < 1024 ? `${stats.size} B` : `${(stats.size / 1024).toFixed(1)} KB`;
          const raw = readFileSync(absFile, { encoding: 'utf8' });
          entries.push({
            tool,
            label: relPath,
            relativePath: relPath,
            preview: raw.trim().slice(0, 300).replace(/\r\n/g, '\n'),
            sizeLabel,
          });
        } catch {
          // Skip
        }
      }
    } catch {
      // Skip unreadable directory
    }
  }

  return entries;
}

export function hasAiInstructionSyncFile(workspaceRoot: string): boolean {
  const resolved = resolveRelativePath(workspaceRoot, AI_INSTRUCTIONS_SYNC_REL_PATH);
  return resolved !== undefined && existsSync(resolved);
}

export async function syncAiInstructionFiles(
  workspaceRoot: string,
  relativePaths: string[],
): Promise<AiInstructionSyncResult> {
  const safePaths = relativePaths.filter(p => typeof p === 'string' && isSafeRelativePath(p));
  if (safePaths.length === 0) {
    return { success: false, summary: 'No valid paths provided.', synced: [] };
  }

  const sections: string[] = [];
  const synced: string[] = [];

  for (const relativePath of safePaths) {
    const resolved = resolveRelativePath(workspaceRoot, relativePath);
    if (!resolved || !existsSync(resolved)) {
      continue;
    }
    try {
      const raw = readFileSync(resolved, { encoding: 'utf8' });
      let content = raw.trim();
      if (relativePath.endsWith('.json')) {
        try {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          const msg = parsed['systemMessage'] ?? parsed['system'] ?? parsed['instructions'];
          if (typeof msg === 'string' && msg.trim().length > 0) {
            content = msg.trim();
          }
        } catch {
          // Use raw content
        }
      }
      if (content.length > 0) {
        sections.push(`## From \`${relativePath}\`\n\n${content}`);
        synced.push(relativePath);
      }
    } catch {
      // Skip unreadable files
    }
  }

  if (sections.length === 0) {
    return { success: false, summary: 'Could not read any of the selected files.', synced: [] };
  }

  const timestamp = new Date().toISOString().slice(0, 10);
  const outputContent = [
    '# AI Instructions Sync',
    '',
    `> Synced on ${timestamp} from ${synced.length} source file${synced.length === 1 ? '' : 's'}.`,
    '> **Advisory context only.** AtlasMind\'s Personality Profile settings take precedence over this content.',
    '> When instructions here conflict with the Workspace Identity Profile, the profile wins.',
    '',
    ...sections,
  ].join('\n');

  const outputResolved = resolveRelativePath(workspaceRoot, AI_INSTRUCTIONS_SYNC_REL_PATH);
  if (!outputResolved) {
    return { success: false, summary: 'Output path resolution failed.', synced: [] };
  }

  try {
    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(outputResolved),
      Buffer.from(outputContent, 'utf8'),
    );
    const sourceList = synced.map(s => `\`${s}\``).join(', ');
    return {
      success: true,
      summary: `Merged ${synced.length} source file${synced.length === 1 ? '' : 's'} (${sourceList}) into AtlasMind's workspace context.`,
      synced,
    };
  } catch (err) {
    return {
      success: false,
      summary: `Failed to write sync file: ${err instanceof Error ? err.message : String(err)}`,
      synced: [],
    };
  }
}
