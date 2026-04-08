import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { AtlasMindContext } from '../extension.js';
import type { TaskImageAttachment } from '../types.js';
import { buildAssistantResponseMetadata, buildWorkstationContext, reconcileAssistantResponse } from '../chat/participant.js';
import { resolvePickedImageAttachments } from '../chat/imageAttachments.js';
import { getWebviewHtmlShell } from './webviewUtils.js';

const PROJECT_IDEATION_VIEW_TYPE = 'atlasmind.projectIdeation';
const MAX_IDEATION_CARDS = 48;
const MAX_IDEATION_CONNECTIONS = 96;
const MAX_IDEATION_HISTORY = 18;
const MAX_IDEATION_RUNS = 20;
const MAX_CARD_MEDIA = 4;
const MAX_PROMPT_ATTACHMENTS = 12;
const IDEATION_BOARD_FILE = 'atlas-ideation-board.json';
const IDEATION_SUMMARY_FILE = 'atlas-ideation-board.md';
const IDEATION_RESPONSE_TAG = 'atlasmind-ideation';
const ALLOWED_IDEATION_COMMANDS = new Set([
  'atlasmind.openProjectDashboard',
  'atlasmind.openProjectRunCenter',
  'atlasmind.openChatView',
  'atlasmind.openChatPanel',
  'atlasmind.openVoicePanel',
  'atlasmind.openVisionPanel',
  'atlasmind.openSettingsProject',
]);

type IdeationCardKind =
  | 'idea'
  | 'problem'
  | 'experiment'
  | 'user-insight'
  | 'risk'
  | 'requirement'
  | 'evidence'
  | 'atlas-response'
  | 'attachment';

type IdeationCardAuthor = 'user' | 'atlas';
type IdeationAnchor = 'center' | 'north' | 'east' | 'south' | 'west';
type IdeationMediaKind = 'image' | 'file' | 'url';
type PromptAttachmentKind = 'text' | 'image' | 'audio' | 'video' | 'url' | 'binary';
type IdeationLinkStyle = 'dotted' | 'solid';
type IdeationLinkDirection = 'none' | 'forward' | 'reverse' | 'both';
type IdeationLinkRelation = 'supports' | 'causal' | 'dependency' | 'contradiction' | 'opportunity';
type IdeationSyncTarget = 'domain' | 'operations' | 'agents' | 'knowledge-graph';

interface IdeationMediaRecord {
  id: string;
  label: string;
  kind: IdeationMediaKind;
  source: string;
  mimeType?: string;
  dataUri?: string;
}

interface IdeationCardRecord {
  id: string;
  title: string;
  body: string;
  kind: IdeationCardKind;
  author: IdeationCardAuthor;
  x: number;
  y: number;
  color: string;
  imageSources: string[];
  media: IdeationMediaRecord[];
  tags: string[];
  confidence: number;
  evidenceStrength: number;
  riskScore: number;
  costToValidate: number;
  syncTargets: IdeationSyncTarget[];
  parentCardId?: string;
  sourceRunId?: string;
  archivedAt?: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

interface IdeationConnectionRecord {
  id: string;
  fromCardId: string;
  toCardId: string;
  label: string;
  style: IdeationLinkStyle;
  direction: IdeationLinkDirection;
  relation: IdeationLinkRelation;
}

interface IdeationConstraintsRecord {
  budget: string;
  timeline: string;
  teamSize: string;
  riskTolerance: string;
  technicalStack: string;
}

interface IdeationContextPacketRecord {
  id: string;
  prompt: string;
  focusCardId?: string;
  queuedMedia: string[];
  boardSummary: string;
  constraintsSummary: string;
  projectMetadataSummary: string;
  lineage: string[];
  createdAt: string;
}

interface IdeationRunRecord {
  id: string;
  prompt: string;
  focusCardId?: string;
  contextPacketId: string;
  createdCardIds: string[];
  changedCardIds: string[];
  deltaSummary: string;
  createdAt: string;
}

interface IdeationHistoryEntry {
  role: 'user' | 'atlas';
  content: string;
  timestamp: string;
}

interface IdeationBoardRecord {
  version: 1;
  updatedAt: string;
  cards: IdeationCardRecord[];
  connections: IdeationConnectionRecord[];
  constraints: IdeationConstraintsRecord;
  focusCardId?: string;
  lastAtlasResponse: string;
  nextPrompts: string[];
  history: IdeationHistoryEntry[];
  projectMetadataSummary: string;
  contextPackets: IdeationContextPacketRecord[];
  runs: IdeationRunRecord[];
}

interface IdeationStructuredSuggestion {
  title: string;
  body: string;
  kind: IdeationCardKind;
  anchor?: IdeationAnchor;
}

interface IdeationResponseParseResult {
  displayResponse: string;
  cards: IdeationStructuredSuggestion[];
  nextPrompts: string[];
}

interface IdeationBoardPayload {
  cards: IdeationCardRecord[];
  connections: IdeationConnectionRecord[];
  constraints?: IdeationConstraintsRecord;
  focusCardId?: string;
  nextPrompts?: string[];
}

interface IdeationRunPayload {
  prompt: string;
  speakResponse?: boolean;
}

interface PromptAttachmentRecord {
  id: string;
  label: string;
  kind: PromptAttachmentKind;
  source: string;
  mimeType?: string;
  inlineText?: string;
  imageAttachment?: TaskImageAttachment;
}

type IdeationImportItem =
  | { transport: 'workspace-path'; value: string }
  | { transport: 'url'; value: string }
  | { transport: 'inline-image'; name: string; mimeType: string; dataBase64: string };

interface IngestPromptMediaPayload {
  items: IdeationImportItem[];
}

interface IngestCanvasMediaPayload {
  cardId?: string;
  items: IdeationImportItem[];
}

type ProjectIdeationMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'openCommand'; payload: string }
  | { type: 'openFile'; payload: string }
  | { type: 'clearPromptAttachments' }
  | { type: 'saveIdeationBoard'; payload: IdeationBoardPayload }
  | { type: 'runIdeationLoop'; payload: IdeationRunPayload }
  | { type: 'ingestPromptMedia'; payload: IngestPromptMediaPayload }
  | { type: 'ingestCanvasMedia'; payload: IngestCanvasMediaPayload }
  | { type: 'promoteCardToProjectRun'; payload: { cardId: string } }
  | { type: 'extractEvidenceFromCard'; payload: { cardId: string } }
  | { type: 'generateValidationBrief'; payload: { cardId: string } }
  | { type: 'syncCardToSsot'; payload: { cardId: string } }
  | { type: 'archiveCard'; payload: { cardId: string; archive: boolean } }
  | { type: 'runDeepBoardAnalysis' }
  | { type: 'generateReviewCheckpoint'; payload: { cardId: string } };

type IdeationWebviewMessage =
  | { type: 'state'; payload: IdeationSnapshot }
  | { type: 'error'; payload: string }
  | { type: 'ideationBusy'; payload: boolean }
  | { type: 'ideationStatus'; payload: string }
  | { type: 'ideationResponseReset' }
  | { type: 'ideationResponseChunk'; payload: string };

interface IdeationSnapshot {
  boardPath: string;
  summaryPath: string;
  cards: IdeationCardRecord[];
  connections: IdeationConnectionRecord[];
  constraints: IdeationConstraintsRecord;
  focusCardId?: string;
  nextPrompts: string[];
  history: IdeationHistoryEntry[];
  projectMetadataSummary: string;
  contextPackets: IdeationContextPacketRecord[];
  runs: IdeationRunRecord[];
  lastAtlasResponse: string;
  promptAttachments: Array<{ id: string; label: string; kind: PromptAttachmentKind; source: string }>;
  staleCardIds: string[];
  updatedAt: string;
  updatedRelative: string;
}

export class ProjectIdeationPanel {
  public static currentPanel: ProjectIdeationPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private promptAttachments: PromptAttachmentRecord[] = [];

