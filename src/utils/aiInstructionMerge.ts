/**
 * Two-way AI instruction-set sync.
 *
 * The inbound flow (`aiInstructionSync.ts`) merges external tool instruction
 * files INTO a single AtlasMind memory file. This module performs the genuine
 * two-way reconciliation:
 *
 *   1. gather every detected tool's instructions + AtlasMind's own canonical
 *      instructions (personality profile + project soul + current sync file);
 *   2. (LLM) reconcile them into one unified directive set, auto-resolving
 *      trivial differences and flagging only genuinely contradictory rules as
 *      conflicts for the user to resolve in chat;
 *   3. (LLM) re-express the resolved unified set into each tool's native format
 *      and write it into an AtlasMind-managed, delimited block in each detected
 *      file (non-destructive, reversible — see `managedBlock.ts`);
 *   4. persist the unified set to AtlasMind's SSOT so it is loaded as context.
 *
 * Safety: only delimited managed blocks are written, only into files that
 * already exist, and all paths pass the shared traversal guard. Malformed LLM
 * output throws before anything is written — never a partial write.
 */

import { existsSync, readFileSync } from 'node:fs';
import * as vscode from 'vscode';
import {
  AI_INSTRUCTIONS_SYNC_REL_PATH,
  resolveRelativePath,
  scanAiInstructionFiles,
} from './aiInstructionSync.js';
import { MANAGED_BLOCK_START, MANAGED_BLOCK_END } from './testingProtocolSync.js';
import { stripManagedBlock, upsertManagedBlock, type ManagedBlockMarkers } from './managedBlock.js';

export const SHARED_INSTRUCTIONS_MARKERS: ManagedBlockMarkers = {
  start: '<!-- atlasmind:shared-instructions:start -->',
  end: '<!-- atlasmind:shared-instructions:end -->',
};

const TESTING_PROTOCOL_MARKERS: ManagedBlockMarkers = {
  start: MANAGED_BLOCK_START,
  end: MANAGED_BLOCK_END,
};

/** AtlasMind's own canonical instruction sources — its "voice" in the merge. */
const ATLASMIND_SOURCE_PATHS = [
  'project_memory/agents/atlas-personality-profile.md',
  'project_memory/project_soul.md',
];

/**
 * Markdown instruction files that can host the managed block, keyed by tool.
 * Mirrors `testingProtocolSync.ts` — these are the two-way writeback targets.
 */
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

/** JSON-config tools cannot host a markdown block — reported as skipped. */
const JSON_INSTRUCTION_TARGETS = ['.continue/config.json', '.continuerc.json'];

// ── Types ───────────────────────────────────────────────────────────────────

export interface InstructionSource {
  tool: string;
  relativePath: string;
  content: string;
}

export interface MergeDirective {
  id: string;
  category: string;
  text: string;
  /** Tool names that contributed this directive. */
  sources: string[];
}

export interface MergeAutoResolved {
  topic: string;
  note: string;
}

export interface MergeConflictOption {
  tool: string;
  directive: string;
}

export interface MergeConflict {
  id: string;
  topic: string;
  significant: boolean;
  options: MergeConflictOption[];
  recommendedOptionIndex: number;
}

export interface InstructionMergeResult {
  unified: MergeDirective[];
  autoResolved: MergeAutoResolved[];
  conflicts: MergeConflict[];
}

export interface InstructionWritebackResult {
  updated: string[];
  skipped: { path: string; reason: string }[];
}

/** Injected one-shot LLM call so this module stays unit-testable. */
export type CompleteFn = (systemPrompt: string, userPrompt: string) => Promise<string>;

// ── Gather ──────────────────────────────────────────────────────────────────

function readFullInstructionContent(workspaceRoot: string, relativePath: string): string | undefined {
  const resolved = resolveRelativePath(workspaceRoot, relativePath);
  if (!resolved || !existsSync(resolved)) {
    return undefined;
  }
  try {
    const raw = readFileSync(resolved, { encoding: 'utf8' });
    let content = raw;
    if (relativePath.endsWith('.json')) {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const msg = parsed['systemMessage'] ?? parsed['system'] ?? parsed['instructions'];
        if (typeof msg === 'string' && msg.trim().length > 0) {
          content = msg;
        }
      } catch {
        // Use raw content.
      }
    }
    // Drop AtlasMind-managed blocks so the merge never re-ingests its own mirror.
    content = stripManagedBlock(content, SHARED_INSTRUCTIONS_MARKERS);
    content = stripManagedBlock(content, TESTING_PROTOCOL_MARKERS);
    return content;
  } catch {
    return undefined;
  }
}

