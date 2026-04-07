import * as vscode from 'vscode';

const STORAGE_KEY = 'atlasmind.chatSessions';
const MAX_STORED_SESSIONS = 30;
const DEFAULT_SESSION_TITLE = 'New Chat';

export interface SessionTranscriptEntry {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  meta?: SessionTranscriptMetadata;
}

export interface SessionThoughtSummary {
  label: string;
  summary: string;
  bullets: string[];
  status?: 'verified' | 'blocked' | 'missing' | 'not-applicable';
  statusLabel?: string;
}

export interface SessionPolicySnapshot {
  source: 'runtime' | 'personality' | 'safety' | 'project-soul';
  label: string;
  summary: string;
}

export type SessionSuggestedFollowupMode = 'send' | 'steer' | 'new-chat' | 'new-session';

export interface SessionSuggestedFollowup {
  label: string;
  prompt: string;
  mode?: SessionSuggestedFollowupMode;
}

export type SessionAssistantVote = 'up' | 'down';

export interface SessionTranscriptMetadata {
  modelUsed?: string;
  thoughtSummary?: SessionThoughtSummary;
  policies?: SessionPolicySnapshot[];
  followupQuestion?: string;
  suggestedFollowups?: SessionSuggestedFollowup[];
  userVote?: SessionAssistantVote;
  votedAt?: string;
}

export interface SessionConversationRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  folderId?: string;
  entries: SessionTranscriptEntry[];
}

export interface SessionFolderRecord {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  folderId?: string;
  turnCount: number;
  preview: string;
  isActive: boolean;
  isArchived: boolean;
}

export interface SessionFolderSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  sessionCount: number;
}

type SessionModelFeedbackSummary = Record<string, { upVotes: number; downVotes: number }>;

type PersistedState = {
  activeSessionId: string;
  sessions: SessionConversationRecord[];
  folders: SessionFolderRecord[];
};

export class SessionConversation {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.onDidChangeEmitter.event;

  private sessions: SessionConversationRecord[];
  private folders: SessionFolderRecord[];
  private activeSessionId: string;

  constructor(private readonly state?: Pick<vscode.Memento, 'get' | 'update'>) {
    const restored = this.restoreState();
    this.sessions = restored.sessions;
    this.folders = restored.folders;
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
      .filter(session => !session.archivedAt)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(session => ({
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        ...(session.folderId ? { folderId: session.folderId } : {}),
        turnCount: Math.ceil(session.entries.length / 2),
        preview: buildPreview(session),
        isActive: session.id === this.activeSessionId,
        isArchived: false,
      }));
  }

  listArchivedSessions(): SessionConversationSummary[] {
    return this.sessions
      .slice()
      .filter(session => Boolean(session.archivedAt))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(session => ({
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        ...(session.archivedAt ? { archivedAt: session.archivedAt } : {}),
        ...(session.folderId ? { folderId: session.folderId } : {}),
        turnCount: Math.ceil(session.entries.length / 2),
        preview: buildPreview(session),
        isActive: session.id === this.activeSessionId,
        isArchived: true,
      }));
  }

