import { existsSync, readFileSync } from 'node:fs';
import * as vscode from 'vscode';
import type { AgentDefinition, ProjectTestingConfig } from '../types.js';
import { TESTING_METHODOLOGY_DEFINITIONS } from '../types.js';
import { resolveRelativePath } from './aiInstructionSync.js';
import { upsertManagedBlock } from './managedBlock.js';
import { buildDebtMarkerGuidance, type CustomDebtMarker } from '../core/debtRegister.js';

/**
 * Outbound testing-protocol sync.
 *
 * The inbound flow (`aiInstructionSync.ts`) reads external agent rule files
 * INTO AtlasMind. This module does the reverse: it projects the project's
 * enabled testing methodologies (from `testing-config.json`) OUT into the
 * instruction files that external AI agents (Claude Code, Copilot, Cursor,
 * Cline, Gemini, Windsurf, Aider, Codex/AGENTS.md) already read — so they can
 * discover and enact the same protocols AtlasMind enforces.
 *
 * Safety: the writer is non-destructive. It only ever touches its own
 * delimited managed block and only writes to files that already exist
 * (the "detected" set). All paths pass the shared traversal guard.
 */

export const MANAGED_BLOCK_START = '<!-- atlasmind:testing-protocols:start -->';
export const MANAGED_BLOCK_END = '<!-- atlasmind:testing-protocols:end -->';

/**
 * A second, separate managed block for the debt markers.
 *
 * Separate rather than folded into the testing block because the two answer
 * different questions and change at different times — and because a tool that
 * has one block and not the other should keep the one it has rather than
 * having it rewritten by a sync about something else.
 */
export const DEBT_MARKER_BLOCK_START = '<!-- atlasmind:debt-markers:start -->';
export const DEBT_MARKER_BLOCK_END = '<!-- atlasmind:debt-markers:end -->';

/** Markdown-style instruction files that can host the managed block. */
const MANAGED_MARKDOWN_TARGETS: { tool: string; path: string }[] = [
  { tool: 'GitHub Copilot', path: '.github/copilot-instructions.md' },
  { tool: 'Claude Code', path: 'CLAUDE.md' },
  { tool: 'Claude Code', path: '.claude/CLAUDE.md' },
  { tool: 'Cursor', path: '.cursorrules' },
  { tool: 'Cline', path: '.clinerules' },
  { tool: 'Cline', path: '.cline/system_prompt.md' },
  { tool: 'OpenAI Codex', path: 'AGENTS.md' },
  { tool: 'Gemini CLI', path: 'GEMINI.md' },
  { tool: 'Gemini CLI', path: '.gemini/system.md' },
  { tool: 'Windsurf', path: 'WINDSURF.md' },
  { tool: 'Aider', path: '.aider.system.md' },
];

/**
 * Tools whose config is JSON (e.g. Continue's `config.json`) cannot host a
 * markdown comment block without corrupting the file. They are reported as
 * skipped so the operator knows to point those tools at `testing-config.json`.
 */
const JSON_INSTRUCTION_TARGETS = ['.continue/config.json', '.continuerc.json'];

export interface TestingProtocolSyncResult {
  success: boolean;
  summary: string;
  /** Relative paths whose managed block was created or refreshed. */
  updated: string[];
  /** Relative paths skipped, with the reason. */
  skipped: { path: string; reason: string }[];
}

function methodologyAgentLabel(
  assignedAgentId: string | undefined,
  agents: AgentDefinition[],
): string | undefined {
  if (!assignedAgentId) {
    return undefined;
  }
  const agent = agents.find(a => a.id === assignedAgentId);
  return agent ? agent.name : assignedAgentId;
}

/**
 * Renders the body of the managed block (without the delimiter comments) for
 * the enabled methodologies. Returns an empty string when nothing is enabled.
 */