/**
 * Collect the full authored content of every detected tool instruction file,
 * plus AtlasMind's own canonical instructions, as labeled merge sources.
 */
export function gatherInstructionSources(workspaceRoot: string): InstructionSource[] {
  const sources: InstructionSource[] = [];
  const seen = new Set<string>();

  for (const entry of scanAiInstructionFiles(workspaceRoot)) {
    if (seen.has(entry.relativePath)) {
      continue;
    }
    const content = readFullInstructionContent(workspaceRoot, entry.relativePath);
    if (content && content.trim().length > 0) {
      sources.push({ tool: entry.tool, relativePath: entry.relativePath, content: content.trim() });
      seen.add(entry.relativePath);
    }
  }

  const atlasParts: string[] = [];
  for (const rel of ATLASMIND_SOURCE_PATHS) {
    const content = readFullInstructionContent(workspaceRoot, rel);
    if (content && content.trim().length > 0) {
      atlasParts.push(`# ${rel}\n\n${content.trim()}`);
    }
  }
  if (atlasParts.length > 0) {
    sources.push({
      tool: 'AtlasMind',
      relativePath: ATLASMIND_SOURCE_PATHS[0]!,
      content: atlasParts.join('\n\n'),
    });
  }

  return sources;
}

/** Tools with a detected, writeable markdown instruction file. */
export function detectedWritebackTools(workspaceRoot: string): string[] {
  const tools: string[] = [];
  for (const target of MANAGED_MARKDOWN_TARGETS) {
    const resolved = resolveRelativePath(workspaceRoot, target.path);
    if (resolved && existsSync(resolved) && !tools.includes(target.tool)) {
      tools.push(target.tool);
    }
  }
  return tools;
}

// ── Merge (LLM) ─────────────────────────────────────────────────────────────

export function buildMergeSystemPrompt(): string {
  return [
    'You reconcile AI coding-assistant instruction sets into ONE unified set.',
    'You are given several instruction sets, each authored for a different tool.',
    'Produce a single superset of directives so every tool LEARNS from the others.',
    'Rules:',
    '- Deduplicate directives that mean the same thing; record every contributing tool in "sources".',
    '- Merge compatible or trivially-different directives silently and summarise them under "autoResolved".',
    '- Record a "conflict" ONLY when two directives are genuinely contradictory AND the difference is',
    '  material (e.g. tabs vs spaces, mutually exclusive commit conventions). Set significant=true and',
    '  list each competing option with its tool. Wording differences are NOT conflicts.',
    '- Never invent a directive that no source implies.',
    'Return ONLY a JSON object (no prose, no markdown code fences) with exactly this shape:',
    '{',
    '  "unified": [ { "id": string, "category": string, "text": string, "sources": string[] } ],',
    '  "autoResolved": [ { "topic": string, "note": string } ],',
    '  "conflicts": [ { "id": string, "topic": string, "significant": boolean,',
    '                   "options": [ { "tool": string, "directive": string } ],',
    '                   "recommendedOptionIndex": number } ]',
    '}',
  ].join('\n');
}

export function buildMergeUserPrompt(sources: InstructionSource[]): string {
  const blocks = sources.map(source => `=== ${source.tool} (${source.relativePath}) ===\n${source.content}`);
  return `Instruction sets to reconcile:\n\n${blocks.join('\n\n')}`;
}

