import * as path from 'path';
import * as vscode from 'vscode';
import type { TaskImageAttachment } from '../types.js';

import { MAX_IMAGE_ATTACHMENTS, MAX_IMAGE_BYTES } from '../constants.js';
const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export function extractImagePathCandidates(prompt: string): string[] {
  const candidates = new Set<string>();
  const quotedMatches = prompt.matchAll(/["']([^"'\r\n]+\.(?:png|jpe?g|gif|webp))["']/gi);
  for (const match of quotedMatches) {
    const candidate = normalizeImageCandidate(match[1]);
    if (candidate) {
      candidates.add(candidate);
    }
  }

  const unquotedMatches = prompt.matchAll(/(?:[A-Za-z]:[\\/]|\.{0,2}[\\/]|(?:[\w.-]+[\\/]))[^"'\r\n]+?\.(?:png|jpe?g|gif|webp)\b/gi);
  for (const match of unquotedMatches) {
    const candidate = normalizeImageCandidate(match[0]);
    if (candidate) {
      candidates.add(candidate);
    }
  }

  const bareMatches = prompt.matchAll(/\b[\w.-]+\.(?:png|jpe?g|gif|webp)\b/gi);
  for (const match of bareMatches) {
    const candidate = normalizeImageCandidate(match[0]);
    if (candidate && !hasContainingPath(candidates, candidate)) {
      candidates.add(candidate);
    }
  }

  return [...candidates].slice(0, MAX_IMAGE_ATTACHMENTS);
}

/**
 * Inline resolution, with the rejections kept.
 *
 * A path *mentioned* in a prompt is a guess about intent, so a rejection here is
 * reported only when the operator plainly named an image file — which is what
 * `extractImagePathCandidates` already matches on. An `outside-workspace` miss
 * is dropped rather than reported: prose frequently names a path that is not
 * meant as an attachment, and complaining about it would make ordinary sentences
 * produce warnings.
 */
export async function resolveInlineImageAttachmentsDetailed(prompt: string): Promise<ImageAttachmentResolution> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    return { attachments: [], rejections: [] };
  }

  const attachments: TaskImageAttachment[] = [];
  const rejections: ImageAttachmentRejection[] = [];
  for (const candidate of extractImagePathCandidates(prompt)) {
    const result = await loadImageAttachment(candidate, workspaceRoot);
    if (isRejection(result)) {
      if (result.reason !== 'outside-workspace' && result.reason !== 'unsupported-type') {
        rejections.push(result);
      }
      continue;
    }
    attachments.push(result);
  }
  return { attachments, rejections };
}

export async function resolveInlineImageAttachments(prompt: string): Promise<TaskImageAttachment[]> {
  return (await resolveInlineImageAttachmentsDetailed(prompt)).attachments;
}

/**
 * Picked resolution. Every rejection is reported here, including the two the
 * inline path drops: the operator chose these files in a dialog, so there is no
 * ambiguity about whether they meant to attach them.
 */
export async function resolvePickedImageAttachmentsDetailed(
  uris: readonly vscode.Uri[],
): Promise<ImageAttachmentResolution> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    return { attachments: [], rejections: [] };
  }

  const attachments: TaskImageAttachment[] = [];
  const rejections: ImageAttachmentRejection[] = [];
  for (const uri of uris.slice(0, MAX_IMAGE_ATTACHMENTS)) {
    const result = await loadImageAttachment(uri.fsPath, workspaceRoot);
    if (isRejection(result)) {
      rejections.push(result);
      continue;
    }
    attachments.push(result);
  }

  return { attachments, rejections };
}

export async function resolvePickedImageAttachments(uris: readonly vscode.Uri[]): Promise<TaskImageAttachment[]> {
  return (await resolvePickedImageAttachmentsDetailed(uris)).attachments;
}

type SessionEntryForCarryForward = {
  role: 'user' | 'assistant';
  meta?: {
    promptAttachments?: Array<{
      kind: string;
      source: string;
      mimeType?: string;
      previewDataUri?: string;
    }>;
  };
};

/**
 * Extracts image attachments from the most recent prior user message in the
 * session transcript that contained images. Used to carry forward visual context
 * across follow-up turns when the user has not attached new images.
 *
 * The caller is responsible for passing a transcript that excludes the current
 * in-flight user message (i.e. slice off the last entry if it was just appended).
 *
 * @param priorTranscript - Session entries NOT including the current turn
 * @param maxTurnsBack    - How many prior user turns to search (default: 2)
 */
export function extractSessionCarryForwardImages(
  priorTranscript: SessionEntryForCarryForward[],
  maxTurnsBack = 2,
): TaskImageAttachment[] {
  const userEntries = priorTranscript.filter(entry => entry.role === 'user');
  const lookbackEntries = userEntries.slice(-maxTurnsBack).reverse();

  for (const entry of lookbackEntries) {
    const images: TaskImageAttachment[] = [];
    for (const attachment of entry.meta?.promptAttachments ?? []) {
      if (
        attachment.kind === 'image'
        && attachment.previewDataUri
        && attachment.mimeType
      ) {
        const match = /^data:[^;]+;base64,(.+)$/.exec(attachment.previewDataUri);
        if (match) {
          images.push({
            source: attachment.source,
            mimeType: attachment.mimeType,
            dataBase64: match[1],
          });
        }
      }
    }
    if (images.length > 0) {
      return images;
    }
  }
  return [];
}

