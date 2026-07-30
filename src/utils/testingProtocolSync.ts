import { existsSync, readFileSync } from 'node:fs';
import * as vscode from 'vscode';
import type { AgentDefinition, ProjectTestingConfig } from '../types.js';
import { TESTING_METHODOLOGY_DEFINITIONS } from '../types.js';
import { resolveRelativePath } from './aiInstructionSync.js';
import { upsertManagedBlock } from './managedBlock.js';
import { buildDebtMarkerGuidance, type CustomDebtMarker } from '../core/debtRegister.js';
import { buildWorkflowGuidance, type WorkflowGuidanceInput } from '../core/workflowGuidance.js';
import { readWorkflowConfig, WORKFLOW_SSOT_PATH } from '../core/workflowConfig.js';
import {
  digestSource,
  formatSourceDigestComment,
  type InstructionBlockKind,
} from './instructionSyncCheck.js';

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

/**
 * A third block: the declared GitHub workflow.
 *
 * The reason it exists is the reason the others do, sharpened. AtlasMind's
 * workflow gates are self-restraints — `min(master, ceiling, capability, stage)`
 * decides what *AtlasMind* may do, and can bind nothing else. An external agent
 * committing straight to the integration branch was not breaking the workflow;
 * it had no way to know one was declared. Putting the rules where the agent
 * already looks is the only mechanism available over a process AtlasMind does
 * not run.
 *
 * Third rather than folded in, for the same reason the debt block is second:
 * different question, different change rate, and a file holding one block and
 * not the others should keep what it has.
 */
export const WORKFLOW_BLOCK_START = '<!-- atlasmind:workflow:start -->';
export const WORKFLOW_BLOCK_END = '<!-- atlasmind:workflow:end -->';

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
const WORKFLOW_MARKERS = { start: WORKFLOW_BLOCK_START, end: WORKFLOW_BLOCK_END };

/** Where the testing block is rendered from. Mirrors `testingConfigLoader`. */
export const TESTING_CONFIG_SOURCE_PATH = 'project_memory/index/testing-config.json';

/**
 * The blocks a git hook can verify, and the document each is rendered from.
 *
 * The debt-markers block is **absent on purpose**. It is driven by the
 * `atlasmind.debt.markers` setting, and a hook has no way to read a VS Code
 * setting — so it cannot be checked, and listing it here would make the hook
 * report a file as stale forever. Reporting "checked" about something unchecked
 * is the worse error; see `instructionSyncCheck.ts`.
 */
export const CHECKED_INSTRUCTION_BLOCK_KINDS: readonly InstructionBlockKind[] = [
  {
    id: 'testing-protocols',
    label: 'Testing protocols',
    markers: TESTING_PROTOCOL_MARKERS,
    sourcePath: TESTING_CONFIG_SOURCE_PATH,
  },
  {
    id: 'workflow',
    label: 'GitHub workflow',
    markers: WORKFLOW_MARKERS,
    sourcePath: WORKFLOW_SSOT_PATH,
  },
];

/** Instruction files that could host a block. Shared with the hook's checker. */
export const INSTRUCTION_TARGET_PATHS: readonly string[] =
  MANAGED_MARKDOWN_TARGETS.map(target => target.path);

/**
 * Append the source digest to a block body.
 *
 * This is what makes the hook's check possible without re-rendering: the block
 * records the exact bytes it was rendered from, so "is this current?" becomes a
 * digest comparison rather than a reconstruction of extension state.
 */
function withSourceDigest(body: string, sourceText: string | undefined): string {
  if (sourceText === undefined) {
    return body;
  }
  return `${body}\n\n${formatSourceDigestComment(digestSource(sourceText))}`;
}

/** Read a source document's bytes, or undefined when it does not exist. */
function readSourceText(workspaceRoot: string, relativePath: string): string | undefined {
  const resolved = resolveRelativePath(workspaceRoot, relativePath);
  if (!resolved || !existsSync(resolved)) {
    return undefined;
  }
  try {
    return readFileSync(resolved, { encoding: 'utf8' });
  } catch {
    return undefined;
  }
}