  listFolders(): SessionFolderSummary[] {
    return this.folders
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(folder => ({
        id: folder.id,
        name: folder.name,
        createdAt: folder.createdAt,
        updatedAt: folder.updatedAt,
        sessionCount: this.sessions.filter(session => !session.archivedAt && session.folderId === folder.id).length,
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

  renameSession(sessionId: string, title: string): boolean {
    const session = this.getMutableSession(sessionId);
    const nextTitle = normalizeSessionTitle(title);
    if (!session || !nextTitle || session.title === nextTitle) {
      return false;
    }

    session.title = nextTitle;
    session.updatedAt = new Date().toISOString();
    this.persist();
    this.onDidChangeEmitter.fire();
    return true;
  }

  createFolder(name: string): string | undefined {
    const normalizedName = normalizeFolderName(name);
    if (!normalizedName) {
      return undefined;
    }

    const existing = this.folders.find(folder => folder.name.localeCompare(normalizedName, undefined, { sensitivity: 'accent' }) === 0);
    if (existing) {
      return existing.id;
    }

    const folder = createSessionFolderRecord(normalizedName);
    this.folders.push(folder);
    this.persist();
    this.onDidChangeEmitter.fire();
    return folder.id;
  }

  assignSessionToFolder(sessionId: string, folderId: string | undefined): boolean {
    const session = this.getMutableSession(sessionId);
    if (!session) {
      return false;
    }

    const normalizedFolderId = typeof folderId === 'string' && folderId.trim().length > 0 ? folderId.trim() : undefined;
    if (normalizedFolderId && !this.folders.some(folder => folder.id === normalizedFolderId)) {
      return false;
    }
    if (session.folderId === normalizedFolderId) {
      return false;
    }

    session.folderId = normalizedFolderId;
    session.updatedAt = new Date().toISOString();
    if (normalizedFolderId) {
      touchFolder(normalizedFolderId, this.folders);
    }
    this.persist();
    this.onDidChangeEmitter.fire();
    return true;
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

  archiveSession(sessionId: string): boolean {
    const session = this.getMutableSession(sessionId);
    if (!session || session.archivedAt) {
      return false;
    }

    const timestamp = new Date().toISOString();
    session.archivedAt = timestamp;
    session.updatedAt = timestamp;

    if (this.activeSessionId === sessionId) {
      const nextActive = this.sessions
        .filter(candidate => candidate.id !== sessionId && !candidate.archivedAt)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];

      if (nextActive) {
        this.activeSessionId = nextActive.id;
      } else {
        const fallback = createSessionRecord();
        this.sessions.unshift(fallback);
        this.activeSessionId = fallback.id;
        this.pruneSessions();
      }
    }

    this.persist();
    this.onDidChangeEmitter.fire();
    return true;
  }

  unarchiveSession(sessionId: string): boolean {
    const session = this.getMutableSession(sessionId);
    if (!session || !session.archivedAt) {
      return false;
    }

    delete session.archivedAt;
    session.updatedAt = new Date().toISOString();
    this.persist();
    this.onDidChangeEmitter.fire();
    return true;
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
    meta?: SessionTranscriptMetadata,
  ): string {
    const session = this.resolveTargetSession(sessionId);
    const entry: SessionTranscriptEntry = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role,
      content,
      timestamp: new Date().toISOString(),
      ...(meta ? { meta: cloneMetadata(meta) } : {}),
    };
    session.entries.push(entry);
    touchSession(session, content, role);
    this.persist();
    this.onDidChangeEmitter.fire();
    return entry.id;
  }

  updateMessage(
    entryId: string,
    content: string,
    sessionId = this.activeSessionId,
    meta?: SessionTranscriptMetadata,
  ): void {
    const session = this.getMutableSession(sessionId);
    if (!session) {
      return;
    }

    const entry = session.entries.find(item => item.id === entryId);
    if (!entry) {
      return;
    }

    entry.content = content;
    if (meta) {
      entry.meta = cloneMetadata(meta);
    }
    touchSession(session, content, entry.role);
    this.persist();
    this.onDidChangeEmitter.fire();
  }

  recordTurn(
    user: string,
    assistant: string,
    sessionId = this.activeSessionId,
    assistantMeta?: SessionTranscriptMetadata,
  ): void {
    const trimmedUser = user.trim();
    const trimmedAssistant = assistant.trim();
    if (!trimmedUser) {
      console.warn('[AtlasMind] Skipping transcript write because the user message was empty.');
      return;
    }
    if (!trimmedAssistant) {
      console.warn('[AtlasMind] Skipping transcript write because the assistant response was empty.');
      return;
    }

    this.appendMessage('user', trimmedUser, sessionId);
    this.appendMessage('assistant', trimmedAssistant, sessionId, assistantMeta);
  }

  setAssistantVote(
    entryId: string,
    vote: SessionAssistantVote | undefined,
    sessionId = this.activeSessionId,
  ): boolean {
    const session = this.getMutableSession(sessionId);
    if (!session) {
      return false;
    }

    const entry = session.entries.find(item => item.id === entryId);
    if (!entry || entry.role !== 'assistant') {
      return false;
    }

    const currentVote = entry.meta?.userVote;
    if (currentVote === vote) {
      return false;
    }

    entry.meta = entry.meta ? cloneMetadata(entry.meta) : {};
    if (vote) {
      entry.meta.userVote = vote;
      entry.meta.votedAt = new Date().toISOString();
    } else {
      delete entry.meta.userVote;
      delete entry.meta.votedAt;
    }

    touchSession(session, entry.content, entry.role);
    this.persist();
    this.onDidChangeEmitter.fire();
    return true;
  }

  getModelFeedbackSummary(): SessionModelFeedbackSummary {
    const summary: SessionModelFeedbackSummary = {};

    for (const session of this.sessions) {
      for (const entry of session.entries) {
        if (entry.role !== 'assistant' || !entry.meta?.modelUsed || !entry.meta.userVote) {
          continue;
        }

        const bucket = summary[entry.meta.modelUsed] ?? { upVotes: 0, downVotes: 0 };
        if (entry.meta.userVote === 'up') {
          bucket.upVotes += 1;
        } else {
          bucket.downVotes += 1;
        }
        summary[entry.meta.modelUsed] = bucket;
      }
    }

    return summary;
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
    const policies = [...selected]
      .reverse()
      .find(entry => entry.role === 'assistant' && entry.meta?.policies?.length)?.meta?.policies;
    let remainingChars = maxChars;

    if (policies && policies.length > 0) {
      const policyBlock = [
        'Follow-up policy in force:',
        ...policies.map(policy => `- [${policy.source}] ${policy.label}: ${policy.summary}`),
      ].join('\n');

      if (policyBlock.length > remainingChars) {
        blocks.push(truncate(policyBlock, remainingChars));
        return blocks.join('\n\n');
      }

      blocks.push(policyBlock);
      remainingChars -= policyBlock.length + 2;
    }

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

  private resolveTargetSession(sessionId: string): SessionConversationRecord {
    const existing = this.getMutableSession(sessionId);
    if (existing) {
      return existing;
    }

    if (sessionId !== this.activeSessionId) {
      console.warn(`[AtlasMind] Chat session "${sessionId}" was not found. Falling back to the active session.`);
    }

    return this.ensureActiveSession();
  }

  private getMutableSession(sessionId: string): SessionConversationRecord | undefined {
    return this.sessions.find(session => session.id === sessionId);
  }

  private restoreState(): PersistedState {
    const fallback = createSessionRecord();
    const raw = this.state?.get<unknown>(STORAGE_KEY);
    if (!isPersistedState(raw)) {
      return { activeSessionId: fallback.id, sessions: [fallback], folders: [] };
    }

    const folders = Array.isArray(raw.folders)
      ? raw.folders.map(cloneFolder)
      : [];
    const sessions = raw.sessions.map(cloneSession);
    for (const session of sessions) {
      if (session.folderId && !folders.some(folder => folder.id === session.folderId)) {
        delete session.folderId;
      }
    }
    if (sessions.length === 0) {
      return { activeSessionId: fallback.id, sessions: [fallback], folders };
    }

    const activeSessionId = sessions.some(session => session.id === raw.activeSessionId)
      ? raw.activeSessionId
      : sessions[0].id;
    return { activeSessionId, sessions, folders };
  }

  private pruneSessions(): void {
    this.sessions = this.sessions
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, MAX_STORED_SESSIONS);
  }

  private persist(): void {
    const pendingWrite = this.state?.update(STORAGE_KEY, {
      activeSessionId: this.activeSessionId,
      sessions: this.sessions.map(cloneSession),
      folders: this.folders.map(cloneFolder),
    } satisfies PersistedState);

    if (pendingWrite) {
      void Promise.resolve(pendingWrite).catch(error => {
        console.error('[AtlasMind] Failed to persist chat sessions.', error);
      });
    }
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

function createSessionFolderRecord(name: string): SessionFolderRecord {
  const timestamp = new Date().toISOString();
  return {
    id: `folder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function touchSession(session: SessionConversationRecord, content: string, role: 'user' | 'assistant'): void {
  session.updatedAt = new Date().toISOString();
  if (role === 'user' && session.title === DEFAULT_SESSION_TITLE && content.trim().length > 0) {
    session.title = truncate(content.trim(), 48);
  }
}

function touchFolder(folderId: string, folders: SessionFolderRecord[]): void {
  const folder = folders.find(candidate => candidate.id === folderId);
  if (folder) {
    folder.updatedAt = new Date().toISOString();
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
    entries: session.entries.map(entry => ({
      ...entry,
      ...(entry.meta ? { meta: cloneMetadata(entry.meta) } : {}),
    })),
  };
}

function cloneFolder(folder: SessionFolderRecord): SessionFolderRecord {
  return { ...folder };
}

function cloneMetadata(metadata: SessionTranscriptMetadata): SessionTranscriptMetadata {
  return {
    ...metadata,
    ...(metadata.policies
      ? {
        policies: metadata.policies.map(policy => ({ ...policy })),
      }
      : {}),
    ...(metadata.thoughtSummary
      ? {
        thoughtSummary: {
          ...metadata.thoughtSummary,
          bullets: [...metadata.thoughtSummary.bullets],
        },
      }
      : {}),
    ...(metadata.suggestedFollowups
      ? {
        suggestedFollowups: metadata.suggestedFollowups.map(item => ({ ...item })),
      }
      : {}),
  };
}

function isPersistedState(value: unknown): value is PersistedState {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate['activeSessionId'] === 'string'
    && Array.isArray(candidate['sessions'])
    && (candidate['folders'] === undefined || (Array.isArray(candidate['folders']) && candidate['folders'].every(isSessionFolderRecord)))
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
    && (candidate['archivedAt'] === undefined || typeof candidate['archivedAt'] === 'string')
    && (candidate['folderId'] === undefined || typeof candidate['folderId'] === 'string')
    && Array.isArray(candidate['entries'])
    && candidate['entries'].every(isSessionTranscriptEntry);
}

function isSessionFolderRecord(value: unknown): value is SessionFolderRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate['id'] === 'string'
    && typeof candidate['name'] === 'string'
    && typeof candidate['createdAt'] === 'string'
    && typeof candidate['updatedAt'] === 'string';
}

function isSessionTranscriptEntry(value: unknown): value is SessionTranscriptEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate['id'] === 'string'
    && (candidate['role'] === 'user' || candidate['role'] === 'assistant')
    && typeof candidate['content'] === 'string'
    && typeof candidate['timestamp'] === 'string'
    && (candidate['meta'] === undefined || isSessionTranscriptMetadata(candidate['meta']));
}

function isSessionTranscriptMetadata(value: unknown): value is SessionTranscriptMetadata {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (candidate['modelUsed'] === undefined || typeof candidate['modelUsed'] === 'string')
    && (candidate['policies'] === undefined || (Array.isArray(candidate['policies']) && candidate['policies'].every(isSessionPolicySnapshot)))
    && (candidate['followupQuestion'] === undefined || typeof candidate['followupQuestion'] === 'string')
    && (candidate['suggestedFollowups'] === undefined
      || (Array.isArray(candidate['suggestedFollowups']) && candidate['suggestedFollowups'].every(isSessionSuggestedFollowup)))
    && (candidate['userVote'] === undefined || candidate['userVote'] === 'up' || candidate['userVote'] === 'down')
    && (candidate['votedAt'] === undefined || typeof candidate['votedAt'] === 'string')
    && (candidate['thoughtSummary'] === undefined || isSessionThoughtSummary(candidate['thoughtSummary']));
}

function isSessionPolicySnapshot(value: unknown): value is SessionPolicySnapshot {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (candidate['source'] === 'runtime' || candidate['source'] === 'personality' || candidate['source'] === 'safety' || candidate['source'] === 'project-soul')
    && typeof candidate['label'] === 'string'
    && typeof candidate['summary'] === 'string';
}

function isSessionSuggestedFollowup(value: unknown): value is SessionSuggestedFollowup {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate['label'] === 'string'
    && typeof candidate['prompt'] === 'string'
    && (candidate['mode'] === undefined
      || candidate['mode'] === 'send'
      || candidate['mode'] === 'steer'
      || candidate['mode'] === 'new-chat'
      || candidate['mode'] === 'new-session');
}

function isSessionThoughtSummary(value: unknown): value is SessionThoughtSummary {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate['label'] === 'string'
    && typeof candidate['summary'] === 'string'
    && (candidate['status'] === undefined
      || candidate['status'] === 'verified'
      || candidate['status'] === 'blocked'
      || candidate['status'] === 'missing'
      || candidate['status'] === 'not-applicable')
    && (candidate['statusLabel'] === undefined || typeof candidate['statusLabel'] === 'string')
    && Array.isArray(candidate['bullets'])
    && candidate['bullets'].every(item => typeof item === 'string');
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

function normalizeSessionTitle(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeFolderName(value: string): string | undefined {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed.length > 0 ? trimmed : undefined;
}