export function buildTestingProtocolsMarkdown(
  config: ProjectTestingConfig,
  agents: AgentDefinition[],
): string {
  const enabled = config.methodologies.filter(m => m.enabled);
  const lines: string[] = [
    '## Testing Protocols (managed by AtlasMind)',
    '',
    '> Auto-generated from `project_memory/index/testing-config.json`. Do not edit by hand —',
    '> changes are overwritten on the next sync. Update the matrix in the AtlasMind Settings → Testing page instead.',
    '',
  ];

  if (enabled.length === 0) {
    lines.push('_No testing methodologies are currently enabled for this project._');
    return lines.join('\n');
  }

  lines.push(
    `This project enforces **${enabled.length}** testing methodolog${enabled.length === 1 ? 'y' : 'ies'}. ` +
      'When writing or verifying tests, follow the applicable protocols below and report the checks, ' +
      'assertions, or verification artifacts you produced before concluding.',
    '',
  );

  for (const methodConfig of enabled) {
    const def = TESTING_METHODOLOGY_DEFINITIONS.find(d => d.id === methodConfig.id);
    if (!def) {
      continue;
    }
    lines.push(`### ${def.label}`, '');
    lines.push(`- **What:** ${def.description}`);
    lines.push(`- **When to apply:** ${def.whenToUse}`);
    lines.push(`- **Key tools:** ${def.keyTools}`);
    const agentLabel = methodologyAgentLabel(methodConfig.assignedAgentId, agents);
    if (agentLabel) {
      lines.push(`- **Primary owner:** ${agentLabel}`);
    }
    if (methodConfig.assignedModelId) {
      lines.push(`- **Preferred model:** \`${methodConfig.assignedModelId}\``);
    }
    if (methodConfig.notes && methodConfig.notes.trim().length > 0) {
      lines.push(`- **Project notes:** ${methodConfig.notes.trim()}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

const TESTING_PROTOCOL_MARKERS = { start: MANAGED_BLOCK_START, end: MANAGED_BLOCK_END };
const DEBT_MARKER_MARKERS = { start: DEBT_MARKER_BLOCK_START, end: DEBT_MARKER_BLOCK_END };

/**
 * Writes the testing-protocol managed block into every detected (existing)
 * markdown instruction file. Non-destructive: untouched files outside the
 * managed block are preserved verbatim. JSON-config tools are reported as
 * skipped. Returns a per-file result for surfacing to the operator.
 */
/**
 * The debt-marker block body, for an external agent's instruction file.
 *
 * These files are read by Claude Code, Copilot, Cursor and the rest — tools
 * that write code in this repository and, until now, had no way of knowing
 * which markers this project records debt with. An agent that leaves a
 * shortcut marked its own way produces debt the register cannot see, and an
 * empty register then reads as "no debt" rather than "not detected".
 */
export function buildDebtMarkerMarkdown(customMarkers: readonly CustomDebtMarker[]): string {
  return [
    '## Technical debt markers',
    '',
    buildDebtMarkerGuidance(customMarkers),
    '',
  ].join('\n');
}

export async function syncTestingProtocols(
  workspaceRoot: string,
  config: ProjectTestingConfig,
  agents: AgentDefinition[],
  // Supplied rather than read here, like `config` and `agents` above it. This
  // module writes what it is given; reading a setting inside it would make a
  // file writer depend on a configuration host, which is both a wider
  // dependency than it needs and one its tests would have to fake.
  customMarkers: readonly CustomDebtMarker[] = [],
): Promise<TestingProtocolSyncResult> {
  const blockBody = buildTestingProtocolsMarkdown(config, agents);
  const markerBody = buildDebtMarkerMarkdown(customMarkers);
  const updated: string[] = [];
  const skipped: { path: string; reason: string }[] = [];

  for (const target of MANAGED_MARKDOWN_TARGETS) {
    const resolved = resolveRelativePath(workspaceRoot, target.path);
    if (!resolved || !existsSync(resolved)) {
      continue; // Only sync to files that already exist (detected set).
    }
    try {
      const existing = readFileSync(resolved, { encoding: 'utf8' });
      // Two blocks, written in one pass. Each owns its own delimiters, so a
      // file carrying one and not the other keeps what it has.
      const withProtocols = upsertManagedBlock(existing, blockBody, TESTING_PROTOCOL_MARKERS);
      const next = upsertManagedBlock(withProtocols, markerBody, DEBT_MARKER_MARKERS);
      if (next !== existing) {
        await vscode.workspace.fs.writeFile(vscode.Uri.file(resolved), Buffer.from(next, 'utf8'));
      }
      updated.push(target.path);
    } catch (err) {
      skipped.push({
        path: target.path,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  for (const jsonTarget of JSON_INSTRUCTION_TARGETS) {
    const resolved = resolveRelativePath(workspaceRoot, jsonTarget);
    if (resolved && existsSync(resolved)) {
      skipped.push({
        path: jsonTarget,
        reason: 'JSON config — point this tool at project_memory/index/testing-config.json instead.',
      });
    }
  }

  if (updated.length === 0) {
    const base = 'No AI agent instruction files were found to update.';
    return {
      success: false,
      summary: skipped.length > 0
        ? `${base} ${skipped.length} JSON-config tool${skipped.length === 1 ? '' : 's'} cannot embed the block.`
        : `${base} Create a CLAUDE.md or .github/copilot-instructions.md (or run project bootstrap) first.`,
      updated,
      skipped,
    };
  }

  const fileList = updated.map(p => `\`${p}\``).join(', ');
  return {
    success: true,
    summary: `Synced testing protocols into ${updated.length} agent instruction file${updated.length === 1 ? '' : 's'} (${fileList}).`,
    updated,
    skipped,
  };
}