/**
 * The workflow block body, for an external agent's instruction file.
 *
 * Returns `undefined` when no workflow has been declared, and the caller then
 * writes **no block at all** rather than an empty one. An empty block would
 * read as "this project has no workflow rules", which is a claim, and a false
 * one for a project that simply has not configured the feature yet.
 */
export function buildWorkflowMarkdown(input: WorkflowGuidanceInput | undefined): string | undefined {
  if (!input) {
    return undefined;
  }
  return [
    '## GitHub workflow (managed by AtlasMind)',
    '',
    '> Auto-generated from `project_memory/operations/workflow.json`. Do not edit by hand —',
    '> changes are overwritten on the next sync. Edit the workflow file, or the Workflow page.',
    '',
    buildWorkflowGuidance(input),
    '',
  ].join('\n');
}

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

/**
 * Gather the workflow guidance inputs from disk and settings.
 *
 * Lives here rather than in `workflowGuidance.ts` so the renderer stays pure,
 * and rather than inside `syncTestingProtocols` so that function keeps writing
 * only what it is handed. The three call sites all want the same thing, so they
 * share this instead of each assembling it slightly differently.
 *
 * Returns `undefined` when no workflow has been declared, which the writer
 * treats as "write no block" rather than "write an empty one".
 */
export function readWorkflowGuidanceInput(workspaceRoot: string): WorkflowGuidanceInput | undefined {
  const config = readWorkflowConfig(workspaceRoot);
  if (!config) {
    return undefined;
  }
  const settings = vscode.workspace.getConfiguration('atlasmind');
  return {
    config,
    ceiling: settings.get<WorkflowGuidanceInput['ceiling']>('workflow.maxAutomationLevel', 'observe'),
    masterEnabled: settings.get<boolean>('workflow.enabled', false),
  };
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
  /**
   * The declared workflow, or `undefined` where none exists.
   *
   * Injected for the same reason as everything above it: this module writes what
   * it is handed. Reading the workflow file here would make a file writer
   * depend on a filesystem layout its tests would then have to fake.
   */
  workflow?: WorkflowGuidanceInput,
): Promise<TestingProtocolSyncResult> {
  // Each block records a digest of the document it was rendered from, so a git
  // hook can tell whether it is current without reconstructing extension state.
  const blockBody = withSourceDigest(
    buildTestingProtocolsMarkdown(config, agents),
    readSourceText(workspaceRoot, TESTING_CONFIG_SOURCE_PATH),
  );
  const markerBody = buildDebtMarkerMarkdown(customMarkers);
  const renderedWorkflow = buildWorkflowMarkdown(workflow);
  const workflowBody = renderedWorkflow === undefined
    ? undefined
    : withSourceDigest(renderedWorkflow, readSourceText(workspaceRoot, WORKFLOW_SSOT_PATH));
  const updated: string[] = [];
  const skipped: { path: string; reason: string }[] = [];

  for (const target of MANAGED_MARKDOWN_TARGETS) {
    const resolved = resolveRelativePath(workspaceRoot, target.path);
    if (!resolved || !existsSync(resolved)) {
      continue; // Only sync to files that already exist (detected set).
    }
    try {
      const existing = readFileSync(resolved, { encoding: 'utf8' });
      // Three blocks, written in one pass. Each owns its own delimiters, so a
      // file carrying one and not the others keeps what it has.
      const withProtocols = upsertManagedBlock(existing, blockBody, TESTING_PROTOCOL_MARKERS);
      const withMarkers = upsertManagedBlock(withProtocols, markerBody, DEBT_MARKER_MARKERS);
      // No declared workflow means no block, not an empty one — see
      // `buildWorkflowMarkdown`. A file that already has the block keeps it
      // until a workflow exists to refresh it from.
      const next = workflowBody
        ? upsertManagedBlock(withMarkers, workflowBody, WORKFLOW_MARKERS)
        : withMarkers;
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