  public static createOrShow(context: vscode.ExtensionContext, atlas: AtlasMindContext): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (ProjectIdeationPanel.currentPanel) {
      ProjectIdeationPanel.currentPanel.panel.reveal(column);
      void ProjectIdeationPanel.currentPanel.syncState();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      PROJECT_IDEATION_VIEW_TYPE,
      'AtlasMind Project Ideation',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      },
    );

    ProjectIdeationPanel.currentPanel = new ProjectIdeationPanel(panel, context, atlas);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly atlas: AtlasMindContext,
  ) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(message => {
      void this.handleMessage(message);
    }, null, this.disposables);

    this.atlas.memoryRefresh.event(() => { void this.syncState(); }, null, this.disposables);
    this.atlas.projectRunsRefresh.event(() => { void this.syncState(); }, null, this.disposables);
    this.atlas.sessionConversation.onDidChange(() => { void this.syncState(); }, null, this.disposables);

    void this.syncState();
  }

  private dispose(): void {
    ProjectIdeationPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!isProjectIdeationMessage(message)) {
      return;
    }

    switch (message.type) {
      case 'ready':
      case 'refresh':
        await this.syncState();
        return;
      case 'openCommand':
        if (ALLOWED_IDEATION_COMMANDS.has(message.payload)) {
          await vscode.commands.executeCommand(message.payload);
        }
        return;
      case 'openFile':
        await this.openWorkspaceRelativeFile(message.payload);
        return;
      case 'clearPromptAttachments':
        this.promptAttachments = [];
        await this.postMessage({ type: 'ideationStatus', payload: 'Cleared queued ideation attachments.' });
        await this.syncState();
        return;
      case 'saveIdeationBoard':
        await this.saveIdeationBoard(message.payload);
        return;
      case 'runIdeationLoop':
        await this.runIdeationLoop(message.payload);
        return;
      case 'ingestPromptMedia':
        await this.ingestPromptMedia(message.payload.items);
        return;
      case 'ingestCanvasMedia':
        await this.ingestCanvasMedia(message.payload);
        return;
      case 'promoteCardToProjectRun':
        await this.promoteCardToProjectRun(message.payload.cardId);
        return;
      case 'extractEvidenceFromCard':
        await this.extractEvidenceFromCard(message.payload.cardId);
        return;
      case 'generateValidationBrief':
        await this.generateValidationBrief(message.payload.cardId);
        return;
      case 'syncCardToSsot':
        await this.syncCardToSsot(message.payload.cardId);
        return;
      case 'archiveCard':
        await this.archiveCard(message.payload.cardId, message.payload.archive);
        return;
      case 'runDeepBoardAnalysis':
        await this.runDeepBoardAnalysis();
        return;
      case 'generateReviewCheckpoint':
        await this.generateReviewCheckpoint(message.payload.cardId);
        return;
    }
  }

  private async openWorkspaceRelativeFile(relativePath: string): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      return;
    }
    const target = resolveWorkspacePath(workspaceRoot, relativePath);
    if (!target) {
      return;
    }
    try {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
      await vscode.window.showTextDocument(document, { preview: false });
    } catch {
      // Ignore missing files.
    }
  }

  private async syncState(): Promise<void> {
    try {
      const snapshot = await this.collectSnapshot();
      await this.postMessage({ type: 'state', payload: snapshot });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await this.postMessage({ type: 'error', payload: `Ideation refresh failed: ${detail}` });
    }
  }

  private async collectSnapshot(): Promise<IdeationSnapshot> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const ssotPath = normalizeSsotPath(vscode.workspace.getConfiguration('atlasmind').get<string>('ssotPath', 'project_memory'));
    const board = await loadIdeationBoard(workspaceRoot, ssotPath);
    return {
      boardPath: buildIdeationRelativePath(ssotPath, IDEATION_BOARD_FILE),
      summaryPath: buildIdeationRelativePath(ssotPath, IDEATION_SUMMARY_FILE),
      cards: board.cards,
      connections: board.connections,
      constraints: board.constraints,
      focusCardId: board.focusCardId,
      nextPrompts: board.nextPrompts,
      history: board.history,
      projectMetadataSummary: board.projectMetadataSummary,
      contextPackets: board.contextPackets,
      runs: board.runs,
      lastAtlasResponse: board.lastAtlasResponse,
      promptAttachments: this.promptAttachments.map(item => ({ id: item.id, label: item.label, kind: item.kind, source: item.source })),
      staleCardIds: findStaleCardIds(board.cards),
      updatedAt: board.updatedAt,
      updatedRelative: formatRelativeDate(board.updatedAt),
    };
  }

  private async saveIdeationBoard(payload: IdeationBoardPayload): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const ssotPath = normalizeSsotPath(vscode.workspace.getConfiguration('atlasmind').get<string>('ssotPath', 'project_memory'));
    const stored = await loadIdeationBoard(workspaceRoot, ssotPath);
    const nextBoard = sanitizeIdeationBoard({
      ...stored,
      cards: payload.cards,
      connections: payload.connections,
      constraints: payload.constraints ?? stored.constraints,
      focusCardId: payload.focusCardId,
      nextPrompts: payload.nextPrompts ?? stored.nextPrompts,
      updatedAt: new Date().toISOString(),
    });
    await persistIdeationBoard(workspaceRoot, ssotPath, nextBoard);
  }

  private async runIdeationLoop(payload: IdeationRunPayload): Promise<void> {
    const trimmedPrompt = payload.prompt.trim();
    if (!trimmedPrompt) {
      await this.postMessage({ type: 'ideationStatus', payload: 'Describe the idea you want Atlas to pressure-test first.' });
      return;
    }

    const configuration = vscode.workspace.getConfiguration('atlasmind');
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const ssotPath = normalizeSsotPath(configuration.get<string>('ssotPath', 'project_memory'));
    const board = await loadIdeationBoard(workspaceRoot, ssotPath);
    const focusCard = board.cards.find(card => card.id === board.focusCardId);
    const sessionContext = this.atlas.sessionConversation.buildContext({
      maxTurns: configuration.get<number>('chatSessionTurnLimit', 6),
      maxChars: configuration.get<number>('chatSessionContextChars', 2500),
    });
    const workstationContext = buildWorkstationContext();
    const attachmentContext = buildAttachmentContextBlock(this.promptAttachments);
    const imageAttachments = this.promptAttachments
      .map(item => item.imageAttachment)
      .filter((item): item is TaskImageAttachment => Boolean(item));
    const projectMetadataSummary = board.projectMetadataSummary || await readIdeationProjectMetadataSummary(workspaceRoot, ssotPath);
    const contextPacket = buildIdeationContextPacket(trimmedPrompt, board, focusCard, this.promptAttachments, projectMetadataSummary);
    const ideationPrompt = buildIdeationPrompt(
      trimmedPrompt,
      board,
      focusCard,
      imageAttachments,
      contextPacket,
      attachmentContext ? [attachmentContext] : [],
    );

    await this.postMessage({ type: 'ideationResponseReset' });
    await this.postMessage({ type: 'ideationBusy', payload: true });
    await this.postMessage({ type: 'ideationStatus', payload: 'Atlas is shaping the next ideation move...' });

    let streamedText = '';
    try {
      const result = await this.atlas.orchestrator.processTask({
        id: `ideation-${Date.now()}`,
        userMessage: ideationPrompt,
        context: {
          ...(sessionContext ? { sessionContext } : {}),
          ...(workstationContext ? { workstationContext } : {}),
          ideationBoard: summarizeIdeationBoard(board),
          ideationContextPacket: summarizeIdeationContextPacket(contextPacket),
          ...(focusCard ? { ideationFocus: `${focusCard.title}: ${focusCard.body}` } : {}),
          ...(attachmentContext ? { attachmentContext } : {}),
          projectMetadataSummary,
          ...(imageAttachments.length > 0 ? { imageAttachments } : {}),
        },
        constraints: {
          budget: toBudgetMode(configuration.get<string>('budgetMode')),
          speed: toSpeedMode(configuration.get<string>('speedMode')),
          ...(imageAttachments.length > 0 ? { requiredCapabilities: ['vision' as const] } : {}),
        },
        timestamp: new Date().toISOString(),
      }, async chunk => {
        if (!chunk) {
          return;
        }
        streamedText += chunk;
        await this.postMessage({ type: 'ideationResponseChunk', payload: chunk });
      });

      const reconciled = reconcileAssistantResponse(streamedText, result.response);
      if (reconciled.additionalText) {
        await this.postMessage({ type: 'ideationResponseChunk', payload: reconciled.additionalText });
      }

      const parsed = parseIdeationResponse(reconciled.transcriptText);
      const updatedBoard = applyIdeationResponse(
        board,
        trimmedPrompt,
        parsed,
        focusCard?.id,
        toAttachmentMedia(this.promptAttachments),
        contextPacket,
      );
      await persistIdeationBoard(workspaceRoot, ssotPath, updatedBoard);

      this.atlas.sessionConversation.recordTurn(
        trimmedPrompt,
        parsed.displayResponse,
        undefined,
        buildAssistantResponseMetadata(trimmedPrompt, result, {
          hasSessionContext: Boolean(sessionContext),
          imageAttachments,
          routingContext: { ideation: true },
        }),
      );

      if (payload.speakResponse || configuration.get<boolean>('voice.ttsEnabled', false)) {
        this.atlas.voiceManager.speak(parsed.displayResponse);
      }

      await this.postMessage({ type: 'ideationStatus', payload: 'Ideation board updated with Atlas feedback.' });
      await this.syncState();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await this.postMessage({ type: 'ideationStatus', payload: `Ideation request failed: ${detail}` });
    } finally {
      await this.postMessage({ type: 'ideationBusy', payload: false });
    }
  }

  private async ingestPromptMedia(items: readonly IdeationImportItem[]): Promise<void> {
    const nextAttachments = [...this.promptAttachments];
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    for (const item of items) {
      const attachment = await resolvePromptAttachment(item, workspaceRoot);
      if (!attachment) {
        continue;
      }
      if (!nextAttachments.some(existing => existing.id === attachment.id)) {
        nextAttachments.push(attachment);
      }
      if (nextAttachments.length >= MAX_PROMPT_ATTACHMENTS) {
        break;
      }
    }

    this.promptAttachments = nextAttachments.slice(0, MAX_PROMPT_ATTACHMENTS);
    await this.postMessage({
      type: 'ideationStatus',
      payload: this.promptAttachments.length > 0
        ? `Queued ${this.promptAttachments.length} ideation attachment${this.promptAttachments.length === 1 ? '' : 's'} for the next Atlas pass.`
        : 'No supported ideation attachments were queued.',
    });
    await this.syncState();
  }

  private async ingestCanvasMedia(payload: IngestCanvasMediaPayload): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const ssotPath = normalizeSsotPath(vscode.workspace.getConfiguration('atlasmind').get<string>('ssotPath', 'project_memory'));
    const board = await loadIdeationBoard(workspaceRoot, ssotPath);
    const media = await resolveCanvasMedia(payload.items, workspaceRoot);
    if (media.length === 0) {
      await this.postMessage({ type: 'ideationStatus', payload: 'No supported canvas media was detected.' });
      return;
    }

    const now = new Date().toISOString();
    const targetCard = payload.cardId ? board.cards.find(card => card.id === payload.cardId) : undefined;
    if (targetCard) {
      targetCard.media = mergeCardMedia(targetCard.media, media);
      targetCard.imageSources = targetCard.media.filter(item => item.kind === 'image').map(item => item.source).slice(0, MAX_CARD_MEDIA);
      targetCard.tags = mergeTags(targetCard.tags, media.flatMap(item => inferEvidenceTags(item)));
      targetCard.evidenceStrength = clampNumber(targetCard.evidenceStrength + 10, 0, 100);
      if (targetCard.kind === 'attachment') {
        targetCard.kind = 'evidence';
      }
      targetCard.revision += 1;
      targetCard.updatedAt = now;
    } else {
      const label = media.length === 1 ? media[0].label : `${media.length} media items`;
      board.cards.push({
        id: createIdeationId('card'),
        title: label,
        body: media.length === 1 ? `Attached ${media[0].kind}: ${media[0].source}` : 'Dropped media for this idea fragment.',
        kind: classifyMediaCardKind(media),
        author: 'user',
        x: 0,
        y: 0,
        color: 'storm',
        imageSources: media.filter(item => item.kind === 'image').map(item => item.source).slice(0, MAX_CARD_MEDIA),
        media: mergeCardMedia([], media),
        tags: mergeTags([], media.flatMap(item => inferEvidenceTags(item))),
        confidence: 35,
        evidenceStrength: 60,
        riskScore: 20,
        costToValidate: 15,
        syncTargets: [],
        revision: 1,
        createdAt: now,
        updatedAt: now,
      });
      board.focusCardId = board.cards.at(-1)?.id;
    }

    board.updatedAt = now;
    await persistIdeationBoard(workspaceRoot, ssotPath, board);
    await this.postMessage({
      type: 'ideationStatus',
      payload: targetCard
        ? `Added ${media.length} media item${media.length === 1 ? '' : 's'} to the selected card.`
        : `Created a new media card with ${media.length} item${media.length === 1 ? '' : 's'}.`,
    });
    await this.syncState();
  }

  private async promoteCardToProjectRun(cardId: string): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const ssotPath = normalizeSsotPath(vscode.workspace.getConfiguration('atlasmind').get<string>('ssotPath', 'project_memory'));
    const board = await loadIdeationBoard(workspaceRoot, ssotPath);
    const card = board.cards.find(item => item.id === cardId);
    if (!card) {
      return;
    }
    const draftPrompt = buildProjectPromotionPrompt(card, board.constraints, board.projectMetadataSummary);
    await vscode.commands.executeCommand('atlasmind.openChatPanel', {
      draftPrompt,
      sendMode: 'new-chat',
    });
    await this.postMessage({ type: 'ideationStatus', payload: `Prepared a project-run draft for “${card.title}” in Atlas chat.` });
  }

  private async archiveCard(cardId: string, archive: boolean): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const ssotPath = normalizeSsotPath(vscode.workspace.getConfiguration('atlasmind').get<string>('ssotPath', 'project_memory'));
    const board = await loadIdeationBoard(workspaceRoot, ssotPath);
    const cardIndex = board.cards.findIndex(item => item.id === cardId);
    if (cardIndex < 0) {
      return;
    }
    const card = board.cards[cardIndex];
    const now = new Date().toISOString();
    if (archive) {
      board.cards[cardIndex] = { ...card, archivedAt: now, updatedAt: now, revision: card.revision + 1 };
    } else {
      const { archivedAt: _removed, ...rest } = card;
      void _removed;
      board.cards[cardIndex] = { ...rest, updatedAt: now, revision: card.revision + 1 };
    }
    board.updatedAt = now;
    await persistIdeationBoard(workspaceRoot, ssotPath, board);
    await this.postMessage({ type: 'ideationStatus', payload: archive ? `"${card.title}" archived.` : `"${card.title}" restored from archive.` });
    await this.syncState();
  }

  private async runDeepBoardAnalysis(): Promise<void> {
    const configuration = vscode.workspace.getConfiguration('atlasmind');
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const ssotPath = normalizeSsotPath(configuration.get<string>('ssotPath', 'project_memory'));
    const board = await loadIdeationBoard(workspaceRoot, ssotPath);

    await this.postMessage({ type: 'ideationResponseReset' });
    await this.postMessage({ type: 'ideationBusy', payload: true });
    await this.postMessage({ type: 'ideationStatus', payload: 'Running deep board analysis...' });

    let streamedText = '';
    try {
      const result = await this.atlas.orchestrator.processTask({
        id: `ideation-analysis-${Date.now()}`,
        userMessage: buildDeepAnalysisPrompt(board),
        context: { ideationBoard: summarizeIdeationBoard(board) },
        constraints: {
          budget: toBudgetMode(configuration.get<string>('budgetMode')),
          speed: toSpeedMode(configuration.get<string>('speedMode')),
        },
        timestamp: new Date().toISOString(),
      }, async chunk => {
        if (!chunk) { return; }
        streamedText += chunk;
        await this.postMessage({ type: 'ideationResponseChunk', payload: chunk });
      });

      const reconciled = reconcileAssistantResponse(streamedText, result.response);
      if (reconciled.additionalText) {
        await this.postMessage({ type: 'ideationResponseChunk', payload: reconciled.additionalText });
      }

      const contextPacket = buildIdeationContextPacket('Deep board analysis', board, undefined, [], board.projectMetadataSummary);
      const parsed = parseIdeationResponse(reconciled.transcriptText);
      const updatedBoard = applyIdeationResponse(board, 'Deep board analysis', parsed, undefined, [], contextPacket);
      await persistIdeationBoard(workspaceRoot, ssotPath, updatedBoard);

      await this.postMessage({ type: 'ideationStatus', payload: 'Deep board analysis complete.' });
      await this.syncState();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await this.postMessage({ type: 'ideationStatus', payload: `Deep analysis failed: ${detail}` });
    } finally {
      await this.postMessage({ type: 'ideationBusy', payload: false });
    }
  }

  private async generateReviewCheckpoint(cardId: string): Promise<void> {
    const configuration = vscode.workspace.getConfiguration('atlasmind');
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const ssotPath = normalizeSsotPath(configuration.get<string>('ssotPath', 'project_memory'));
    const board = await loadIdeationBoard(workspaceRoot, ssotPath);
    const card = board.cards.find(item => item.id === cardId);
    if (!card) {
      return;
    }

    await this.postMessage({ type: 'ideationResponseReset' });
    await this.postMessage({ type: 'ideationBusy', payload: true });
    await this.postMessage({ type: 'ideationStatus', payload: `Creating review checkpoint for "${card.title}"...` });

    let streamedText = '';
    try {
      const result = await this.atlas.orchestrator.processTask({
        id: `ideation-checkpoint-${Date.now()}`,
        userMessage: buildReviewCheckpointPrompt(card, board.constraints, board.projectMetadataSummary),
        context: { ideationBoard: summarizeIdeationBoard(board) },
        constraints: {
          budget: toBudgetMode(configuration.get<string>('budgetMode')),
          speed: toSpeedMode(configuration.get<string>('speedMode')),
        },
        timestamp: new Date().toISOString(),
      }, async chunk => {
        if (!chunk) { return; }
        streamedText += chunk;
        await this.postMessage({ type: 'ideationResponseChunk', payload: chunk });
      });

      const reconciled = reconcileAssistantResponse(streamedText, result.response);
      if (reconciled.additionalText) {
        await this.postMessage({ type: 'ideationResponseChunk', payload: reconciled.additionalText });
      }

      await persistReviewCheckpointFile(workspaceRoot, ssotPath, card, reconciled.transcriptText.replace(new RegExp(`<${IDEATION_RESPONSE_TAG}>[\\s\\S]*?</${IDEATION_RESPONSE_TAG}>`, 'gi'), '').trim());
      await this.postMessage({ type: 'ideationStatus', payload: `Review checkpoint for "${card.title}" saved to project memory.` });
      await this.syncState();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await this.postMessage({ type: 'ideationStatus', payload: `Checkpoint generation failed: ${detail}` });
    } finally {
      await this.postMessage({ type: 'ideationBusy', payload: false });
    }
  }

  private async extractEvidenceFromCard(cardId: string): Promise<void> {
    const configuration = vscode.workspace.getConfiguration('atlasmind');
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const ssotPath = normalizeSsotPath(configuration.get<string>('ssotPath', 'project_memory'));
    const board = await loadIdeationBoard(workspaceRoot, ssotPath);
    const card = board.cards.find(item => item.id === cardId);
    if (!card || card.media.length === 0) {
      await this.postMessage({ type: 'ideationStatus', payload: 'No media found on the selected card to extract from.' });
      return;
    }

    const imageAttachments = card.media
      .filter(item => item.kind === 'image' && item.dataUri)
      .map(item => ({
        source: item.source,
        mimeType: item.mimeType ?? 'image/png',
        dataBase64: item.dataUri!.split(',')[1] ?? '',
      }));
    const textContext = await buildMediaTextContext(card.media, workspaceRoot);
    const extractionPrompt = buildEvidenceExtractionPrompt(card, textContext);
    const contextPacket = buildEvidenceExtractionContextPacket(card, board);

    await this.postMessage({ type: 'ideationResponseReset' });
    await this.postMessage({ type: 'ideationBusy', payload: true });
    await this.postMessage({ type: 'ideationStatus', payload: `Extracting insights from ${card.media.length} media item${card.media.length === 1 ? '' : 's'}...` });

    let streamedText = '';
    try {
      const result = await this.atlas.orchestrator.processTask({
        id: `ideation-extract-${Date.now()}`,
        userMessage: extractionPrompt,
        context: {
          ideationBoard: summarizeIdeationBoard(board),
          ...(imageAttachments.length > 0 ? { imageAttachments } : {}),
          ...(textContext ? { attachmentContext: textContext } : {}),
        },
        constraints: {
          budget: toBudgetMode(configuration.get<string>('budgetMode')),
          speed: toSpeedMode(configuration.get<string>('speedMode')),
          ...(imageAttachments.length > 0 ? { requiredCapabilities: ['vision' as const] } : {}),
        },
        timestamp: new Date().toISOString(),
      }, async chunk => {
        if (!chunk) { return; }
        streamedText += chunk;
        await this.postMessage({ type: 'ideationResponseChunk', payload: chunk });
      });

      const reconciled = reconcileAssistantResponse(streamedText, result.response);
      if (reconciled.additionalText) {
        await this.postMessage({ type: 'ideationResponseChunk', payload: reconciled.additionalText });
      }

      const parsed = parseIdeationResponse(reconciled.transcriptText);
      const updatedBoard = applyIdeationResponse(board, `Extract evidence from: ${card.title}`, parsed, card.id, [], contextPacket);
      await persistIdeationBoard(workspaceRoot, ssotPath, updatedBoard);

      await this.postMessage({ type: 'ideationStatus', payload: `Extracted ${parsed.cards.length} insight card${parsed.cards.length === 1 ? '' : 's'} from media.` });
      await this.syncState();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await this.postMessage({ type: 'ideationStatus', payload: `Evidence extraction failed: ${detail}` });
    } finally {
      await this.postMessage({ type: 'ideationBusy', payload: false });
    }
  }

  private async generateValidationBrief(cardId: string): Promise<void> {
    const configuration = vscode.workspace.getConfiguration('atlasmind');
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const ssotPath = normalizeSsotPath(configuration.get<string>('ssotPath', 'project_memory'));
    const board = await loadIdeationBoard(workspaceRoot, ssotPath);
    const card = board.cards.find(item => item.id === cardId);
    if (!card) {
      return;
    }

    const validationPrompt = buildValidationBriefPrompt(card, board.constraints, board.projectMetadataSummary);
    const contextPacket = buildIdeationContextPacket(`Generate validation brief for: ${card.title}`, board, card, [], board.projectMetadataSummary);

    await this.postMessage({ type: 'ideationResponseReset' });
    await this.postMessage({ type: 'ideationBusy', payload: true });
    await this.postMessage({ type: 'ideationStatus', payload: `Generating validation brief for "${card.title}"...` });

    let streamedText = '';
    try {
      const result = await this.atlas.orchestrator.processTask({
        id: `ideation-validate-${Date.now()}`,
        userMessage: validationPrompt,
        context: { ideationBoard: summarizeIdeationBoard(board) },
        constraints: {
          budget: toBudgetMode(configuration.get<string>('budgetMode')),
          speed: toSpeedMode(configuration.get<string>('speedMode')),
        },
        timestamp: new Date().toISOString(),
      }, async chunk => {
        if (!chunk) { return; }
        streamedText += chunk;
        await this.postMessage({ type: 'ideationResponseChunk', payload: chunk });
      });

      const reconciled = reconcileAssistantResponse(streamedText, result.response);
      if (reconciled.additionalText) {
        await this.postMessage({ type: 'ideationResponseChunk', payload: reconciled.additionalText });
      }

      const displayText = reconciled.transcriptText.replace(new RegExp(`<${IDEATION_RESPONSE_TAG}>[\\s\\S]*?</${IDEATION_RESPONSE_TAG}>`, 'gi'), '').trim();
      const parsed = parseIdeationResponse(reconciled.transcriptText);
      const updatedBoard = applyIdeationResponse(board, `Generate validation brief for: ${card.title}`, parsed, card.id, [], contextPacket);
      await persistValidationBriefFile(workspaceRoot, ssotPath, card, displayText);
      await persistIdeationBoard(workspaceRoot, ssotPath, updatedBoard);

      await this.postMessage({ type: 'ideationStatus', payload: `Validation brief for "${card.title}" saved to project memory.` });
      await this.syncState();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await this.postMessage({ type: 'ideationStatus', payload: `Validation brief generation failed: ${detail}` });
    } finally {
      await this.postMessage({ type: 'ideationBusy', payload: false });
    }
  }

  private async syncCardToSsot(cardId: string): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      await this.postMessage({ type: 'ideationStatus', payload: 'No workspace folder found for SSOT sync.' });
      return;
    }
    const configuration = vscode.workspace.getConfiguration('atlasmind');
    const ssotPath = normalizeSsotPath(configuration.get<string>('ssotPath', 'project_memory'));
    const board = await loadIdeationBoard(workspaceRoot, ssotPath);
    const card = board.cards.find(item => item.id === cardId);
    if (!card || card.syncTargets.length === 0) {
      await this.postMessage({ type: 'ideationStatus', payload: 'No sync targets configured for this card. Check one or more targets in the inspector.' });
      return;
    }

    await this.postMessage({ type: 'ideationBusy', payload: true });
    await this.postMessage({ type: 'ideationStatus', payload: `Syncing "${card.title}" to ${card.syncTargets.join(', ')} in project memory...` });

    try {
      const syncPrompt = buildSsotSyncPrompt(card, board.constraints, board.projectMetadataSummary);
      const result = await this.atlas.orchestrator.processTask({
        id: `ideation-sync-${Date.now()}`,
        userMessage: syncPrompt,
        context: { ideationBoard: summarizeIdeationBoard(board) },
        constraints: {
          budget: toBudgetMode(configuration.get<string>('budgetMode')),
          speed: toSpeedMode(configuration.get<string>('speedMode')),
        },
        timestamp: new Date().toISOString(),
      });

      const written: IdeationSyncTarget[] = [];
      for (const target of card.syncTargets) {
        const filePath = resolveSyncTargetPath(workspaceRoot, ssotPath, target, card);
        await appendToSsotFile(filePath, card, result.response, target);
        written.push(target);
      }

      const cardIndex = board.cards.findIndex(item => item.id === cardId);
      if (cardIndex >= 0) {
        const now = new Date().toISOString();
        board.cards[cardIndex].revision += 1;
        board.cards[cardIndex].updatedAt = now;
        board.updatedAt = now;
      }
      await persistIdeationBoard(workspaceRoot, ssotPath, board);

      await this.postMessage({ type: 'ideationStatus', payload: `Synced "${card.title}" to ${written.join(', ')}.` });
      await this.syncState();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await this.postMessage({ type: 'ideationStatus', payload: `SSOT sync failed: ${detail}` });
    } finally {
      await this.postMessage({ type: 'ideationBusy', payload: false });
    }
  }

  private async postMessage(message: IdeationWebviewMessage): Promise<void> {
    await this.panel.webview.postMessage(message);
  }

  private getHtml(): string {
    const scriptUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'projectIdeation.js'));
    return getWebviewHtmlShell({
      title: 'AtlasMind Project Ideation',
      cspSource: this.panel.webview.cspSource,
      scriptUri: scriptUri.toString(),
      bodyContent: `
        <div class="ideation-shell-page">
          <div class="ideation-topbar">
            <div>
              <p class="dashboard-kicker">Project workspace</p>
              <h1>Project Ideation</h1>
              <p class="section-copy">A dedicated multimodal ideation dashboard for shaping concepts before they turn into autonomous project runs.</p>
            </div>
            <div class="ideation-topbar-actions">
              <button id="ideation-refresh" class="dashboard-button dashboard-button-ghost" type="button">Refresh</button>
              <button id="open-project-dashboard" class="dashboard-button dashboard-button-ghost" type="button">Project Dashboard</button>
              <button id="open-run-center" class="dashboard-button dashboard-button-ghost" type="button">Project Run Center</button>
            </div>
          </div>
          <div id="ideation-root" class="ideation-root" aria-live="polite">
            <div class="dashboard-loading">Loading ideation workspace...</div>
          </div>
        </div>
      `,
      extraCss: IDEATION_CSS,
    });
  }
}

