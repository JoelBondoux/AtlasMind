import * as vscode from 'vscode';
import type { SessionContextBundle } from '../types.js';
import type { SessionTranscriptEntry } from '../chat/sessionConversation.js';

const SESSION_SUMMARY_MAX_CHARS = 2000;
const SESSION_DECISIONS_MAX_CHARS = 1500;
const SESSION_OPEN_THREADS_MAX_CHARS = 800;
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

/**
 * Manages per-session SSOT context under project_memory/sessions/<session-id>/.
 *
 * Each session folder contains:
 *   summary.md        — rolling compressed summary, updated each turn
 *   decisions.md      — concluded facts, fixes applied, diagnoses confirmed
 *   open_threads.md   — unresolved questions / incomplete tasks
 *   ssot_links.md     — cited main SSOT entries relevant to this session
 *   transcript.jsonl  — append-only raw turns (source of truth)
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

  private get rootUri(): vscode.Uri | undefined {
    return this.ssotRootUri ? vscode.Uri.joinPath(this.ssotRootUri, 'sessions') : undefined;
  }

  // ── Public API ──────────────────────────────────────────────────

  /**
   * Load the structured context bundle for a session.
   * Returns null if no session folder exists yet (caller falls back to legacy sessionContext string).
   */
  async loadContext(sessionId: string): Promise<SessionContextBundle | null> {
    if (!this.rootUri) {
      return null;
    }
    const dir = this.sessionDir(sessionId);
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

    const [currentSummary, currentDecisions, currentOpenThreads] = await Promise.all([
      this.readFile(dir, 'summary.md'),
      this.readFile(dir, 'decisions.md'),
      this.readFile(dir, 'open_threads.md'),
    ]);

    // Run all three maintenance model calls in parallel
    const [newSummary, newDecisions, newOpenThreads] = await Promise.all([
      this.updateSummary(currentSummary ?? '', recentText),
      this.updateDecisions(currentDecisions ?? '', recentText),
      this.updateOpenThreads(currentOpenThreads ?? '', recentText),
    ]);

    // Find relevant main SSOT entries based on the new summary
    const ssotLinks = await this.findSsotLinks(newSummary + '\n' + newDecisions);

    // Append the latest turn to transcript
    const lastTurn = recentTurns[recentTurns.length - 1];
    const transcriptLine = JSON.stringify({
      ts: new Date().toISOString(),
      user: lastTurn.user.slice(0, 2000),
      assistant: lastTurn.assistant.slice(0, 2000),
    }) + '\n';

    await Promise.all([
      this.writeFile(dir, 'summary.md', newSummary),
      this.writeFile(dir, 'decisions.md', newDecisions),
      this.writeFile(dir, 'open_threads.md', newOpenThreads),
      this.writeFile(dir, 'ssot_links.md', ssotLinks),
      this.appendFile(dir, 'transcript.jsonl', transcriptLine),
    ]);
  }

  private async updateSummary(current: string, recentText: string): Promise<string> {
    const systemPrompt = [
      'You maintain a rolling session summary for an AI coding assistant.',
      'You will receive the current summary (may be empty for a new session) and the most recent conversation turns.',
      'Produce an updated summary as a concise markdown document.',
      'Rules:',
      '- Maximum ' + SESSION_SUMMARY_MAX_CHARS + ' characters.',
      '- Keep the most important context: the user\'s goal, the current approach, key findings, and the most recent state.',
      '- Compress older content aggressively when nearing the limit — preserve recency and conclusions over history.',
      '- Track topic drift: if the conversation has shifted focus, de-weight older unrelated content.',
      '- Do NOT include timestamps, metadata, or preamble. Start directly with content.',
      '- Use short markdown sections: ## Goal, ## Approach, ## Findings, ## Current State.',
    ].join('\n');

    const userPrompt = [
      current ? `--- CURRENT SUMMARY ---\n${current}\n--- END SUMMARY ---` : '(No existing summary — this is the first turn.)',
      '',
      `--- RECENT TURNS ---\n${recentText}\n--- END TURNS ---`,
    ].join('\n');

    const result = await this.safeComplete(systemPrompt, userPrompt);
    return result.slice(0, SESSION_SUMMARY_MAX_CHARS);
  }

  private async updateDecisions(current: string, recentText: string): Promise<string> {
    const systemPrompt = [
      'You extract and maintain a decisions log for an AI coding assistant session.',
      'You will receive the current decisions log and the most recent conversation turns.',
      'Extract any NEW conclusions, confirmed diagnoses, fixes applied, or design decisions from the recent turns.',
      'Rules:',
      '- Maximum ' + SESSION_DECISIONS_MAX_CHARS + ' characters.',
      '- Only add genuinely new information — do not duplicate existing entries.',
      '- Format: bullet list, each item starting with the date-independent fact.',
      '- Examples: "Root cause: CSS media query at 920px incorrectly collapses nav on desktop.", "Fix applied: raised breakpoint to 768px in settingsPanel.ts:480."',
      '- If no new conclusions exist in the recent turns, return the current log unchanged.',
      '- Do NOT include timestamps or preamble.',
    ].join('\n');

    const userPrompt = [
      current ? `--- CURRENT DECISIONS ---\n${current}\n--- END DECISIONS ---` : '(No existing decisions.)',
      '',
      `--- RECENT TURNS ---\n${recentText}\n--- END TURNS ---`,
    ].join('\n');

    const result = await this.safeComplete(systemPrompt, userPrompt);
    return result.slice(0, SESSION_DECISIONS_MAX_CHARS);
  }

  private async updateOpenThreads(current: string, recentText: string): Promise<string> {
    const systemPrompt = [
      'You track open questions and incomplete tasks for an AI coding assistant session.',
      'You will receive the current open threads and the most recent conversation turns.',
      'Update the list: mark items resolved if addressed in recent turns, add new unresolved questions or tasks.',
      'Rules:',
      '- Maximum ' + SESSION_OPEN_THREADS_MAX_CHARS + ' characters.',
      '- Format: bullet list. Prefix resolved items with "~~" (strikethrough).',
      '- Only keep the last 2 resolved items for context; remove older resolved items.',
      '- If nothing changed, return the current list unchanged.',
      '- Do NOT include timestamps or preamble.',
    ].join('\n');

    const userPrompt = [
      current ? `--- CURRENT THREADS ---\n${current}\n--- END THREADS ---` : '(No existing threads.)',
      '',
      `--- RECENT TURNS ---\n${recentText}\n--- END TURNS ---`,
    ].join('\n');

    const result = await this.safeComplete(systemPrompt, userPrompt);
    return result.slice(0, SESSION_OPEN_THREADS_MAX_CHARS);
  }

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
        // Simple relevance: count word overlaps between session content and filename/path
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
    // Sanitize sessionId to prevent path traversal
    const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
    // rootUri is always defined when this is called (callers guard against undefined)
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

  private async safeComplete(systemPrompt: string, userPrompt: string): Promise<string> {
    try {
      return await this.completer(systemPrompt, userPrompt);
    } catch (err) {
      console.error('[AtlasMind] SessionContextManager maintenance completion failed:', err);
      return '';
    }
  }
}