export function parseMergeResult(raw: string): InstructionMergeResult {
  const json = extractJsonObject(raw);
  if (!json) {
    throw new Error('The merge model did not return valid JSON.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('The merge model returned malformed JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('The merge response was not a JSON object.');
  }
  const record = parsed as Record<string, unknown>;
  const unified = normalizeDirectives(record['unified']);
  const autoResolved = normalizeAutoResolved(record['autoResolved']);
  const conflicts = normalizeConflicts(record['conflicts']);
  if (unified.length === 0 && conflicts.length === 0) {
    throw new Error('The merge response contained no directives or conflicts.');
  }
  return { unified, autoResolved, conflicts };
}

export async function runInstructionMerge(
  sources: InstructionSource[],
  complete: CompleteFn,
): Promise<InstructionMergeResult> {
  if (sources.length === 0) {
    throw new Error('No instruction sources were found to reconcile.');
  }
  const raw = await complete(buildMergeSystemPrompt(), buildMergeUserPrompt(sources));
  if (!raw || raw.trim().length === 0) {
    throw new Error('The merge model returned no output.');
  }
  return parseMergeResult(raw);
}

// ── Render (LLM, with deterministic fallback) ────────────────────────────────

export function buildRenderSystemPrompt(): string {
  return [
    'You render a unified set of project AI-instructions into per-tool instruction blocks.',
    'Every block must convey THE SAME directives, but phrased and formatted appropriately for that tool.',
    'Use concise markdown (headings + bullets). Do not add a top-level title naming the tool.',
    'Return ONLY a JSON object mapping each tool name to its markdown block, for example:',
    '{ "Claude Code": "## ...", "GitHub Copilot": "## ..." }',
    'No prose and no markdown code fences around the JSON.',
  ].join('\n');
}

export function buildRenderUserPrompt(unified: MergeDirective[], targetTools: string[]): string {
  const directiveLines = unified.map(directive => `- (${directive.category}) ${directive.text}`).join('\n');
  return `Unified directives:\n${directiveLines}\n\nProduce one block for each of these tools: ${targetTools.join(', ')}.`;
}

export function parseRenderResult(raw: string, targetTools: string[]): Record<string, string> {
  const json = extractJsonObject(raw);
  if (!json) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return {};
  }
  const record = parsed as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const tool of targetTools) {
    const value = record[tool];
    if (typeof value === 'string' && value.trim().length > 0) {
      out[tool] = value.trim();
    }
  }
  return out;
}

export async function runInstructionRender(
  unified: MergeDirective[],
  targetTools: string[],
  complete: CompleteFn,
): Promise<Record<string, string>> {
  if (targetTools.length === 0 || unified.length === 0) {
    return {};
  }
  try {
    const raw = await complete(buildRenderSystemPrompt(), buildRenderUserPrompt(unified, targetTools));
    return parseRenderResult(raw, targetTools);
  } catch {
    // Deterministic fallback is applied per-tool in applyManagedInstructionBlock.
    return {};
  }
}

/**
 * Deterministic markdown rendering of the unified directive set. Used as the
 * per-tool fallback when the render model omits a tool, and as the body of the
 * SSOT mirror file.
 */