export function isProjectIdeationMessage(message: unknown): message is ProjectIdeationMessage {
  if (typeof message !== 'object' || message === null) {
    return false;
  }

  const candidate = message as Record<string, unknown>;
  if (candidate['type'] === 'ready' || candidate['type'] === 'refresh' || candidate['type'] === 'clearPromptAttachments') {
    return true;
  }
  if ((candidate['type'] === 'openCommand' || candidate['type'] === 'openFile') && typeof candidate['payload'] === 'string') {
    return candidate['payload'].trim().length > 0;
  }
  if (candidate['type'] === 'runIdeationLoop') {
    return isIdeationRunPayload(candidate['payload']);
  }
  if (candidate['type'] === 'saveIdeationBoard') {
    return isIdeationBoardPayload(candidate['payload']);
  }
  if (candidate['type'] === 'ingestPromptMedia') {
    return isIdeationImportList(candidate['payload']);
  }
  if (candidate['type'] === 'ingestCanvasMedia') {
    return isIngestCanvasMediaPayload(candidate['payload']);
  }
  if (candidate['type'] === 'promoteCardToProjectRun' || candidate['type'] === 'extractEvidenceFromCard' || candidate['type'] === 'generateValidationBrief' || candidate['type'] === 'syncCardToSsot' || candidate['type'] === 'generateReviewCheckpoint') {
    return typeof candidate['payload'] === 'object'
      && candidate['payload'] !== null
      && typeof (candidate['payload'] as Record<string, unknown>)['cardId'] === 'string'
      && ((candidate['payload'] as Record<string, unknown>)['cardId'] as string).trim().length > 0;
  }
  if (candidate['type'] === 'archiveCard') {
    return typeof candidate['payload'] === 'object'
      && candidate['payload'] !== null
      && typeof (candidate['payload'] as Record<string, unknown>)['cardId'] === 'string'
      && ((candidate['payload'] as Record<string, unknown>)['cardId'] as string).trim().length > 0
      && typeof (candidate['payload'] as Record<string, unknown>)['archive'] === 'boolean';
  }
  if (candidate['type'] === 'runDeepBoardAnalysis') {
    return true;
  }
  return false;
}

function isIdeationRunPayload(value: unknown): value is IdeationRunPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate['prompt'] !== 'string' || candidate['prompt'].trim().length === 0) {
    return false;
  }
  return typeof candidate['speakResponse'] === 'undefined' || typeof candidate['speakResponse'] === 'boolean';
}

function isIdeationBoardPayload(value: unknown): value is IdeationBoardPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate['cards']) || !Array.isArray(candidate['connections'])) {
    return false;
  }
  if (candidate['cards'].length > MAX_IDEATION_CARDS || candidate['connections'].length > MAX_IDEATION_CONNECTIONS) {
    return false;
  }
  return candidate['cards'].every(isIdeationCardRecord)
    && candidate['connections'].every(isIdeationConnectionRecord)
    && (typeof candidate['constraints'] === 'undefined' || isIdeationConstraintsRecord(candidate['constraints']))
    && (typeof candidate['focusCardId'] === 'undefined' || typeof candidate['focusCardId'] === 'string')
    && (typeof candidate['nextPrompts'] === 'undefined' || (Array.isArray(candidate['nextPrompts']) && candidate['nextPrompts'].every(item => typeof item === 'string')));
}

function isIdeationConstraintsRecord(value: unknown): value is IdeationConstraintsRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate['budget'] === 'string'
    && typeof candidate['timeline'] === 'string'
    && typeof candidate['teamSize'] === 'string'
    && typeof candidate['riskTolerance'] === 'string'
    && typeof candidate['technicalStack'] === 'string';
}

function isIngestCanvasMediaPayload(value: unknown): value is IngestCanvasMediaPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (typeof candidate['cardId'] === 'undefined' || typeof candidate['cardId'] === 'string')
    && Array.isArray(candidate['items'])
    && candidate['items'].every(isIdeationImportItem);
}

function isIdeationImportList(value: unknown): value is IngestPromptMediaPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return Array.isArray(candidate['items']) && candidate['items'].every(isIdeationImportItem);
}

function isIdeationImportItem(value: unknown): value is IdeationImportItem {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (candidate['transport'] === 'workspace-path' || candidate['transport'] === 'url') {
    return typeof candidate['value'] === 'string' && candidate['value'].trim().length > 0;
  }
  if (candidate['transport'] === 'inline-image') {
    return typeof candidate['name'] === 'string'
      && typeof candidate['mimeType'] === 'string'
      && typeof candidate['dataBase64'] === 'string'
      && candidate['dataBase64'].trim().length > 0;
  }
  return false;
}

function isIdeationCardRecord(value: unknown): value is IdeationCardRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate['id'] === 'string'
    && typeof candidate['title'] === 'string'
    && typeof candidate['body'] === 'string'
    && typeof candidate['kind'] === 'string'
    && typeof candidate['author'] === 'string'
    && typeof candidate['x'] === 'number'
    && typeof candidate['y'] === 'number'
    && typeof candidate['color'] === 'string'
    && Array.isArray(candidate['imageSources'])
    && Array.isArray(candidate['media'])
    && (typeof candidate['confidence'] === 'undefined' || typeof candidate['confidence'] === 'number')
    && (typeof candidate['evidenceStrength'] === 'undefined' || typeof candidate['evidenceStrength'] === 'number')
    && (typeof candidate['riskScore'] === 'undefined' || typeof candidate['riskScore'] === 'number')
    && (typeof candidate['costToValidate'] === 'undefined' || typeof candidate['costToValidate'] === 'number')
    && (typeof candidate['revision'] === 'undefined' || typeof candidate['revision'] === 'number')
    && (typeof candidate['parentCardId'] === 'undefined' || typeof candidate['parentCardId'] === 'string')
    && (typeof candidate['sourceRunId'] === 'undefined' || typeof candidate['sourceRunId'] === 'string')
    && (typeof candidate['tags'] === 'undefined' || Array.isArray(candidate['tags']))
    && (typeof candidate['syncTargets'] === 'undefined' || Array.isArray(candidate['syncTargets']))
    && typeof candidate['createdAt'] === 'string'
    && typeof candidate['updatedAt'] === 'string';
}

function isIdeationConnectionRecord(value: unknown): value is IdeationConnectionRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate['id'] === 'string'
    && typeof candidate['fromCardId'] === 'string'
    && typeof candidate['toCardId'] === 'string'
    && typeof candidate['label'] === 'string'
    && (typeof candidate['style'] === 'undefined' || isIdeationLinkStyle(candidate['style']))
    && (typeof candidate['direction'] === 'undefined' || isIdeationLinkDirection(candidate['direction']))
    && (typeof candidate['relation'] === 'undefined' || isIdeationLinkRelation(candidate['relation']));
}

function isIdeationLinkStyle(value: unknown): value is IdeationLinkStyle {
  return value === 'dotted' || value === 'solid';
}

function isIdeationLinkDirection(value: unknown): value is IdeationLinkDirection {
  return value === 'none' || value === 'forward' || value === 'reverse' || value === 'both';
}