export function mergeImageAttachments(
  explicitAttachments: TaskImageAttachment[],
  inlineAttachments: TaskImageAttachment[],
): TaskImageAttachment[] {
  const merged: TaskImageAttachment[] = [];
  const seen = new Set<string>();

  for (const attachment of [...explicitAttachments, ...inlineAttachments]) {
    const key = `${attachment.source}:${attachment.mimeType}:${attachment.dataBase64.length}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(attachment);
    if (merged.length >= MAX_IMAGE_ATTACHMENTS) {
      break;
    }
  }

  return merged;
}

/**
 * Why an image the operator named was not sent.
 *
 * Every one of these used to be a bare `undefined`, so a 5 MB screenshot, a
 * `.bmp`, a path outside the workspace and an unreadable file were all
 * indistinguishable from "no image mentioned" — the turn simply answered without
 * looking at the picture, and nothing said so. That is the worst-shaped failure
 * available here: the operator believes the model saw what they saw.
 */
export type ImageAttachmentRejection = {
  source: string;
  reason: 'outside-workspace' | 'unsupported-type' | 'too-large' | 'unreadable';
  detail?: string;
};

export interface ImageAttachmentResolution {
  attachments: TaskImageAttachment[];
  rejections: ImageAttachmentRejection[];
}

/** One line per rejection, or nothing at all when every image loaded. */
export function describeImageRejections(rejections: readonly ImageAttachmentRejection[]): string | undefined {
  if (rejections.length === 0) {
    return undefined;
  }
  const lines = rejections.map(rejection => {
    switch (rejection.reason) {
      case 'too-large':
        return `- \`${rejection.source}\` is larger than ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} MB and was not sent.`;
      case 'unsupported-type':
        return `- \`${rejection.source}\` is not a supported image type (PNG, JPEG, GIF or WebP).`;
      case 'outside-workspace':
        return `- \`${rejection.source}\` is outside this workspace, so it was not read.`;
      default:
        return `- \`${rejection.source}\` could not be read${rejection.detail ? `: ${rejection.detail}` : '.'}`;
    }
  });
  return [
    rejections.length === 1 ? '**One image was not attached:**' : `**${rejections.length} images were not attached:**`,
    ...lines,
  ].join('\n');
}

async function loadImageAttachment(
  candidatePath: string,
  workspaceRoot: string,
): Promise<TaskImageAttachment | ImageAttachmentRejection> {
  const resolvedPath = resolvePromptPathCandidate(candidatePath, workspaceRoot);
  if (!resolvedPath) {
    return { source: candidatePath, reason: 'outside-workspace' };
  }

  const mimeType = IMAGE_MIME_BY_EXTENSION[path.extname(resolvedPath).toLowerCase()];
  if (!mimeType) {
    return { source: candidatePath, reason: 'unsupported-type' };
  }

  try {
    const uri = vscode.Uri.file(resolvedPath);
    const relative = vscode.workspace.asRelativePath(uri, false);
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.size > MAX_IMAGE_BYTES) {
      return { source: relative, reason: 'too-large' };
    }

    const bytes = await vscode.workspace.fs.readFile(uri);
    return {
      source: relative,
      mimeType,
      dataBase64: Buffer.from(bytes).toString('base64'),
    };
  } catch (error) {
    return {
      source: candidatePath,
      reason: 'unreadable',
      ...(error instanceof Error ? { detail: error.message } : {}),
    };
  }
}

function isRejection(value: TaskImageAttachment | ImageAttachmentRejection): value is ImageAttachmentRejection {
  return 'reason' in value;
}

function resolvePromptPathCandidate(candidatePath: string, workspaceRoot: string): string | undefined {
  const root = path.resolve(workspaceRoot);
  const resolved = path.isAbsolute(candidatePath)
    ? path.resolve(candidatePath)
    : path.resolve(root, candidatePath);

  if (resolved === root || resolved.startsWith(`${root}${path.sep}`)) {
    return resolved;
  }

  return undefined;
}

function normalizeImageCandidate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().replace(/[),.;:]+$/g, '');
  return normalized.length > 0 ? normalized : undefined;
}

function hasContainingPath(candidates: Set<string>, candidate: string): boolean {
  for (const existing of candidates) {
    if (existing === candidate) {
      return true;
    }
    if (existing.endsWith(candidate) && existing.length > candidate.length) {
      return true;
    }
    if (existing.endsWith(`/${candidate}`) || existing.endsWith(`\\${candidate}`)) {
      return true;
    }
  }
  return false;
}