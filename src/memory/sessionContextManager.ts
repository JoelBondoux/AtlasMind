import * as vscode from 'vscode';
import type { SessionContextBundle } from '../types.js';
import type { SessionTranscriptEntry } from '../chat/sessionConversation.js';

const SESSION_CONTEXT_MAX_CHARS = 4000;
const SSOT_EXCERPT_MAX_CHARS = 400;
const MAX_SSOT_EXCERPTS = 4;
const MAINTENANCE_TURNS_LOOKBACK = 3;

/** Folders in the main SSOT that are worth cross-referencing per session. */
const SSOT_CROSS_REF_FOLDERS = [
  'decisions',
  'misadventures',
  'architecture',
  'roadmap',
  'domain',
  'operations',
];

/** Inline completion function shape — matches what Orchestrator exposes for maintenance calls. */
export type MaintenanceCompleter = (systemPrompt: string, userPrompt: string) => Promise<string>;

const SESSION_CONTEXT_SYSTEM_PROMPT = [
  'You maintain the rolling session context file for an AI coding assistant.',
  'Produce an updated context.md as a single markdown document with these sections (omit any section that has no content):',
  '## Goal — the user\'s primary objective this session (1–3 sentences).',
  '## Approach — current technical strategy or plan (1–3 sentences).',
  '## Findings — key facts discovered: confirmed file paths, root causes, API shapes, constraints. Bullet list.',
  '## Concluded — completed fixes, confirmed diagnoses, applied changes. Bullet list. Only add genuinely new items.',
  '## Open Threads — unresolved questions and blocked tasks. Bullet list. Prefix resolved items with ~~ (strikethrough). Keep only last 2 resolved.',
  '## SSOT Links — relevant main SSOT file paths, one per line (e.g. decisions/use-vitest.md). Max 6 links.',
  '## Current State — what just happened in the most recent turn (1–3 sentences).',
  'Rules:',
  `- Total maximum: ${SESSION_CONTEXT_MAX_CHARS} characters.`,
  '- Compress older content aggressively when nearing the limit. Preserve recency over history.',
  '- Do NOT include timestamps, metadata, or preamble. Start directly with ## Goal.',
].join('\n');

/**
 * Manages per-session SSOT context under project_memory/sessions/<session-id>/.
 *
 * Each session folder contains:
 *   context.md        — unified session context, updated each turn (new format)
 *   ssot_links.md     — cited main SSOT entries relevant to this session
 *   transcript.jsonl  — append-only raw turns (source of truth)
 *
 * Legacy sessions (pre-context.md) are read transparently from the old 4-file format
 * (summary.md, decisions.md, open_threads.md) and migrated on next maintenance run.
 *
 * The maintenance pipeline runs fire-and-forget after each recordTurn call.
 * Errors are logged but never surface to the user.
 */
export class SessionContextManager {
  /** In-progress maintenance tasks keyed by sessionId — prevents concurrent runs per session. */
  private readonly activeMaintenance = new Map<string, Promise<void>>();
  /** Set once the SSOT root is known (after autoLoadWorkspaceSsot resolves). */
  private ssotRootUri: vscode.Uri | undefined;

  constructor(
    private readonly completer: MaintenanceCompleter,
  ) {}

  /** Called once the workspace SSOT root is resolved. */
  setSsotRoot(ssotRootUri: vscode.Uri): void {
    this.ssotRootUri = ssotRootUri;
  }

  /** The resolved SSOT root URI, if set. Used by external components that need the workspace SSOT path. */
  getSsotRoot(): vscode.Uri | undefined {
    return this.ssotRootUri;
  }

  private get rootUri(): vscode.Uri | undefined {
    return this.ssotRootUri ? vscode.Uri.joinPath(this.ssotRootUri, 'sessions') : undefined;
  }

  // ── Public API ──────────────────────────────────────────────────

  /**
   * Load the structured context bundle for a session.
   * Returns null if no session folder exists yet (caller falls back to legacy sessionContext string).
   * Transparently reads both new (context.md) and legacy (summary.md etc.) formats.
   */
  async loadContext(sessionId: string): Promise<SessionContextBundle | null> {
    if (!this.rootUri) {
      return null;
    }
    const dir = this.sessionDir(sessionId);

    // New unified format
    const contextMd = await this.readFile(dir, 'context.md');
    if (contextMd) {
      return this.parseContextBundle(contextMd, dir);
    }

    // Legacy 4-file format — read without migrating (migration happens on next maintainContext call)
    const [summary, decisions, openThreads, ssotLinks] = await Promise.all([
      this.readFile(dir, 'summary.md'),
      this.readFile(dir, 'decisions.md'),
      this.readFile(dir, 'open_threads.md'),
      this.readFile(dir, 'ssot_links.md'),
    ]);

    if (!summary && !decisions && !openThreads) {
      return null;
    }

    const ssotExcerpts = await this.loadSsotExcerpts(ssotLinks);

    return {
      summary: summary ?? '',
      decisions: decisions ?? '',
      openThreads: openThreads ?? '',
      ssotExcerpts,
      loadedAt: new Date().toISOString(),
    };
  }

