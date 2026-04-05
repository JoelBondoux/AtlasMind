import * as vscode from 'vscode';

const STORAGE_KEY = 'atlasmind.chatSessions';
const MAX_STORED_SESSIONS = 30;
const DEFAULT_SESSION_TITLE = 'New Chat';

export interface SessionTranscriptEntry {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface SessionConversationRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  entries: SessionTranscriptEntry[];
}

export interface SessionConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  turnCount: number;
  preview: string;
  isActive: boolean;
}

type PersistedState = {
  activeSessionId: string;
  sessions: SessionConversationRecord[];
};

export class SessionConversation {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.onDidChangeEmitter.event;

  private sessions: SessionConversationRecord[];
  private activeSessionId: string;

  constructor(private readonly state?: Pick<vscode.Memento, 'get' | 'update'>) {
    const restored = this.restoreState();
    this.sessions = restored.sessions;
    this.activeSessionId = restored.activeSessionId;

    if (this.sessions.length === 0) {
      const session = createSessionRecord();
      this.sessions = [session];
      this.activeSessionId = session.id;
      this.persist();
    }
  }

  listSessions(): SessionConversationSummary[] {
    return this.sessions
      .slice()
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(session => ({
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        turnCount: Math.ceil(session.entries.length / 2),
        preview: buildPreview(session),
        isActive: session.id === this.activeSessionId,
      }));
  }

  getActiveSessionId(): string {
    return this.activeSessionId;
  }

  getActiveSession(): SessionConversationRecord {
    return this.getSession(this.activeSessionId) ?? this.ensureActiveSession();
  }

  getSession(sessionId: string): SessionConversationRecord | undefined {
    const session = this.sessions.find(item => item.id === sessionId);
    return session ? cloneSession(session) : undefined;
  }

  createSession(title?: string): string {
    const session = createSessionRecord(title?.trim());
    this.sessions.unshift(session);
    this.activeSessionId = session.id;
    this.pruneSessions();
    this.persist();
    this.onDidChangeEmitter.fire();
    return session.id;
  }

  selectSession(sessionId: string): boolean {
    if (!this.sessions.some(session => session.id === sessionId)) {
      return false;
    }

    this.activeSessionId = sessionId;
    this.persist();
    this.onDidChangeEmitter.fire();
    return true;
  }