function isIdeationLinkRelation(value: unknown): value is IdeationLinkRelation {
  return value === 'supports' || value === 'causal' || value === 'dependency' || value === 'contradiction' || value === 'opportunity';
}

async function resolvePromptAttachment(item: IdeationImportItem, workspaceRoot: string | undefined): Promise<PromptAttachmentRecord | undefined> {
  if (item.transport === 'url') {
    const value = item.value.trim();
    return { id: `url:${value}`, label: value, kind: 'url', source: value };
  }

  if (item.transport === 'inline-image') {
    const source = `clipboard/${sanitizeInlineName(item.name, item.mimeType)}`;
    return {
      id: `inline-image:${source}:${item.dataBase64.length}`,
      label: source,
      kind: 'image',
      source,
      mimeType: item.mimeType,
      imageAttachment: { source, mimeType: item.mimeType, dataBase64: item.dataBase64 },
    };
  }

  if (!workspaceRoot) {
    return undefined;
  }
  const uri = coerceWorkspaceFileUri(item.value, workspaceRoot);
  if (!uri) {
    return undefined;
  }
  const relativePath = vscode.workspace.asRelativePath(uri, false);
  const imageAttachments = await resolvePickedImageAttachments([uri]);
  const imageAttachment = imageAttachments[0];
  if (imageAttachment) {
    return {
      id: `file:${relativePath}`,
      label: relativePath,
      kind: 'image',
      source: relativePath,
      mimeType: detectMimeType(relativePath),
      imageAttachment,
    };
  }

  const mimeType = detectMimeType(relativePath);
  let kind = classifyAttachmentKind(path.extname(relativePath).toLowerCase(), mimeType);
  let inlineText: string | undefined;
  if (kind === 'text') {
    inlineText = await readAttachmentSnippet(uri);
    if (!inlineText) {
      kind = 'binary';
    }
  }
  return {
    id: `file:${relativePath}`,
    label: relativePath,
    kind,
    source: relativePath,
    mimeType,
    inlineText,
  };
}

async function resolveCanvasMedia(items: readonly IdeationImportItem[], workspaceRoot: string | undefined): Promise<IdeationMediaRecord[]> {
  const media: IdeationMediaRecord[] = [];
  for (const item of items) {
    if (item.transport === 'url') {
      media.push({
        id: `media:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        label: item.value,
        kind: 'url',
        source: item.value,
      });
      continue;
    }

    if (item.transport === 'inline-image') {
      const label = sanitizeInlineName(item.name, item.mimeType);
      media.push({
        id: `media:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        label,
        kind: 'image',
        source: `clipboard/${label}`,
        mimeType: item.mimeType,
        dataUri: `data:${item.mimeType};base64,${item.dataBase64}`,
      });
      continue;
    }

    if (!workspaceRoot) {
      continue;
    }
    const uri = coerceWorkspaceFileUri(item.value, workspaceRoot);
    if (!uri) {
      continue;
    }
    const relativePath = vscode.workspace.asRelativePath(uri, false);
    const imageAttachments = await resolvePickedImageAttachments([uri]);
    const imageAttachment = imageAttachments[0];
    if (imageAttachment) {
      media.push({
        id: `media:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        label: relativePath,
        kind: 'image',
        source: relativePath,
        mimeType: imageAttachment.mimeType,
        dataUri: `data:${imageAttachment.mimeType};base64,${imageAttachment.dataBase64}`,
      });
      continue;
    }
    media.push({
      id: `media:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label: relativePath,
      kind: 'file',
      source: relativePath,
      mimeType: detectMimeType(relativePath),
    });
  }
  return media.slice(0, MAX_CARD_MEDIA);
}

function mergeCardMedia(existing: IdeationMediaRecord[], incoming: IdeationMediaRecord[]): IdeationMediaRecord[] {
  const next: IdeationMediaRecord[] = [];
  const seen = new Set<string>();
  for (const item of [...existing, ...incoming]) {
    const key = `${item.kind}:${item.source}:${item.mimeType ?? ''}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    next.push(item);
    if (next.length >= MAX_CARD_MEDIA) {
      break;
    }
  }
  return next;
}

function toAttachmentMedia(attachments: readonly PromptAttachmentRecord[]): IdeationMediaRecord[] {
  return attachments
    .filter((item): item is PromptAttachmentRecord & { imageAttachment: TaskImageAttachment } => Boolean(item.imageAttachment))
    .slice(0, MAX_CARD_MEDIA)
    .map(item => ({
      id: `media:${item.id}`,
      label: item.label,
      kind: 'image',
      source: item.source,
      mimeType: item.imageAttachment.mimeType,
      dataUri: `data:${item.imageAttachment.mimeType};base64,${item.imageAttachment.dataBase64}`,
    }));
}

async function readAttachmentSnippet(uri: vscode.Uri): Promise<string | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const text = Buffer.from(bytes).toString('utf8');
    if (!text || text.includes('\0')) {
      return undefined;
    }
    return text.slice(0, 4000);
  } catch {
    return undefined;
  }
}

function buildAttachmentContextBlock(attachments: readonly PromptAttachmentRecord[]): string | undefined {
  if (attachments.length === 0) {
    return undefined;
  }
  const normalizedSections = attachments.map(attachment => {
    if (attachment.kind === 'url') {
      return `- URL: ${attachment.source}`;
    }
    if (attachment.kind === 'image') {
      return `- Image: ${attachment.source}`;
    }
    if (attachment.kind === 'audio') {
      return `- Audio file: ${attachment.source}`;
    }
    if (attachment.kind === 'video') {
      return `- Video file: ${attachment.source}`;
    }
    if (attachment.kind === 'binary') {
      return `- Binary file: ${attachment.source}`;
    }
    const language = fenceLanguageFromPath(attachment.source);
    const fence = '```';
    return `- File: ${attachment.source}\n\n${fence}${language}\n${attachment.inlineText ?? ''}\n${fence}`;
  });

  return `Attached context:\n\n${normalizedSections.join('\n\n')}`;
}

function detectMimeType(filePath: string): string | undefined {
  switch (path.extname(filePath).toLowerCase()) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    case '.mp3': return 'audio/mpeg';
    case '.wav': return 'audio/wav';
    case '.ogg': return 'audio/ogg';
    case '.m4a': return 'audio/mp4';
    case '.mp4': return 'video/mp4';
    case '.mov': return 'video/quicktime';
    case '.webm': return 'video/webm';
    case '.mkv': return 'video/x-matroska';
    default: return undefined;
  }
}

function classifyAttachmentKind(extension: string, mimeType?: string): PromptAttachmentKind {
  if (mimeType?.startsWith('audio/')) {
    return 'audio';
  }
  if (mimeType?.startsWith('video/')) {
    return 'video';
  }
  if (mimeType?.startsWith('image/')) {
    return 'image';
  }
  const textExtensions = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.py', '.cs', '.cpp', '.c', '.h', '.java', '.go', '.rs', '.rb', '.php', '.css', '.scss', '.html', '.xml', '.yml', '.yaml', '.toml', '.txt', '.sh', '.ps1', '.sql', '.kt', '.swift', '.dart', '.vue', '.svelte', '.env', '.gitignore', '.editorconfig', '.ini', '.conf', '.cfg', '.log',
  ]);
  return textExtensions.has(extension) || extension.length === 0 ? 'text' : 'binary';
}

function fenceLanguageFromPath(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.ts': return 'ts';
    case '.tsx': return 'tsx';
    case '.js': return 'js';
    case '.jsx': return 'jsx';
    case '.json': return 'json';
    case '.md': return 'md';
    case '.py': return 'py';
    case '.cs': return 'cs';
    case '.cpp': return 'cpp';
    case '.c': return 'c';
    case '.java': return 'java';
    case '.go': return 'go';
    case '.rs': return 'rust';
    case '.rb': return 'rb';
    case '.php': return 'php';
    case '.css': return 'css';
    case '.scss': return 'scss';
    case '.html': return 'html';
    case '.xml': return 'xml';
    case '.yml':
    case '.yaml': return 'yaml';
    case '.toml': return 'toml';
    case '.sh': return 'sh';
    case '.ps1': return 'powershell';
    case '.sql': return 'sql';
    default: return '';
  }
}

function coerceWorkspaceFileUri(rawValue: string, workspaceRoot: string): vscode.Uri | undefined {
  let value = rawValue.trim();
  if (!value) {
    return undefined;
  }
  if (/^file:\/\//i.test(value)) {
    try {
      value = vscode.Uri.parse(value).fsPath;
    } catch {
      return undefined;
    }
  }
  const resolvedPath = path.isAbsolute(value) ? path.resolve(value) : path.resolve(workspaceRoot, value);
  const normalizedRoot = path.resolve(workspaceRoot);
  if (resolvedPath !== normalizedRoot && !resolvedPath.startsWith(`${normalizedRoot}${path.sep}`)) {
    return undefined;
  }
  return vscode.Uri.file(resolvedPath);
}

function resolveWorkspacePath(workspaceRoot: string, relativePath: string): string | undefined {
  const resolved = path.resolve(workspaceRoot, relativePath);
  const normalizedRoot = path.resolve(workspaceRoot);
  if (resolved === normalizedRoot || resolved.startsWith(`${normalizedRoot}${path.sep}`)) {
    return resolved;
  }
  return undefined;
}

function sanitizeInlineName(name: string, mimeType: string): string {
  const extension = mimeType === 'image/png'
    ? 'png'
    : mimeType === 'image/jpeg'
      ? 'jpg'
      : mimeType === 'image/gif'
        ? 'gif'
        : mimeType === 'image/webp'
          ? 'webp'
          : 'img';
  const stem = name.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || `clipboard-${Date.now()}`;
  return stem.includes('.') ? stem : `${stem}.${extension}`;
}

async function loadIdeationBoard(workspaceRoot: string | undefined, ssotPath: string): Promise<IdeationBoardRecord> {
  if (!workspaceRoot) {
    return createDefaultIdeationBoard();
  }
  const boardPath = path.join(workspaceRoot, ssotPath, 'ideas', IDEATION_BOARD_FILE);
  try {
    const raw = await fs.readFile(boardPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<IdeationBoardRecord>;
    return sanitizeIdeationBoard(parsed);
  } catch {
    return createDefaultIdeationBoard();
  }
}

async function persistIdeationBoard(workspaceRoot: string | undefined, ssotPath: string, board: IdeationBoardRecord): Promise<void> {
  if (!workspaceRoot) {
    return;
  }
  const ideasDir = path.join(workspaceRoot, ssotPath, 'ideas');
  await fs.mkdir(ideasDir, { recursive: true });
  const sanitized = sanitizeIdeationBoard(board);
  await Promise.all([
    fs.writeFile(path.join(ideasDir, IDEATION_BOARD_FILE), JSON.stringify(sanitized, null, 2), 'utf-8'),
    fs.writeFile(path.join(ideasDir, IDEATION_SUMMARY_FILE), buildIdeationSummaryMarkdown(sanitized), 'utf-8'),
  ]);
}

function createDefaultIdeationBoard(): IdeationBoardRecord {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    cards: [],
    connections: [],
    constraints: createDefaultIdeationConstraints(),
    lastAtlasResponse: '',
    nextPrompts: [
      'Who is the primary user, and what job are they trying to complete?',
      'What is the sharpest constraint or risk this project needs to survive?',
      'What is the smallest experiment that would validate the idea quickly?',
    ],
    history: [],
    projectMetadataSummary: '',
    contextPackets: [],
    runs: [],
  };
}

function createDefaultIdeationConstraints(): IdeationConstraintsRecord {
  return {
    budget: '',
    timeline: '',
    teamSize: '',
    riskTolerance: '',
    technicalStack: '',
  };
}

function sanitizeIdeationBoard(value: Partial<IdeationBoardRecord> | IdeationBoardRecord): IdeationBoardRecord {
  const fallback = createDefaultIdeationBoard();
  const cards = Array.isArray(value.cards)
    ? value.cards.filter(isIdeationCardLike).slice(0, MAX_IDEATION_CARDS).map(sanitizeIdeationCard)
    : fallback.cards;
  const cardIds = new Set(cards.map(card => card.id));
  const connections = Array.isArray(value.connections)
    ? value.connections
      .filter(isIdeationConnectionRecord)
      .filter(connection => cardIds.has(connection.fromCardId) && cardIds.has(connection.toCardId))
      .slice(0, MAX_IDEATION_CONNECTIONS)
      .map(connection => ({
        id: connection.id.trim() || createIdeationId('link'),
        fromCardId: connection.fromCardId,
        toCardId: connection.toCardId,
        label: clampText(connection.label, 36),
        style: isIdeationLinkStyle(connection.style) ? connection.style : 'dotted',
        direction: isIdeationLinkDirection(connection.direction) ? connection.direction : 'none',
        relation: isIdeationLinkRelation(connection.relation) ? connection.relation : 'supports',
      }))
    : fallback.connections;
  const history = Array.isArray(value.history)
    ? value.history
      .filter((entry): entry is IdeationHistoryEntry => typeof entry === 'object' && entry !== null && (entry['role'] === 'user' || entry['role'] === 'atlas') && typeof entry['content'] === 'string' && typeof entry['timestamp'] === 'string')
      .slice(-MAX_IDEATION_HISTORY)
      .map(entry => ({ role: entry.role, content: clampText(entry.content, 800), timestamp: normalizeIso(entry.timestamp) }))
    : fallback.history;
  const focusCardId = typeof value.focusCardId === 'string' && cardIds.has(value.focusCardId) ? value.focusCardId : undefined;
  const nextPrompts = Array.isArray(value.nextPrompts)
    ? value.nextPrompts.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).slice(0, 6).map(entry => clampText(entry, 140))
    : fallback.nextPrompts;
  const constraints = isIdeationConstraintsRecord(value.constraints)
    ? sanitizeIdeationConstraints(value.constraints)
    : fallback.constraints;
  const contextPackets = Array.isArray(value.contextPackets)
    ? value.contextPackets.filter(isIdeationContextPacketRecord).slice(-MAX_IDEATION_RUNS).map(sanitizeIdeationContextPacket)
    : [];
  const runs = Array.isArray(value.runs)
    ? value.runs.filter(isIdeationRunRecord).slice(-MAX_IDEATION_RUNS).map(sanitizeIdeationRunRecord)
    : [];
  return {
    version: 1,
    updatedAt: normalizeIso(value.updatedAt),
    cards,
    connections,
    constraints,
    focusCardId,
    lastAtlasResponse: typeof value.lastAtlasResponse === 'string' ? clampText(value.lastAtlasResponse, 4000) : fallback.lastAtlasResponse,
    nextPrompts,
    history,
    projectMetadataSummary: typeof value.projectMetadataSummary === 'string' ? clampText(value.projectMetadataSummary, 2400) : fallback.projectMetadataSummary,
    contextPackets,
    runs,
  };
}