export function renderUnifiedMarkdown(unified: MergeDirective[]): string {
  const lines: string[] = [
    '## Shared Project Instructions (managed by AtlasMind)',
    '',
    '> Unified across all detected AI assistants. Re-run AtlasMind → Settings → AI Instructions →',
    '> "Align all instruction sets" to refresh. Content inside this block is overwritten on each sync.',
    '',
  ];
  const byCategory = new Map<string, string[]>();
  for (const directive of unified) {
    const category = directive.category || 'General';
    const bucket = byCategory.get(category);
    if (bucket) {
      bucket.push(directive.text);
    } else {
      byCategory.set(category, [directive.text]);
    }
  }
  for (const [category, items] of byCategory) {
    lines.push(`### ${category}`, '');
    for (const item of items) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

// ── Writeback ────────────────────────────────────────────────────────────────

/**
 * Write the rendered shared-instructions block into every detected markdown
 * instruction file (managed block only). JSON-config tools are reported as
 * skipped. Non-destructive: content outside the managed block is preserved.
 */
export async function applyManagedInstructionBlock(
  workspaceRoot: string,
  renderedByTool: Record<string, string>,
  unified: MergeDirective[],
): Promise<InstructionWritebackResult> {
  const fallback = renderUnifiedMarkdown(unified);
  const updated: string[] = [];
  const skipped: { path: string; reason: string }[] = [];

  for (const target of MANAGED_MARKDOWN_TARGETS) {
    const resolved = resolveRelativePath(workspaceRoot, target.path);
    if (!resolved || !existsSync(resolved)) {
      continue; // Detected set only.
    }
    const body = renderedByTool[target.tool] ?? fallback;
    try {
      const existing = readFileSync(resolved, { encoding: 'utf8' });
      const next = upsertManagedBlock(existing, body, SHARED_INSTRUCTIONS_MARKERS);
      if (next !== existing) {
        await vscode.workspace.fs.writeFile(vscode.Uri.file(resolved), Buffer.from(next, 'utf8'));
      }
      updated.push(target.path);
    } catch (err) {
      skipped.push({ path: target.path, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  for (const jsonTarget of JSON_INSTRUCTION_TARGETS) {
    const resolved = resolveRelativePath(workspaceRoot, jsonTarget);
    if (resolved && existsSync(resolved)) {
      skipped.push({
        path: jsonTarget,
        reason: 'JSON config — cannot embed a markdown block; align this tool manually.',
      });
    }
  }

  return { updated, skipped };
}

/**
 * Persist the unified directive set to AtlasMind's SSOT so the MemoryManager
 * loads it as workspace `domain` context. Returns false on write failure.
 */
export async function writeUnifiedToSsot(workspaceRoot: string, unified: MergeDirective[], isoDate: string): Promise<boolean> {
  const resolved = resolveRelativePath(workspaceRoot, AI_INSTRUCTIONS_SYNC_REL_PATH);
  if (!resolved) {
    return false;
  }
  const content = [
    '# AI Instructions (unified)',
    '',
    `> Two-way synced on ${isoDate}. Reconciled superset across all detected AI assistants.`,
    '> AtlasMind mirrors this set into each tool\'s instruction file inside a managed block.',
    '',
    renderUnifiedMarkdown(unified),
    '',
  ].join('\n');
  try {
    await vscode.workspace.fs.writeFile(vscode.Uri.file(resolved), Buffer.from(content, 'utf8'));
    return true;
  } catch {
    return false;
  }
}

// ── JSON parsing helpers ─────────────────────────────────────────────────────

function extractJsonObject(raw: string): string | undefined {
  if (!raw) {
    return undefined;
  }
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidate = fence?.[1] ?? raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return undefined;
  }
  return candidate.slice(start, end + 1);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function normalizeDirectives(value: unknown): MergeDirective[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: MergeDirective[] = [];
  value.forEach((item, index) => {
    if (typeof item !== 'object' || item === null) {
      return;
    }
    const record = item as Record<string, unknown>;
    const text = asString(record['text']).trim();
    if (!text) {
      return;
    }
    const sources = Array.isArray(record['sources'])
      ? record['sources'].filter((s): s is string => typeof s === 'string')
      : [];
    out.push({
      id: asString(record['id']).trim() || `d${index + 1}`,
      category: asString(record['category']).trim() || 'General',
      text,
      sources,
    });
  });
  return out;
}

function normalizeAutoResolved(value: unknown): MergeAutoResolved[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: MergeAutoResolved[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const topic = asString(record['topic']).trim();
    const note = asString(record['note']).trim();
    if (topic || note) {
      out.push({ topic: topic || 'difference', note });
    }
  }
  return out;
}

function normalizeConflicts(value: unknown): MergeConflict[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: MergeConflict[] = [];
  value.forEach((item, index) => {
    if (typeof item !== 'object' || item === null) {
      return;
    }
    const record = item as Record<string, unknown>;
    const options = Array.isArray(record['options'])
      ? record['options']
          .map(option => {
            if (typeof option !== 'object' || option === null) {
              return undefined;
            }
            const optionRecord = option as Record<string, unknown>;
            const directive = asString(optionRecord['directive']).trim();
            if (!directive) {
              return undefined;
            }
            return { tool: asString(optionRecord['tool']).trim() || 'Unknown', directive };
          })
          .filter((option): option is MergeConflictOption => option !== undefined)
      : [];
    // A real conflict needs at least two competing options.
    if (options.length < 2) {
      return;
    }
    // Only surface significant conflicts; the rest are auto-resolved upstream.
    if (record['significant'] === false) {
      return;
    }
    const recRaw = typeof record['recommendedOptionIndex'] === 'number' ? record['recommendedOptionIndex'] : 0;
    const recommendedOptionIndex = Math.max(0, Math.min(options.length - 1, Math.round(recRaw)));
    out.push({
      id: asString(record['id']).trim() || `c${index + 1}`,
      topic: asString(record['topic']).trim() || 'Conflicting instruction',
      significant: true,
      options,
      recommendedOptionIndex,
    });
  });
  return out;
}