  deleteSession(sessionId: string): void {
    if (this.sessions.length === 1) {
      this.clearSession(sessionId);
      return;
    }

    this.sessions = this.sessions.filter(session => session.id !== sessionId);
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = this.sessions[0]?.id ?? createSessionRecord().id;
    }
    if (this.sessions.length === 0) {
      const fallback = createSessionRecord();
      this.sessions = [fallback];
      this.activeSessionId = fallback.id;
    }
    this.persist();
    this.onDidChangeEmitter.fire();
  }

  clearSession(sessionId = this.activeSessionId): void {
    const session = this.getMutableSession(sessionId);
    if (!session) {
      return;
    }

    session.entries = [];
    session.title = DEFAULT_SESSION_TITLE;
    session.updatedAt = new Date().toISOString();
    this.persist();
    this.onDidChangeEmitter.fire();
  }

  getTranscript(sessionId = this.activeSessionId): SessionTranscriptEntry[] {
    return this.getSession(sessionId)?.entries ?? [];
  }

  appendMessage(
    role: 'user' | 'assistant',
    content: string,
    sessionId = this.activeSessionId,
  ): string {
    const session = this.getMutableSession(sessionId) ?? this.ensureActiveSession();
    const entry: SessionTranscriptEntry = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role,
      content,
      timestamp: new Date().toISOString(),
    };
    session.entries.push(entry);
    touchSession(session, content, role);
    this.persist();
    this.onDidChangeEmitter.fire();
    return entry.id;
  }

  updateMessage(entryId: string, content: string, sessionId = this.activeSessionId): void {
    const session = this.getMutableSession(sessionId);
    if (!session) {
      return;
    }

    const entry = session.entries.find(item => item.id === entryId);
    if (!entry) {
      return;
    }

    entry.content = content;
    touchSession(session, content, entry.role);
    this.persist();
    this.onDidChangeEmitter.fire();
  }

  recordTurn(user: string, assistant: string, sessionId = this.activeSessionId): void {
    const trimmedUser = user.trim();
    const trimmedAssistant = assistant.trim();
    if (!trimmedUser || !trimmedAssistant) {
      return;
    }

    this.appendMessage('user', trimmedUser, sessionId);
    this.appendMessage('assistant', trimmedAssistant, sessionId);
  }

  buildContext(options?: { maxTurns?: number; maxChars?: number; sessionId?: string }): string {
    const sessionId = options?.sessionId ?? this.activeSessionId;
    const entries = this.getTranscript(sessionId).filter(entry => entry.content.trim().length > 0);
    const maxTurns = normalizeLimit(options?.maxTurns, 6, 1, 20);
    const maxChars = normalizeLimit(options?.maxChars, 2500, 400, 12000);
    const selected = entries.slice(-(maxTurns * 2));
    if (selected.length === 0) {
      return '';
    }

    const blocks: string[] = [];
    let remainingChars = maxChars;

    for (const entry of selected.reverse()) {
      if (remainingChars <= 0) {
        break;
      }

      const block = `${entry.role === 'user' ? 'User' : 'Assistant'}: ${truncate(entry.content, entry.role === 'user' ? 500 : 700)}`;

      if (block.length > remainingChars) {
        blocks.push(truncate(block, remainingChars));
        break;
      }

      blocks.push(block);
      remainingChars -= block.length + 2;
    }

    return blocks.reverse().join('\n\n');
  }

  private ensureActiveSession(): SessionConversationRecord {
    const existing = this.getMutableSession(this.activeSessionId);
    if (existing) {
      return existing;
    }

    const session = createSessionRecord();
    this.sessions.unshift(session);
    this.activeSessionId = session.id;
    this.pruneSessions();
    this.persist();
    this.onDidChangeEmitter.fire();
    return session;
  }

  private getMutableSession(sessionId: string): SessionConversationRecord | undefined {
    return this.sessions.find(session => session.id === sessionId);
  }

  private restoreState(): PersistedState {
    const fallback = createSessionRecord();
    const raw = this.state?.get<unknown>(STORAGE_KEY);
    if (!isPersistedState(raw)) {
      return { activeSessionId: fallback.id, sessions: [fallback] };
    }

    const sessions = raw.sessions.map(cloneSession);
    if (sessions.length === 0) {
      return { activeSessionId: fallback.id, sessions: [fallback] };
    }

    const activeSessionId = sessions.some(session => session.id === raw.activeSessionId)
      ? raw.activeSessionId
      : sessions[0].id;
    return { activeSessionId, sessions };
  }

  private pruneSessions(): void {
    this.sessions = this.sessions
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, MAX_STORED_SESSIONS);
  }

  private persist(): void {
    void this.state?.update(STORAGE_KEY, {
      activeSessionId: this.activeSessionId,
      sessions: this.sessions.map(cloneSession),
    } satisfies PersistedState);
  }
}

function createSessionRecord(title?: string): SessionConversationRecord {
  const timestamp = new Date().toISOString();
  return {
    id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: title && title.length > 0 ? title : DEFAULT_SESSION_TITLE,
    createdAt: timestamp,
    updatedAt: timestamp,
    entries: [],
  };
}

function touchSession(session: SessionConversationRecord, content: string, role: 'user' | 'assistant'): void {
  session.updatedAt = new Date().toISOString();
  if (role === 'user' && session.title === DEFAULT_SESSION_TITLE && content.trim().length > 0) {
    session.title = truncate(content.trim(), 48);
  }
}

function buildPreview(session: SessionConversationRecord): string {
  const last = [...session.entries].reverse().find(entry => entry.content.trim().length > 0);
  if (!last) {
    return 'No messages yet';
  }
  return truncate(last.content.trim(), 72);
}

function cloneSession(session: SessionConversationRecord): SessionConversationRecord {
  return {
    ...session,
    entries: session.entries.map(entry => ({ ...entry })),
  };
}

function isPersistedState(value: unknown): value is PersistedState {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate['activeSessionId'] === 'string'
    && Array.isArray(candidate['sessions'])
    && candidate['sessions'].every(isSessionConversationRecord);
}

function isSessionConversationRecord(value: unknown): value is SessionConversationRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate['id'] === 'string'
    && typeof candidate['title'] === 'string'
    && typeof candidate['createdAt'] === 'string'
    && typeof candidate['updatedAt'] === 'string'
    && Array.isArray(candidate['entries'])
    && candidate['entries'].every(isSessionTranscriptEntry);
}

function isSessionTranscriptEntry(value: unknown): value is SessionTranscriptEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate['id'] === 'string'
    && (candidate['role'] === 'user' || candidate['role'] === 'assistant')
    && typeof candidate['content'] === 'string'
    && typeof candidate['timestamp'] === 'string';
}

function normalizeLimit(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  if (maxChars <= 1) {
    return value.slice(0, maxChars);
  }
  return value.slice(0, maxChars - 1) + '…';
}