function sanitizeIdeationConstraints(value: IdeationConstraintsRecord): IdeationConstraintsRecord {
  return {
    budget: clampText(value.budget, 80),
    timeline: clampText(value.timeline, 80),
    teamSize: clampText(value.teamSize, 40),
    riskTolerance: clampText(value.riskTolerance, 40),
    technicalStack: clampText(value.technicalStack, 120),
  };
}

function isIdeationCardLike(value: unknown): value is IdeationCardRecord | (IdeationCardRecord & { imageSources?: string[] }) {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate['id'] === 'string'
    && typeof candidate['title'] === 'string'
    && typeof candidate['body'] === 'string'
    && typeof candidate['kind'] === 'string'
    && typeof candidate['author'] === 'string'
    && typeof candidate['x'] === 'number'
    && typeof candidate['y'] === 'number'
    && typeof candidate['color'] === 'string'
    && typeof candidate['createdAt'] === 'string'
    && typeof candidate['updatedAt'] === 'string';
}

function sanitizeIdeationCard(card: IdeationCardRecord & { imageSources?: string[] }): IdeationCardRecord {
  const rawMedia = Array.isArray(card.media)
    ? card.media.filter(isIdeationMediaRecord).slice(0, MAX_CARD_MEDIA).map(sanitizeIdeationMedia)
    : [];
  const migratedMedia = rawMedia.length > 0
    ? rawMedia
    : Array.isArray(card.imageSources)
      ? card.imageSources
        .filter((source): source is string => typeof source === 'string' && source.trim().length > 0)
        .slice(0, MAX_CARD_MEDIA)
        .map(source => ({ id: createIdeationId('card'), label: source, kind: 'image' as const, source }))
      : [];
  const imageSources = migratedMedia.filter(item => item.kind === 'image').map(item => item.source).slice(0, MAX_CARD_MEDIA);
  return {
    id: card.id.trim() || createIdeationId('card'),
    title: clampText(card.title, 80) || 'Untitled idea',
    body: clampText(card.body, 320),
    kind: normalizeIdeationKind(card.kind),
    author: card.author === 'atlas' ? 'atlas' : 'user',
    x: clampNumber(card.x, -1600, 1600),
    y: clampNumber(card.y, -1200, 1200),
    color: normalizeIdeationColor(card.color),
    imageSources,
    media: migratedMedia,
    tags: Array.isArray(card.tags) ? card.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 8).map(tag => clampText(tag, 24)).filter(Boolean) : [],
    confidence: clampNumber(card.confidence ?? defaultConfidenceForKind(normalizeIdeationKind(card.kind)), 0, 100),
    evidenceStrength: clampNumber(card.evidenceStrength ?? defaultEvidenceStrengthForKind(normalizeIdeationKind(card.kind)), 0, 100),
    riskScore: clampNumber(card.riskScore ?? defaultRiskScoreForKind(normalizeIdeationKind(card.kind)), 0, 100),
    costToValidate: clampNumber(card.costToValidate ?? defaultCostToValidateForKind(normalizeIdeationKind(card.kind)), 0, 100),
    syncTargets: Array.isArray(card.syncTargets) ? card.syncTargets.filter(isIdeationSyncTarget) : [],
    ...(typeof card.parentCardId === 'string' && card.parentCardId.trim().length > 0 ? { parentCardId: card.parentCardId.trim() } : {}),
    ...(typeof card.sourceRunId === 'string' && card.sourceRunId.trim().length > 0 ? { sourceRunId: card.sourceRunId.trim() } : {}),
    ...(typeof card.archivedAt === 'string' && card.archivedAt.trim().length > 0 ? { archivedAt: normalizeIso(card.archivedAt) } : {}),
    revision: Math.max(1, Math.floor(card.revision ?? 1)),
    createdAt: normalizeIso(card.createdAt),
    updatedAt: normalizeIso(card.updatedAt),
  };
}

function isIdeationSyncTarget(value: unknown): value is IdeationSyncTarget {
  return value === 'domain' || value === 'operations' || value === 'agents' || value === 'knowledge-graph';
}

function isIdeationMediaRecord(value: unknown): value is IdeationMediaRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate['id'] === 'string'
    && typeof candidate['label'] === 'string'
    && typeof candidate['kind'] === 'string'
    && typeof candidate['source'] === 'string';
}