  /**
   * Run the context maintenance pipeline after a completed turn.
   * Fire-and-forget — errors are caught and logged.
   * Skips if a maintenance run for this session is already in progress.
   */
  maintainContext(
    sessionId: string,
    allEntries: SessionTranscriptEntry[],
  ): void {
    if (!this.rootUri) {
      return;
    }
    if (this.activeMaintenance.has(sessionId)) {
      return;
    }
    const task = this.runMaintenance(sessionId, allEntries)
      .catch(err => {
        console.error(`[AtlasMind] SessionContextManager maintenance failed for session ${sessionId}:`, err);
      })
      .finally(() => {
        this.activeMaintenance.delete(sessionId);
      });
    this.activeMaintenance.set(sessionId, task);
  }

  /**
   * Bootstrap a session SSOT folder from an existing in-memory transcript.
   * Called lazily on first loadContext() when no folder exists yet.
   */
  async bootstrapFromTranscript(
    sessionId: string,
    entries: SessionTranscriptEntry[],
  ): Promise<void> {
    if (entries.length === 0) {
      return;
    }
    await this.runMaintenance(sessionId, entries);
  }

  /**
   * Append the latest turn to transcript.jsonl without running a full maintenance pass.
   * Used when the completer is not yet available (e.g. very early in activation).
   */
  async appendTurnToTranscript(
    sessionId: string,
    userContent: string,
    assistantContent: string,
  ): Promise<void> {
    if (!this.rootUri) {
      return;
    }
    const dir = this.sessionDir(sessionId);
    await this.ensureDir(dir);
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      user: userContent.slice(0, 2000),
      assistant: assistantContent.slice(0, 2000),
    }) + '\n';
    await this.appendFile(dir, 'transcript.jsonl', line);
  }

  /**
   * Delete the session SSOT folder when the session is deleted by the user.
   */
  async deleteSession(sessionId: string): Promise<void> {
    if (!this.rootUri) {
      return;
    }
    const dir = this.sessionDir(sessionId);
    try {
      await vscode.workspace.fs.delete(dir, { recursive: true, useTrash: false });
    } catch {
      // Already gone — fine.
    }
  }

  // ── Maintenance pipeline ────────────────────────────────────────

  private async runMaintenance(
    sessionId: string,
    allEntries: SessionTranscriptEntry[],
  ): Promise<void> {
    const dir = this.sessionDir(sessionId);
    await this.ensureDir(dir);

    const turns = this.extractTurns(allEntries);
    if (turns.length === 0) {
      return;
    }

    const recentTurns = turns.slice(-MAINTENANCE_TURNS_LOOKBACK);
    const recentText = recentTurns
      .map(t => `User: ${t.user}\nAssistant: ${t.assistant}`)
      .join('\n\n---\n\n');

    // Single read of the unified context document
    const currentContext = await this.readFile(dir, 'context.md') ?? '';

    const userPrompt = [
      currentContext
        ? `--- CURRENT CONTEXT ---\n${currentContext}\n--- END CONTEXT ---`
        : '(No existing context — this is the first turn.)',
      '',
      `--- RECENT TURNS ---\n${recentText}\n--- END TURNS ---`,
    ].join('\n');

    // Single LLM call instead of three
    let newContext = '';
    try {
      newContext = await this.completer(SESSION_CONTEXT_SYSTEM_PROMPT, userPrompt);
      newContext = newContext.slice(0, SESSION_CONTEXT_MAX_CHARS);
    } catch (err) {
      console.error('[AtlasMind] SessionContextManager maintenance completion failed:', err);
    }

    // Extract SSOT links from the new context for cross-referencing
    const ssotLinks = await this.findSsotLinks(newContext || currentContext);

    // Append the latest turn to transcript
    const lastTurn = recentTurns[recentTurns.length - 1];
    const transcriptLine = JSON.stringify({
      ts: new Date().toISOString(),
      user: lastTurn.user.slice(0, 2000),
      assistant: lastTurn.assistant.slice(0, 2000),
    }) + '\n';

    await Promise.all([
      newContext ? this.writeFile(dir, 'context.md', newContext) : Promise.resolve(),
      this.writeFile(dir, 'ssot_links.md', ssotLinks),
      this.appendFile(dir, 'transcript.jsonl', transcriptLine),
    ]);
  }

  // ── Context parsing ─────────────────────────────────────────────

  /**
   * Parse the unified context.md into a SessionContextBundle.
   * Maps ## Concluded → decisions, ## Open Threads → openThreads,
   * all other sections → summary. Loads SSOT excerpts from ssot_links.md.
   */
  private async parseContextBundle(
    contextMd: string,
    dir: vscode.Uri,
  ): Promise<SessionContextBundle> {
    const concluded = this.extractSection(contextMd, 'Concluded');
    const openThreads = this.extractSection(contextMd, 'Open Threads');
    const ssotLinks = this.extractSection(contextMd, 'SSOT Links');

    // Everything except Concluded and Open Threads forms the summary
    const summary = contextMd
      .replace(/^## Concluded[\s\S]*?(?=^## |\z)/m, '')
      .replace(/^## Open Threads[\s\S]*?(?=^## |\z)/m, '')
      .replace(/^## SSOT Links[\s\S]*?(?=^## |\z)/m, '')
      .trim();

    // Also try ssot_links.md for cross-references
    const ssotLinksFile = await this.readFile(dir, 'ssot_links.md');
    const combinedLinks = [ssotLinks, ssotLinksFile].filter(Boolean).join('\n');
    const ssotExcerpts = await this.loadSsotExcerpts(combinedLinks || null);

    return {
      summary,
      decisions: concluded,
      openThreads,
      ssotExcerpts,
      loadedAt: new Date().toISOString(),
    };
  }

  /** Extract the body of a named ## Section from markdown. Returns '' if absent. */
  private extractSection(markdown: string, sectionName: string): string {
    const pattern = new RegExp(
      `^## ${sectionName}\\s*\\n([\\s\\S]*?)(?=^## |\\z)`,
      'm',
    );
    return (pattern.exec(markdown)?.[1] ?? '').trim();
  }

  // ── SSOT helpers ─────────────────────────────────────────────────

  private async findSsotLinks(sessionContent: string): Promise<string> {
    if (!this.ssotRootUri || !sessionContent.trim()) {
      return '';
    }

    const lines: string[] = [];
    const sessionWords = new Set(
      sessionContent.toLowerCase().match(/\b\w{4,}\b/g) ?? [],
    );

    for (const folder of SSOT_CROSS_REF_FOLDERS) {
      const folderUri = vscode.Uri.joinPath(this.ssotRootUri, folder);
      let children: [string, vscode.FileType][];
      try {
        children = await vscode.workspace.fs.readDirectory(folderUri);
      } catch {
        continue;
      }

      for (const [name, type] of children) {
        if (type !== vscode.FileType.File || !name.endsWith('.md')) {
          continue;
        }
        const fileWords = name.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(' ').filter(w => w.length >= 4);
        const overlap = fileWords.filter(w => sessionWords.has(w)).length;
        if (overlap >= 1) {
          lines.push(`${folder}/${name}`);
        }
      }
    }

    return lines.slice(0, MAX_SSOT_EXCERPTS * 2).join('\n');
  }

  private async loadSsotExcerpts(ssotLinks: string | null): Promise<string[]> {
    if (!ssotLinks?.trim()) {
      return [];
    }
    const paths = ssotLinks.trim().split('\n').filter(Boolean).slice(0, MAX_SSOT_EXCERPTS);
    const excerpts: string[] = [];

    for (const relPath of paths) {
      if (!this.ssotRootUri) { break; }
      const fileUri = vscode.Uri.joinPath(this.ssotRootUri, relPath);
      try {
        const raw = await vscode.workspace.fs.readFile(fileUri);
        const text = Buffer.from(raw).toString('utf8').slice(0, SSOT_EXCERPT_MAX_CHARS);
        excerpts.push(`### ${relPath}\n${text}`);
      } catch {
        // File gone or unreadable — skip silently.
      }
    }

    return excerpts;
  }

  // ── Helpers ─────────────────────────────────────────────────────

  private sessionDir(sessionId: string): vscode.Uri {
    const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
    return vscode.Uri.joinPath(this.rootUri!, safe);
  }

  private async ensureDir(uri: vscode.Uri): Promise<void> {
    try {
      await vscode.workspace.fs.createDirectory(uri);
    } catch {
      // Already exists — fine.
    }
  }

  private async readFile(dir: vscode.Uri, name: string): Promise<string | null> {
    try {
      const raw = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, name));
      return Buffer.from(raw).toString('utf8');
    } catch {
      return null;
    }
  }

  private async writeFile(dir: vscode.Uri, name: string, content: string): Promise<void> {
    const uri = vscode.Uri.joinPath(dir, name);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
  }

  private async appendFile(dir: vscode.Uri, name: string, content: string): Promise<void> {
    const uri = vscode.Uri.joinPath(dir, name);
    let existing = '';
    try {
      const raw = await vscode.workspace.fs.readFile(uri);
      existing = Buffer.from(raw).toString('utf8');
    } catch {
      // New file — start empty.
    }
    await vscode.workspace.fs.writeFile(uri, Buffer.from(existing + content, 'utf8'));
  }

  private extractTurns(entries: SessionTranscriptEntry[]): Array<{ user: string; assistant: string }> {
    const turns: Array<{ user: string; assistant: string }> = [];
    let pendingUser: string | null = null;

    for (const entry of entries) {
      if (entry.role === 'user') {
        pendingUser = entry.content;
      } else if (entry.role === 'assistant' && pendingUser !== null) {
        turns.push({ user: pendingUser, assistant: entry.content });
        pendingUser = null;
      }
    }

    return turns;
  }
}