function sanitizeIdeationMedia(media: IdeationMediaRecord): IdeationMediaRecord {
  return {
    id: media.id.trim() || `media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label: clampText(media.label, 120) || 'Media',
    kind: media.kind === 'url' ? 'url' : media.kind === 'file' ? 'file' : 'image',
    source: clampText(media.source, 260),
    ...(typeof media.mimeType === 'string' && media.mimeType.trim().length > 0 ? { mimeType: media.mimeType.trim() } : {}),
    ...(typeof media.dataUri === 'string' && media.dataUri.startsWith('data:') && media.dataUri.length < 2_500_000 ? { dataUri: media.dataUri } : {}),
  };
}

function isIdeationCardKind(value: string): value is IdeationCardKind {
  return ['idea', 'problem', 'experiment', 'user-insight', 'risk', 'requirement', 'evidence', 'atlas-response', 'attachment'].includes(value);
}

function normalizeIdeationKind(value: string): IdeationCardKind {
  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case 'concept':
    case 'opportunity':
      return 'idea';
    case 'insight':
    case 'user-need':
      return 'user-insight';
    case 'question':
      return 'problem';
    case 'idea':
    case 'problem':
    case 'experiment':
    case 'user-insight':
    case 'risk':
    case 'requirement':
    case 'evidence':
    case 'atlas-response':
    case 'attachment':
      return normalized;
    default:
      return 'idea';
  }
}

function defaultConfidenceForKind(kind: IdeationCardKind): number {
  switch (kind) {
    case 'evidence': return 70;
    case 'experiment': return 55;
    case 'risk': return 45;
    default: return 50;
  }
}

function defaultEvidenceStrengthForKind(kind: IdeationCardKind): number {
  return kind === 'evidence' ? 75 : kind === 'user-insight' ? 60 : 35;
}

function defaultRiskScoreForKind(kind: IdeationCardKind): number {
  return kind === 'risk' ? 75 : kind === 'experiment' ? 40 : 30;
}

function defaultCostToValidateForKind(kind: IdeationCardKind): number {
  return kind === 'experiment' ? 45 : kind === 'idea' ? 35 : 20;
}

function isIdeationContextPacketRecord(value: unknown): value is IdeationContextPacketRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate['id'] === 'string'
    && typeof candidate['prompt'] === 'string'
    && Array.isArray(candidate['queuedMedia'])
    && typeof candidate['boardSummary'] === 'string'
    && typeof candidate['constraintsSummary'] === 'string'
    && typeof candidate['projectMetadataSummary'] === 'string'
    && Array.isArray(candidate['lineage'])
    && typeof candidate['createdAt'] === 'string'
    && (typeof candidate['focusCardId'] === 'undefined' || typeof candidate['focusCardId'] === 'string');
}

function sanitizeIdeationContextPacket(value: IdeationContextPacketRecord): IdeationContextPacketRecord {
  return {
    id: value.id.trim() || createIdeationPacketId(),
    prompt: clampText(value.prompt, 400),
    ...(typeof value.focusCardId === 'string' && value.focusCardId.trim().length > 0 ? { focusCardId: value.focusCardId.trim() } : {}),
    queuedMedia: value.queuedMedia.filter((item): item is string => typeof item === 'string').slice(0, 12).map(item => clampText(item, 120)),
    boardSummary: clampText(value.boardSummary, 1200),
    constraintsSummary: clampText(value.constraintsSummary, 320),
    projectMetadataSummary: clampText(value.projectMetadataSummary, 1200),
    lineage: value.lineage.filter((item): item is string => typeof item === 'string').slice(0, 12).map(item => clampText(item, 80)),
    createdAt: normalizeIso(value.createdAt),
  };
}

function isIdeationRunRecord(value: unknown): value is IdeationRunRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate['id'] === 'string'
    && typeof candidate['prompt'] === 'string'
    && typeof candidate['contextPacketId'] === 'string'
    && Array.isArray(candidate['createdCardIds'])
    && Array.isArray(candidate['changedCardIds'])
    && typeof candidate['deltaSummary'] === 'string'
    && typeof candidate['createdAt'] === 'string'
    && (typeof candidate['focusCardId'] === 'undefined' || typeof candidate['focusCardId'] === 'string');
}

function sanitizeIdeationRunRecord(value: IdeationRunRecord): IdeationRunRecord {
  return {
    id: value.id.trim() || createIdeationRunId(),
    prompt: clampText(value.prompt, 400),
    ...(typeof value.focusCardId === 'string' && value.focusCardId.trim().length > 0 ? { focusCardId: value.focusCardId.trim() } : {}),
    contextPacketId: value.contextPacketId.trim(),
    createdCardIds: value.createdCardIds.filter((item): item is string => typeof item === 'string').slice(0, 12).map(item => item.trim()),
    changedCardIds: value.changedCardIds.filter((item): item is string => typeof item === 'string').slice(0, 12).map(item => item.trim()),
    deltaSummary: clampText(value.deltaSummary, 240),
    createdAt: normalizeIso(value.createdAt),
  };
}

function normalizeIdeationColor(value: string): string {
  const allowed = new Set(['sun', 'sea', 'mint', 'rose', 'sand', 'storm']);
  const normalized = value.trim().toLowerCase();
  return allowed.has(normalized) ? normalized : 'sun';
}

function normalizeIso(value: unknown): string {
  if (typeof value === 'string') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }
  return new Date().toISOString();
}

function clampText(value: string, limit: number): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, limit);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));
}

function createIdeationId(prefix: 'card' | 'link'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createIdeationPacketId(): string {
  return `packet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createIdeationRunId(): string {
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildIdeationRelativePath(ssotPath: string, fileName: string): string {
  return `${ssotPath.replace(/\/$/, '')}/ideas/${fileName}`;
}

function summarizeIdeationBoard(board: IdeationBoardRecord): string {
  const cards = board.cards.slice(0, 10).map(card => {
    const media = card.media.length > 0 ? ` [media: ${card.media.map(item => item.label).join(', ')}]` : '';
    const metrics = ` [confidence ${card.confidence}, evidence ${card.evidenceStrength}, risk ${card.riskScore}, validate ${card.costToValidate}]`;
    return `- [${card.kind}] ${card.title}: ${card.body}${media}${metrics}`;
  }).join('\n');
  const prompts = board.nextPrompts.map(prompt => `- ${prompt}`).join('\n');
  const constraintsSummary = summarizeIdeationConstraints(board.constraints);
  return [
    `Board cards: ${board.cards.length}.`,
    board.focusCardId ? `Focused card: ${board.cards.find(card => card.id === board.focusCardId)?.title ?? 'unknown'}.` : 'No focused card selected.',
    constraintsSummary ? `Constraints: ${constraintsSummary}` : 'No explicit constraints are set.',
    cards ? `Current board:\n${cards}` : 'Current board is empty.',
    prompts ? `Queued follow-up prompts:\n${prompts}` : 'No queued follow-up prompts.',
  ].join('\n\n');
}

function summarizeIdeationConstraints(constraints: IdeationConstraintsRecord): string {
  return [
    constraints.budget ? `budget ${constraints.budget}` : '',
    constraints.timeline ? `timeline ${constraints.timeline}` : '',
    constraints.teamSize ? `team ${constraints.teamSize}` : '',
    constraints.riskTolerance ? `risk tolerance ${constraints.riskTolerance}` : '',
    constraints.technicalStack ? `stack ${constraints.technicalStack}` : '',
  ].filter(Boolean).join(', ');
}

function buildIdeationContextPacket(
  prompt: string,
  board: IdeationBoardRecord,
  focusCard: IdeationCardRecord | undefined,
  attachments: readonly PromptAttachmentRecord[],
  projectMetadataSummary: string,
): IdeationContextPacketRecord {
  const lineage = focusCard ? buildCardLineage(board.cards, focusCard).map(card => `${card.kind}: ${card.title}`) : [];
  return {
    id: createIdeationPacketId(),
    prompt: clampText(prompt, 400),
    ...(focusCard ? { focusCardId: focusCard.id } : {}),
    queuedMedia: attachments.map(item => item.label).slice(0, 12),
    boardSummary: clampText(summarizeIdeationBoard(board), 1200),
    constraintsSummary: clampText(summarizeIdeationConstraints(board.constraints), 320),
    projectMetadataSummary: clampText(projectMetadataSummary, 1200),
    lineage: lineage.slice(0, 12),
    createdAt: new Date().toISOString(),
  };
}

function summarizeIdeationContextPacket(packet: IdeationContextPacketRecord): string {
  return [
    `Prompt: ${packet.prompt}`,
    packet.constraintsSummary ? `Constraints: ${packet.constraintsSummary}` : 'Constraints: none',
    packet.queuedMedia.length > 0 ? `Queued media: ${packet.queuedMedia.join(', ')}` : 'Queued media: none',
    packet.lineage.length > 0 ? `Lineage: ${packet.lineage.join(' -> ')}` : 'Lineage: none',
    packet.projectMetadataSummary ? `Project metadata:\n${packet.projectMetadataSummary}` : 'Project metadata: none',
  ].join('\n\n');
}

function buildIdeationPrompt(
  prompt: string,
  board: IdeationBoardRecord,
  focusCard: IdeationCardRecord | undefined,
  attachments: readonly TaskImageAttachment[],
  contextPacket: IdeationContextPacketRecord,
  extraContextBlocks: readonly string[] = [],
): string {
  const boardSummary = summarizeIdeationBoard(board);
  const focusSummary = focusCard
    ? `Focused card:\nTitle: ${focusCard.title}\nType: ${focusCard.kind}\nBody: ${focusCard.body}`
    : 'There is no focused card yet. If the board is sparse, help bootstrap it.';
  const attachmentSummary = attachments.length > 0
    ? `Attached images:\n${attachments.map(attachment => `- ${attachment.source} (${attachment.mimeType})`).join('\n')}`
    : 'No images are attached for this ideation pass.';
  return [
    'You are AtlasMind running a project ideation workshop.',
    'Act like a structured facilitator: pressure-test the idea, surface user needs, risks, requirements, opportunities, and next experiments.',
    'Use the context packet deterministically. Respect explicit constraints before recommending broader moves.',
    'Respond in markdown with concise, high-signal guidance for the user.',
    `After the markdown, append a JSON object inside <${IDEATION_RESPONSE_TAG}>...</${IDEATION_RESPONSE_TAG}> with this schema:`,
    '{"cards":[{"title":"string","body":"string","kind":"idea|problem|experiment|user-insight|risk|requirement|evidence","anchor":"center|north|east|south|west"}],"nextPrompts":["string"]}',
    'Return 2 to 5 cards. Keep card bodies short and actionable. Use anchors to spread cards around the focused card when relevant.',
    'Prefer experiment cards when the user asks for validation. Prefer evidence cards when the user provided artifacts.',
    '',
    `User request: ${prompt}`,
    '',
    'Context packet:',
    summarizeIdeationContextPacket(contextPacket),
    '',
    boardSummary,
    '',
    focusSummary,
    '',
    attachmentSummary,
    ...extraContextBlocks.flatMap(block => ['', block]),
  ].join('\n');
}

function parseIdeationResponse(response: string): IdeationResponseParseResult {
  const tagPattern = new RegExp(`<${IDEATION_RESPONSE_TAG}>([\\s\\S]*?)</${IDEATION_RESPONSE_TAG}>`, 'i');
  const match = response.match(tagPattern);
  const displayResponse = response.replace(tagPattern, '').trim();
  if (!match) {
    return {
      displayResponse: displayResponse || 'Atlas updated the ideation board.',
      cards: [{
        title: 'Atlas insight',
        body: clampText(displayResponse || 'Atlas updated the ideation board.', 220),
        kind: 'atlas-response',
        anchor: 'east',
      }],
      nextPrompts: [],
    };
  }
  try {
    const parsed = JSON.parse(match[1]) as Record<string, unknown>;
    const cards = Array.isArray(parsed['cards'])
      ? parsed['cards']
        .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
        .slice(0, 5)
        .map(entry => ({
          title: clampText(typeof entry['title'] === 'string' ? entry['title'] : 'Atlas insight', 80),
          body: clampText(typeof entry['body'] === 'string' ? entry['body'] : '', 220),
          kind: isIdeationCardKind(typeof entry['kind'] === 'string' ? entry['kind'] : '') ? entry['kind'] as IdeationCardKind : 'idea',
          anchor: isIdeationAnchor(typeof entry['anchor'] === 'string' ? entry['anchor'] : '') ? entry['anchor'] as IdeationAnchor : undefined,
        }))
      : [];
    const nextPrompts = Array.isArray(parsed['nextPrompts'])
      ? parsed['nextPrompts'].filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).slice(0, 6).map(entry => clampText(entry, 140))
      : [];
    return {
      displayResponse: displayResponse || 'Atlas updated the ideation board.',
      cards: cards.length > 0 ? cards : [{ title: 'Atlas insight', body: clampText(displayResponse || 'Atlas updated the ideation board.', 220), kind: 'atlas-response', anchor: 'east' }],
      nextPrompts,
    };
  } catch {
    return {
      displayResponse: displayResponse || 'Atlas updated the ideation board.',
      cards: [{ title: 'Atlas insight', body: clampText(displayResponse || 'Atlas updated the ideation board.', 220), kind: 'atlas-response', anchor: 'east' }],
      nextPrompts: [],
    };
  }
}

function isIdeationAnchor(value: string): value is IdeationAnchor {
  return ['center', 'north', 'east', 'south', 'west'].includes(value);
}

function applyIdeationResponse(
  board: IdeationBoardRecord,
  userPrompt: string,
  parsed: IdeationResponseParseResult,
  focusCardId: string | undefined,
  attachmentMedia: IdeationMediaRecord[],
  contextPacket: IdeationContextPacketRecord,
): IdeationBoardRecord {
  const nextBoard = sanitizeIdeationBoard(board);
  const now = new Date().toISOString();
  const runId = createIdeationRunId();
  const focusCard = focusCardId ? nextBoard.cards.find(card => card.id === focusCardId) : undefined;
  const origin = focusCard ?? { x: 0, y: 0 };
  if (nextBoard.cards.length === 0) {
    nextBoard.cards.push({
      id: createIdeationId('card'),
      title: clampText(userPrompt, 80) || 'Project idea',
      body: clampText(userPrompt, 220),
      kind: 'idea',
      author: 'user',
      x: 0,
      y: 0,
      color: 'sun',
      imageSources: attachmentMedia.filter(item => item.kind === 'image').map(item => item.source).slice(0, MAX_CARD_MEDIA),
      media: attachmentMedia.slice(0, MAX_CARD_MEDIA),
      tags: [],
      confidence: 50,
      evidenceStrength: 30,
      riskScore: 30,
      costToValidate: 35,
      syncTargets: [],
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
  }
  const additions = parsed.cards.map((card, index) => createAtlasIdeationCard(card, origin.x, origin.y, index, attachmentMedia, now, focusCard?.id, runId));
  nextBoard.cards = [...nextBoard.cards, ...additions].slice(-MAX_IDEATION_CARDS);
  const links = focusCard
    ? additions.map((card, index) => ({
      id: createIdeationId('link'),
      fromCardId: focusCard.id,
      toCardId: card.id,
      label: buildIdeationLinkLabel(card.kind, index),
      style: 'dotted' as const,
      direction: 'none' as const,
      relation: suggestLinkRelation(focusCard.kind, card.kind),
    }))
    : [];
  nextBoard.connections = [...nextBoard.connections, ...links].slice(-MAX_IDEATION_CONNECTIONS);
  nextBoard.focusCardId = additions.at(0)?.id ?? nextBoard.focusCardId;
  nextBoard.lastAtlasResponse = parsed.displayResponse;
  nextBoard.nextPrompts = parsed.nextPrompts.length > 0 ? parsed.nextPrompts : nextBoard.nextPrompts;
  nextBoard.history = [
    ...nextBoard.history,
    { role: 'user' as const, content: clampText(userPrompt, 800), timestamp: now },
    { role: 'atlas' as const, content: parsed.displayResponse, timestamp: now },
  ].slice(-MAX_IDEATION_HISTORY);
  nextBoard.projectMetadataSummary = contextPacket.projectMetadataSummary;
  nextBoard.contextPackets = [...nextBoard.contextPackets, contextPacket].slice(-MAX_IDEATION_RUNS);
  nextBoard.runs = [...nextBoard.runs, {
    id: runId,
    prompt: clampText(userPrompt, 400),
    ...(focusCardId ? { focusCardId } : {}),
    contextPacketId: contextPacket.id,
    createdCardIds: additions.map(card => card.id),
    changedCardIds: focusCard ? [focusCard.id] : [],
    deltaSummary: buildRunDeltaSummary(focusCard, additions),
    createdAt: now,
  }].slice(-MAX_IDEATION_RUNS);
  nextBoard.updatedAt = now;
  return sanitizeIdeationBoard(nextBoard);
}

function createAtlasIdeationCard(
  suggestion: IdeationStructuredSuggestion,
  baseX: number,
  baseY: number,
  index: number,
  attachmentMedia: IdeationMediaRecord[],
  timestamp: string,
  parentCardId: string | undefined,
  runId: string,
): IdeationCardRecord {
  const offset = ideationOffsetForAnchor(suggestion.anchor, index);
  const kind = normalizeIdeationKind(suggestion.kind);
  return {
    id: createIdeationId('card'),
    title: clampText(suggestion.title, 80) || 'Atlas insight',
    body: clampText(suggestion.body, 220),
    kind,
    author: 'atlas',
    x: clampNumber(baseX + offset.x, -1600, 1600),
    y: clampNumber(baseY + offset.y, -1200, 1200),
    color: ideationColorForKind(kind),
    imageSources: attachmentMedia.filter(item => item.kind === 'image').map(item => item.source).slice(0, MAX_CARD_MEDIA),
    media: attachmentMedia.slice(0, MAX_CARD_MEDIA),
    tags: kind === 'experiment' ? ['validation'] : [],
    confidence: defaultConfidenceForKind(kind),
    evidenceStrength: defaultEvidenceStrengthForKind(kind),
    riskScore: defaultRiskScoreForKind(kind),
    costToValidate: defaultCostToValidateForKind(kind),
    syncTargets: [],
    ...(parentCardId ? { parentCardId } : {}),
    sourceRunId: runId,
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function ideationOffsetForAnchor(anchor: IdeationAnchor | undefined, index: number): { x: number; y: number } {
  const fallbacks = [
    { x: 220, y: -84 },
    { x: 240, y: 54 },
    { x: 0, y: 200 },
    { x: -240, y: 54 },
    { x: -220, y: -84 },
  ];
  switch (anchor) {
    case 'north': return { x: 0, y: -220 };
    case 'east': return { x: 250, y: (index - 1) * 50 };
    case 'south': return { x: 0, y: 220 };
    case 'west': return { x: -250, y: (index - 1) * 50 };
    case 'center': return { x: 40 * index, y: 40 * index };
    default: return fallbacks[index % fallbacks.length];
  }
}

function ideationColorForKind(kind: IdeationCardKind): string {
  switch (kind) {
    case 'risk': return 'rose';
    case 'problem': return 'rose';
    case 'experiment': return 'storm';
    case 'requirement': return 'sand';
    case 'user-insight': return 'sea';
    case 'evidence': return 'mint';
    case 'atlas-response': return 'sea';
    default: return 'sun';
  }
}

function buildIdeationLinkLabel(kind: IdeationCardKind, index: number): string {
  if (kind === 'risk') {
    return 'mitigates';
  }
  if (kind === 'experiment') {
    return 'validates';
  }
  if (kind === 'requirement') {
    return 'requires';
  }
  if (kind === 'user-insight') {
    return 'reveals';
  }
  return index === 0 ? 'expands' : 'supports';
}

function suggestLinkRelation(fromKind: IdeationCardKind, toKind: IdeationCardKind): IdeationLinkRelation {
  if (toKind === 'risk') {
    return 'contradiction';
  }
  if (toKind === 'experiment') {
    return 'dependency';
  }
  if (fromKind === 'problem' && toKind === 'idea') {
    return 'causal';
  }
  if (toKind === 'user-insight' || toKind === 'evidence') {
    return 'causal';
  }
  if (toKind === 'requirement') {
    return 'dependency';
  }
  return 'opportunity';
}

function buildRunDeltaSummary(focusCard: IdeationCardRecord | undefined, additions: IdeationCardRecord[]): string {
  const kinds = additions.map(card => card.kind).join(', ');
  return focusCard
    ? `Evolved ${focusCard.title} into ${additions.length} descendant card${additions.length === 1 ? '' : 's'} (${kinds || 'no typed additions'}).`
    : `Bootstrapped the board with ${additions.length} Atlas card${additions.length === 1 ? '' : 's'} (${kinds || 'no typed additions'}).`;
}

function buildCardLineage(cards: readonly IdeationCardRecord[], card: IdeationCardRecord): IdeationCardRecord[] {
  const lineage: IdeationCardRecord[] = [card];
  const seen = new Set<string>([card.id]);
  let cursor = card;
  while (cursor.parentCardId) {
    const parent = cards.find(candidate => candidate.id === cursor.parentCardId);
    if (!parent || seen.has(parent.id)) {
      break;
    }
    lineage.unshift(parent);
    seen.add(parent.id);
    cursor = parent;
  }
  return lineage;
}

function mergeTags(existing: readonly string[], incoming: readonly string[]): string[] {
  const next = new Set<string>();
  for (const tag of [...existing, ...incoming]) {
    const normalized = clampText(tag, 24).toLowerCase();
    if (normalized) {
      next.add(normalized);
    }
  }
  return [...next].slice(0, 8);
}

function inferEvidenceTags(media: IdeationMediaRecord): string[] {
  const source = media.source.toLowerCase();
  if (media.kind === 'image') {
    if (source.includes('analytics') || source.includes('chart')) {
      return ['analytics', 'screenshot'];
    }
    if (source.includes('wireframe') || source.includes('sketch')) {
      return ['sketch', 'ui'];
    }
    return ['screenshot'];
  }
  if (source.endsWith('.csv') || source.endsWith('.json')) {
    return ['analytics'];
  }
  if (source.endsWith('.md') || source.endsWith('.txt')) {
    return source.includes('transcript') ? ['transcript'] : ['quote'];
  }
  if (media.kind === 'url') {
    return ['reference'];
  }
  return ['artifact'];
}

function classifyMediaCardKind(media: readonly IdeationMediaRecord[]): IdeationCardKind {
  return media.some(item => item.kind === 'image' || item.kind === 'file' || item.kind === 'url') ? 'evidence' : 'attachment';
}

function buildProjectPromotionPrompt(card: IdeationCardRecord, constraints: IdeationConstraintsRecord, projectMetadataSummary: string): string {
  const constraintsSummary = summarizeIdeationConstraints(constraints);
  return [
    '/project',
    `Turn this ideation card into an execution-ready project plan: ${card.title}.`,
    `Mode: ${card.kind}.`,
    `Notes: ${card.body}`,
    card.tags.length > 0 ? `Tags: ${card.tags.join(', ')}` : '',
    constraintsSummary ? `Constraints: ${constraintsSummary}` : '',
    projectMetadataSummary ? `Project context: ${projectMetadataSummary}` : '',
    `Scores: confidence ${card.confidence}, evidence ${card.evidenceStrength}, risk ${card.riskScore}, cost-to-validate ${card.costToValidate}.`,
    'Produce a tests-first autonomous run plan with validation experiments, risks, and staged delivery.',
  ].filter(Boolean).join('\n');
}

async function readIdeationProjectMetadataSummary(workspaceRoot: string | undefined, ssotPath: string): Promise<string> {
  if (!workspaceRoot) {
    return '';
  }
  const candidates = [
    path.join(workspaceRoot, ssotPath, 'project_soul.md'),
    path.join(workspaceRoot, ssotPath, 'architecture', 'project-overview.md'),
    path.join(workspaceRoot, ssotPath, 'domain', 'product-capabilities.md'),
    path.join(workspaceRoot, 'README.md'),
  ];

  // Cross-project pattern retrieval: scan configured sibling project memory stores.
  const crossProjectPaths = vscode.workspace.getConfiguration('atlasmind').get<string[]>('ideation.crossProjectPaths', []);
  for (const crossPath of crossProjectPaths.slice(0, 3)) {
    const resolved = path.isAbsolute(crossPath) ? crossPath : path.resolve(workspaceRoot, crossPath);
    candidates.push(
      path.join(resolved, 'project_soul.md'),
      path.join(resolved, 'ideas', 'atlas-ideation-board.md'),
    );
  }

  const collected: string[] = [];
  for (const candidate of candidates) {
    try {
      const raw = await fs.readFile(candidate, 'utf-8');
      const normalized = raw.replace(/\r/g, '').split('\n').map(line => line.trim()).filter(Boolean).slice(0, 12).join(' ');
      if (normalized) {
        collected.push(normalized.slice(0, 420));
      }
    } catch {
      // Ignore missing metadata files.
    }
    if (collected.join(' ').length > 1400) {
      break;
    }
  }
  return collected.join('\n\n').slice(0, 1800);
}

function buildIdeationSummaryMarkdown(board: IdeationBoardRecord): string {
  const cards = board.cards.map(card => {
    const media = card.media.length > 0 ? `\n  Media: ${card.media.map(item => item.label).join(', ')}` : '';
    return `- **${card.title}** [${card.kind}] (${card.author})\n  ${card.body || 'No notes yet.'}${media}`;
  }).join('\n');
  const connections = board.connections.map(connection => `- ${connection.fromCardId} -> ${connection.toCardId}${connection.label ? ` (${connection.label})` : ''} [${connection.style}, ${connection.direction}]`).join('\n');
  const prompts = board.nextPrompts.map(prompt => `- ${prompt}`).join('\n');
  return [
    '# AtlasMind Ideation Board',
    '',
    `Updated: ${board.updatedAt}`,
    '',
    '## Latest Atlas feedback',
    '',
    board.lastAtlasResponse || 'No Atlas feedback captured yet.',
    '',
    '## Cards',
    '',
    cards || '- No ideation cards yet.',
    '',
    '## Connections',
    '',
    connections || '- No connections yet.',
    '',
    '## Next prompts',
    '',
    prompts || '- No follow-up prompts yet.',
  ].join('\n');
}

async function buildMediaTextContext(media: readonly IdeationMediaRecord[], workspaceRoot: string | undefined): Promise<string | undefined> {
  if (!workspaceRoot) {
    return undefined;
  }
  const textParts: string[] = [];
  for (const item of media) {
    if (item.kind !== 'file') {
      continue;
    }
    try {
      const uri = vscode.Uri.file(path.resolve(workspaceRoot, item.source));
      const bytes = await vscode.workspace.fs.readFile(uri);
      const text = Buffer.from(bytes).toString('utf8');
      if (!text || text.includes('\0')) {
        continue;
      }
      textParts.push(`[${item.label}]\n${text.slice(0, 2000)}`);
    } catch {
      // Ignore unreadable files.
    }
  }
  return textParts.length > 0 ? textParts.join('\n\n---\n\n') : undefined;
}

function buildEvidenceExtractionContextPacket(card: IdeationCardRecord, board: IdeationBoardRecord): IdeationContextPacketRecord {
  return {
    id: createIdeationPacketId(),
    prompt: clampText(`Extract evidence from: ${card.title}`, 400),
    focusCardId: card.id,
    queuedMedia: card.media.map(item => item.label).slice(0, 12),
    boardSummary: clampText(summarizeIdeationBoard(board), 1200),
    constraintsSummary: clampText(summarizeIdeationConstraints(board.constraints), 320),
    projectMetadataSummary: clampText(board.projectMetadataSummary, 1200),
    lineage: [],
    createdAt: new Date().toISOString(),
  };
}

function buildEvidenceExtractionPrompt(card: IdeationCardRecord, textContext: string | undefined): string {
  return [
    'You are AtlasMind performing a multimodal evidence extraction pass.',
    'Analyze the attached media and text content for this ideation card and extract structured insights.',
    'Convert the key findings into discrete evidence, user-insight, or requirement cards.',
    'Be specific: each card should state one concrete finding, user need, or validated pattern.',
    '',
    `Source card: ${card.title} (${card.kind})`,
    `Notes: ${card.body}`,
    card.tags.length > 0 ? `Tags: ${card.tags.join(', ')}` : '',
    `Media items: ${card.media.map(item => `${item.kind}: ${item.label}`).join(', ')}`,
    textContext ? `\nText content:\n${textContext}` : '',
    '',
    `After the markdown analysis, append a JSON object inside <${IDEATION_RESPONSE_TAG}>...</${IDEATION_RESPONSE_TAG}>:`,
    '{"cards":[{"title":"string","body":"string","kind":"evidence|user-insight|requirement","anchor":"east|south|west"}],"nextPrompts":["string"]}',
    'Return 2 to 5 cards. Each body should state one concrete insight or finding, not a summary.',
    'Prefer evidence cards for data artifacts, user-insight cards for behavioral patterns, requirement cards for clear needs.',
  ].filter(Boolean).join('\n');
}

function buildValidationBriefPrompt(card: IdeationCardRecord, constraints: IdeationConstraintsRecord, projectMetadataSummary: string): string {
  const constraintsSummary = summarizeIdeationConstraints(constraints);
  return [
    'You are AtlasMind generating a structured validation brief.',
    'Turn this ideation card into an actionable validation experiment plan.',
    'Produce a markdown brief followed by structured experiment cards.',
    '',
    `Card: ${card.title} (${card.kind})`,
    `Notes: ${card.body}`,
    card.tags.length > 0 ? `Tags: ${card.tags.join(', ')}` : '',
    constraintsSummary ? `Constraints: ${constraintsSummary}` : '',
    `Scores: confidence ${card.confidence}, risk ${card.riskScore}, cost-to-validate ${card.costToValidate}`,
    projectMetadataSummary ? `Project context: ${projectMetadataSummary}` : '',
    '',
    'The brief must cover:',
    '1. Hypothesis: the specific assumption being tested',
    '2. Success signal: the metric or observation that confirms the hypothesis',
    '3. Failure signal: what would falsify it',
    '4. Test approach: the smallest test to run (survey, prototype, landing page, shadow mode, concierge, wizard-of-oz, etc.)',
    '5. Timeline: realistic time-to-learn estimate',
    '6. Key risks: what might invalidate the test itself',
    '',
    `After the markdown brief, append a JSON object inside <${IDEATION_RESPONSE_TAG}>...</${IDEATION_RESPONSE_TAG}>:`,
    '{"cards":[{"title":"string","body":"string","kind":"experiment|risk|requirement","anchor":"east|south|west|north"}],"nextPrompts":["string"]}',
    'Return 3 to 5 cards decomposing the validation into discrete trackable pieces.',
    'Include at least one experiment card (the test itself) and one risk card (what could go wrong).',
  ].filter(Boolean).join('\n');
}

function buildSsotSyncPrompt(card: IdeationCardRecord, constraints: IdeationConstraintsRecord, projectMetadataSummary: string): string {
  const constraintsSummary = summarizeIdeationConstraints(constraints);
  const targetDescriptions: Record<IdeationSyncTarget, string> = {
    domain: 'product domain knowledge, capabilities, user needs, and product decisions',
    operations: 'operational workflows, development practices, and team conventions',
    agents: 'agent definitions, skill configurations, and automation capabilities',
    'knowledge-graph': 'structured knowledge fragments, concepts, and cross-project cross-references',
  };
  const targetList = card.syncTargets.map(target => `- ${target}: ${targetDescriptions[target]}`).join('\n');
  return [
    'You are AtlasMind generating SSOT project memory entries from an ideation card.',
    'Write concise, actionable content suitable for each specified target area.',
    'The output will be appended to the project memory files for the relevant areas.',
    '',
    `Card: ${card.title} (${card.kind})`,
    `Notes: ${card.body}`,
    card.tags.length > 0 ? `Tags: ${card.tags.join(', ')}` : '',
    constraintsSummary ? `Constraints: ${constraintsSummary}` : '',
    `Scores: confidence ${card.confidence}, evidence ${card.evidenceStrength}, risk ${card.riskScore}`,
    projectMetadataSummary ? `Existing project context:\n${projectMetadataSummary}` : '',
    '',
    'Target sync areas:',
    targetList,
    '',
    'Write a structured markdown section capturing the key insights from this card.',
    'Keep it concise: 2 to 4 paragraphs or a short list of actionable points.',
    'Frame it as knowledge that helps future Atlas runs and team members understand this idea and its implications.',
    'Do not include scores, experimental metadata, or card IDs in the output.',
  ].filter(Boolean).join('\n');
}

function resolveSyncTargetPath(workspaceRoot: string, ssotPath: string, target: IdeationSyncTarget, card: IdeationCardRecord): string {
  switch (target) {
    case 'domain':
      return path.join(workspaceRoot, ssotPath, 'domain', 'product-capabilities.md');
    case 'operations':
      return path.join(workspaceRoot, ssotPath, 'operations', 'development-workflow.md');
    case 'agents':
      return path.join(workspaceRoot, ssotPath, 'architecture', 'agents-and-skills.md');
    case 'knowledge-graph':
      return path.join(workspaceRoot, ssotPath, 'ideas', `knowledge-${slugify(card.title)}.md`);
  }
}

async function appendToSsotFile(filePath: string, card: IdeationCardRecord, content: string, target: IdeationSyncTarget): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const header = `\n\n---\n\n## ${card.title}\n\n_Synced from ideation · ${card.kind} · ${new Date().toLocaleDateString()}_\n\n`;
  const entry = header + content.trim();
  try {
    await fs.access(filePath);
    await fs.appendFile(filePath, entry, 'utf-8');
  } catch {
    const baseName = path.basename(filePath, '.md').replace(/-/g, ' ').replace(/^\w/, c => c.toUpperCase());
    await fs.writeFile(filePath, `# ${target === 'knowledge-graph' ? card.title : baseName}${entry}`, 'utf-8');
  }
}

async function persistValidationBriefFile(workspaceRoot: string | undefined, ssotPath: string, card: IdeationCardRecord, briefContent: string): Promise<void> {
  if (!workspaceRoot) {
    return;
  }
  const dir = path.join(workspaceRoot, ssotPath, 'experiments');
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${slugify(card.title)}.md`);
  const header = [
    `# Validation Brief: ${card.title}`,
    '',
    `_Generated: ${new Date().toISOString()}_`,
    `_Source card: ${card.kind}_`,
    card.tags.length > 0 ? `_Tags: ${card.tags.join(', ')}_` : '',
    '',
  ].filter(Boolean).join('\n');
  await fs.writeFile(filePath, header + briefContent, 'utf-8');
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'card';
}

function findStaleCardIds(cards: readonly IdeationCardRecord[]): string[] {
  const STALE_DAYS = 14;
  const now = Date.now();
  return cards
    .filter(card => !card.archivedAt)
    .filter(card => card.kind === 'experiment' || card.kind === 'risk')
    .filter(card => (now - new Date(card.updatedAt).getTime()) / 86400000 > STALE_DAYS)
    .map(card => card.id);
}

function buildDeepAnalysisPrompt(board: IdeationBoardRecord): string {
  const boardSummary = summarizeIdeationBoard(board);
  return [
    'You are AtlasMind performing a meta-thinking analysis of an ideation board.',
    'Review the entire board holistically and identify:',
    '1. Bias signals: over-indexing on one card type, optimism bias, or echo-chamber patterns',
    '2. Blind spots: missing card types, underrepresented perspectives, gaps in evidence',
    '3. Actionability gaps: ideas without experiments, risks without mitigations, problems without solutions',
    '4. Evidence quality: cards with high confidence but low evidence strength',
    '5. Novelty: potentially redundant or very similar cards worth merging',
    '6. Recommended next focus: the single most valuable move to make on this board right now',
    '',
    'Respond with structured, actionable observations in markdown.',
    '',
    `After the markdown, append a JSON object inside <${IDEATION_RESPONSE_TAG}>...</${IDEATION_RESPONSE_TAG}>:`,
    '{"cards":[{"title":"string","body":"string","kind":"idea|problem|risk|requirement|evidence","anchor":"center|north|east|south|west"}],"nextPrompts":["string"]}',
    'Return 2 to 4 cards surfacing the most important blind spots or gaps.',
    '',
    'Current board:',
    boardSummary,
  ].join('\n');
}

function buildReviewCheckpointPrompt(card: IdeationCardRecord, constraints: IdeationConstraintsRecord, projectMetadataSummary: string): string {
  const constraintsSummary = summarizeIdeationConstraints(constraints);
  return [
    'You are AtlasMind creating a structured review checkpoint for a completed or in-progress experiment.',
    'Generate a review document that captures the current state for future reference and decision-making.',
    '',
    `Card: ${card.title} (${card.kind})`,
    `Notes: ${card.body}`,
    card.tags.length > 0 ? `Tags: ${card.tags.join(', ')}` : '',
    constraintsSummary ? `Constraints: ${constraintsSummary}` : '',
    `Scores: confidence ${card.confidence}, evidence ${card.evidenceStrength}, risk ${card.riskScore}`,
    projectMetadataSummary ? `Project context: ${projectMetadataSummary}` : '',
    '',
    'The checkpoint document must include:',
    '1. Current status: what has been learned or validated so far',
    '2. Decision gate: proceed / pivot / abandon — and the reasoning',
    '3. Outstanding questions: what remains unclear or untested',
    '4. Next actions: concrete steps if proceeding, or lessons if abandoning',
    '5. Risk assessment: updated risk view given current evidence',
    '',
    'Write a clear, scannable markdown document suitable for async team review.',
    'Do not include ideation board JSON. This is a prose checkpoint document only.',
  ].filter(Boolean).join('\n');
}

async function persistReviewCheckpointFile(workspaceRoot: string | undefined, ssotPath: string, card: IdeationCardRecord, checkpointContent: string): Promise<void> {
  if (!workspaceRoot) {
    return;
  }
  const dir = path.join(workspaceRoot, ssotPath, 'checkpoints');
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${slugify(card.title)}-checkpoint.md`);
  const header = [
    `# Review Checkpoint: ${card.title}`,
    '',
    `_Created: ${new Date().toISOString()}_`,
    `_Source card: ${card.kind}_`,
    card.tags.length > 0 ? `_Tags: ${card.tags.join(', ')}_` : '',
    '',
  ].filter(Boolean).join('\n');
  await fs.writeFile(filePath, header + checkpointContent, 'utf-8');
}

function toBudgetMode(value: string | undefined): 'cheap' | 'balanced' | 'expensive' | 'auto' {
  return value === 'cheap' || value === 'balanced' || value === 'expensive' || value === 'auto' ? value : 'balanced';
}

function toSpeedMode(value: string | undefined): 'fast' | 'balanced' | 'considered' | 'auto' {
  return value === 'fast' || value === 'balanced' || value === 'considered' || value === 'auto' ? value : 'balanced';
}

function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown';
  }
  const deltaDays = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (deltaDays <= 0) {
    return 'today';
  }
  if (deltaDays === 1) {
    return '1 day ago';
  }
  if (deltaDays < 30) {
    return `${deltaDays} days ago`;
  }
  const deltaMonths = Math.floor(deltaDays / 30);
  return deltaMonths === 1 ? '1 month ago' : `${deltaMonths} months ago`;
}

function normalizeSsotPath(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  return normalized.length > 0 ? normalized : 'project_memory';
}

const IDEATION_CSS = `
  :root {
    color-scheme: light dark;
  }
  body {
    margin: 0;
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    background: linear-gradient(180deg, color-mix(in srgb, var(--vscode-editor-background) 92%, #10263a 8%), var(--vscode-editor-background));
  }
  .ideation-shell-page {
    min-height: 100vh;
    padding: 24px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .ideation-topbar,
  .row-head,
  .ideation-toolbar,
  .ideation-composer-actions,
  .ideation-chip-row,
  .ideation-status-row,
  .ideation-topbar-actions,
  .ideation-inspector-actions,
  .ideation-card-media,
  .ideation-card-actions {
    display: flex;
    gap: 10px;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
  }
  .dashboard-kicker,
  .section-kicker,
  .card-kicker {
    margin: 0 0 4px;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }
  h1,
  h2,
  h3,
  h4,
  p {
    margin: 0;
  }
  .section-copy,
  .stat-detail,
  .muted,
  .ideation-hint,
  .list-meta {
    color: var(--vscode-descriptionForeground);
    line-height: 1.5;
  }
  .dashboard-button,
  .action-link,
  .ideation-card,
  .ideation-chip,
  .ideation-stat,
  .media-pill,
  .attachment-pill,
  .file-pill {
    border: 1px solid var(--vscode-widget-border, #444);
    border-radius: 14px;
    background: color-mix(in srgb, var(--vscode-editorWidget-background, var(--vscode-sideBar-background)) 88%, transparent);
    color: inherit;
  }
  .dashboard-button,
  .action-link {
    cursor: pointer;
    padding: 9px 14px;
  }
  .action-icon {
    display: inline-block;
    margin-right: 6px;
    font-size: 13px;
    line-height: 1;
  }
  .dashboard-button-solid {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border-color: transparent;
  }
  .dashboard-button-danger {
    background: color-mix(in srgb, #b64444 40%, var(--vscode-button-background));
  }
  .ideation-root {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .ideation-workspace {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .ideation-hero-grid,
  .ideation-main-grid,
  .ideation-lower-grid {
    display: grid;
    gap: 18px;
  }
  .ideation-hero-grid {
    grid-template-columns: 1.25fr 0.75fr;
  }
  .ideation-main-grid {
    grid-template-columns: minmax(320px, 0.9fr) minmax(0, 1.3fr);
  }
  .ideation-lower-grid {
    grid-template-columns: 0.85fr 1.15fr;
  }
  .ideation-panel,
  .panel-card,
  .ideation-stat,
  .dashboard-empty {
    padding: 18px;
    border-radius: 22px;
    border: 1px solid var(--vscode-widget-border, #444);
    background: color-mix(in srgb, var(--vscode-editorWidget-background, var(--vscode-sideBar-background)) 90%, transparent);
    box-shadow: 0 18px 38px rgba(0, 0, 0, 0.14);
  }
  .ideation-stat-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
  }
  .ideation-stat strong {
    display: block;
    font-size: 22px;
    margin-bottom: 6px;
  }
  .ideation-composer-shell {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .ideation-constraint-grid,
  .ideation-score-grid,
  .ideation-sync-grid {
    display: grid;
    gap: 12px;
  }
  .ideation-constraint-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .ideation-score-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .ideation-sync-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .constraint-span {
    grid-column: 1 / -1;
  }
  .ideation-lens-select {
    min-width: 170px;
    padding: 9px 12px;
    border-radius: 12px;
    border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, #444));
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
  }
  .ideation-score-field,
  .ideation-constraint-grid label {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .ideation-validation-block,
  .ideation-sync-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .ideation-validation-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .ideation-check {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .ideation-dropzone,
  .ideation-board-stage,
  .ideation-board-frame,
  .ideation-inspector textarea,
  .ideation-inspector input,
  .ideation-inspector select,
  .ideation-prompt {
    width: 100%;
    box-sizing: border-box;
    border-radius: 16px;
    border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, #444));
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
  }
  .ideation-dropzone {
    padding: 14px;
    border-style: dashed;
  }
  .ideation-dropzone.dragover,
  .ideation-board-stage.dragover {
    border-color: var(--vscode-focusBorder, var(--vscode-button-background));
    background: color-mix(in srgb, var(--vscode-button-background) 12%, transparent);
  }
  .ideation-prompt,
  .ideation-inspector textarea,
  .ideation-inspector input,
  .ideation-inspector select {
    padding: 12px 14px;
    font: inherit;
  }
  .ideation-prompt,
  .ideation-inspector textarea {
    min-height: 112px;
    resize: vertical;
  }
  .ideation-board-stage {
    position: relative;
    min-height: 620px;
    overflow: hidden;
    padding: 12px;
    cursor: grab;
    background:
      radial-gradient(circle at top left, color-mix(in srgb, #7fb3d5 10%, transparent) 0%, transparent 28%),
      linear-gradient(180deg, color-mix(in srgb, var(--vscode-editor-background) 92%, #10263a 8%), color-mix(in srgb, var(--vscode-editor-background) 98%, black 2%));
  }
  .ideation-board-stage:active {
    cursor: grabbing;
  }
  .ideation-board-frame {
    position: relative;
    overflow: hidden;
    border-radius: 18px;
  }
  .ideation-board-world {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 3200px;
    height: 2400px;
    transform: translate(-50%, -50%);
  }
  .ideation-connections {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .ideation-link {
    fill: none;
    stroke: color-mix(in srgb, var(--vscode-button-background) 60%, white 20%);
    stroke-width: 2;
    color: color-mix(in srgb, var(--vscode-button-background) 60%, white 20%);
  }
  .ideation-link.dotted {
    stroke-dasharray: 7 7;
  }
  .ideation-link.solid {
    stroke-dasharray: none;
  }
  .ideation-link-hitbox {
    fill: none;
    stroke: transparent;
    stroke-width: 18;
    cursor: pointer;
  }
  .ideation-link-group.selected .ideation-link {
    stroke: color-mix(in srgb, var(--vscode-focusBorder, var(--vscode-button-background)) 80%, white 20%);
    color: color-mix(in srgb, var(--vscode-focusBorder, var(--vscode-button-background)) 80%, white 20%);
    stroke-width: 2.6;
  }
  .ideation-link-label {
    fill: var(--vscode-descriptionForeground);
    font-size: 12px;
    text-anchor: middle;
    pointer-events: none;
  }
  .ideation-card {
    position: absolute;
    width: 220px;
    padding: 0;
    cursor: pointer;
    text-align: left;
    overflow: hidden;
  }
  .ideation-card.selected {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--vscode-focusBorder, var(--vscode-button-background)) 40%, transparent);
  }
  .ideation-card.focused {
    border-color: color-mix(in srgb, #3a9a5b 64%, white 16%);
  }
  .ideation-card-shell {
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .ideation-card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    cursor: grab;
  }
  .ideation-card-body {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .ideation-card-scoreline {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }
  .ideation-card-scoreline span {
    padding: 4px 6px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--vscode-editor-background) 88%, transparent);
    text-align: center;
  }
  .ideation-card-media img {
    width: 100%;
    max-height: 110px;
    object-fit: cover;
    border-radius: 12px;
    border: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 80%, transparent);
  }
  .media-pill,
  .attachment-pill,
  .file-pill,
  .tag {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    font-size: 12px;
    border-radius: 999px;
  }
  .tag {
    border: 1px solid var(--vscode-widget-border, #444);
    background: color-mix(in srgb, var(--vscode-editor-background) 84%, transparent);
  }
  .tag-good {
    border-color: color-mix(in srgb, #3a9a5b 64%, white 16%);
    color: color-mix(in srgb, #3a9a5b 78%, white 22%);
  }
  .tag-warn {
    border-color: color-mix(in srgb, #d29a2a 64%, white 16%);
    color: color-mix(in srgb, #d29a2a 82%, white 18%);
  }
  .ideation-card-sun { background: linear-gradient(180deg, color-mix(in srgb, #e9c46a 16%, var(--vscode-editorWidget-background)) 0%, color-mix(in srgb, var(--vscode-editorWidget-background) 92%, transparent) 100%); }
  .ideation-card-sea { background: linear-gradient(180deg, color-mix(in srgb, #4ea8de 16%, var(--vscode-editorWidget-background)) 0%, color-mix(in srgb, var(--vscode-editorWidget-background) 92%, transparent) 100%); }
  .ideation-card-mint { background: linear-gradient(180deg, color-mix(in srgb, #52b788 16%, var(--vscode-editorWidget-background)) 0%, color-mix(in srgb, var(--vscode-editorWidget-background) 92%, transparent) 100%); }
  .ideation-card-rose { background: linear-gradient(180deg, color-mix(in srgb, #d97787 16%, var(--vscode-editorWidget-background)) 0%, color-mix(in srgb, var(--vscode-editorWidget-background) 92%, transparent) 100%); }
  .ideation-card-sand { background: linear-gradient(180deg, color-mix(in srgb, #d4a373 16%, var(--vscode-editorWidget-background)) 0%, color-mix(in srgb, var(--vscode-editorWidget-background) 92%, transparent) 100%); }
  .ideation-card-storm { background: linear-gradient(180deg, color-mix(in srgb, #6c757d 18%, var(--vscode-editorWidget-background)) 0%, color-mix(in srgb, var(--vscode-editorWidget-background) 92%, transparent) 100%); }
  .ideation-empty-state,
  .dashboard-empty {
    min-height: 180px;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
  }
  .ideation-history-list,
  .ideation-response-box,
  .ideation-chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .ideation-history-list {
    flex-direction: column;
  }
  .ideation-response-box {
    white-space: pre-wrap;
    padding: 14px;
    border-radius: 16px;
    border: 1px solid var(--vscode-widget-border, #444);
    background: color-mix(in srgb, var(--vscode-editor-background) 86%, transparent);
    line-height: 1.6;
  }
  .ideation-chip {
    padding: 7px 12px;
    cursor: pointer;
  }
  .ideation-inline-editor {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .ideation-inline-editor input,
  .ideation-inline-editor textarea {
    width: 100%;
    box-sizing: border-box;
    font: inherit;
    border-radius: 12px;
    border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, #444));
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    padding: 10px 12px;
  }
  .ideation-inline-editor textarea {
    min-height: 84px;
    resize: vertical;
  }
  .ideation-edge-glow {
    position: absolute;
    pointer-events: none;
    opacity: 0;
    transition: opacity 120ms ease;
    z-index: 2;
  }
  .ideation-edge-glow.active {
    opacity: 1;
  }
  .ideation-edge-glow-top,
  .ideation-edge-glow-bottom {
    left: 10%;
    right: 10%;
    height: 22px;
  }
  .ideation-edge-glow-left,
  .ideation-edge-glow-right {
    top: 10%;
    bottom: 10%;
    width: 22px;
  }
  .ideation-edge-glow-top {
    top: 0;
    background: linear-gradient(180deg, color-mix(in srgb, var(--vscode-button-background) 40%, transparent), transparent);
  }
  .ideation-edge-glow-right {
    right: 0;
    background: linear-gradient(270deg, color-mix(in srgb, var(--vscode-button-background) 40%, transparent), transparent);
  }
  .ideation-edge-glow-bottom {
    bottom: 0;
    background: linear-gradient(0deg, color-mix(in srgb, var(--vscode-button-background) 40%, transparent), transparent);
  }
  .ideation-edge-glow-left {
    left: 0;
    background: linear-gradient(90deg, color-mix(in srgb, var(--vscode-button-background) 40%, transparent), transparent);
  }
  body.canvas-focus-mode .ideation-topbar,
  body.canvas-focus-mode .ideation-hero-grid,
  body.canvas-focus-mode .ideation-composer-panel,
  body.canvas-focus-mode .ideation-lower-grid,
  body.canvas-focus-mode .ideation-analytics-section {
    display: none;
  }
  body.canvas-focus-mode .ideation-shell-page {
    padding: 0;
  }
  body.canvas-focus-mode .ideation-root,
  body.canvas-focus-mode .ideation-workspace,
  body.canvas-focus-mode .ideation-main-grid {
    display: block;
    height: 100vh;
  }
  body.canvas-focus-mode .ideation-canvas-panel {
    min-height: 100vh;
    height: 100vh;
    border-radius: 0;
    padding: 18px;
    border: none;
    box-shadow: none;
  }
  body.canvas-focus-mode .ideation-board-stage {
    min-height: calc(100vh - 148px);
  }
  @media (max-width: 1180px) {
    .ideation-hero-grid,
    .ideation-main-grid,
    .ideation-lower-grid,
    .ideation-stat-grid,
    .ideation-constraint-grid,
    .ideation-score-grid,
    .ideation-sync-grid {
      grid-template-columns: 1fr;
    }
  }
  .ideation-analytics-section {
    margin-top: 0;
  }
  .ideation-analytics-panel {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .ideation-analytics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 14px;
  }
  .ideation-dist-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .ideation-dist-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .ideation-dist-bar-wrap {
    flex: 1;
    height: 6px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--vscode-widget-border, #444) 40%, transparent);
    overflow: hidden;
  }
  .ideation-dist-bar {
    height: 100%;
    background: var(--vscode-button-background);
    border-radius: 4px;
    min-width: 4px;
  }
  .ideation-score-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .ideation-check {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }
  .ideation-sync-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 6px;
  }
  .ideation-constraint-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .constraint-span {
    grid-column: span 2;
  }
  @media (max-width: 640px) {
    .ideation-shell-page {
      padding: 16px;
    }
    .ideation-board-stage {
      min-height: 500px;
    }
    .ideation-card {
      width: 200px;
    }
    .ideation-analytics-grid {
      grid-template-columns: 1fr;
    }
  }
`;
