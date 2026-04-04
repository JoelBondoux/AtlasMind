import * as path from 'path';
import * as vscode from 'vscode';
import type { TaskImageAttachment } from '../types.js';

const MAX_IMAGE_ATTACHMENTS = 4;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
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

export async function resolveInlineImageAttachments(prompt: string): Promise<TaskImageAttachment[]> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    return [];
  }

  const attachments: TaskImageAttachment[] = [];
  for (const candidate of extractImagePathCandidates(prompt)) {
    const attachment = await loadImageAttachment(candidate, workspaceRoot);
    if (attachment) {
      attachments.push(attachment);
    }
  }
  return attachments;
}

export async function resolvePickedImageAttachments(uris: readonly vscode.Uri[]): Promise<TaskImageAttachment[]> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    return [];
  }

  const attachments: TaskImageAttachment[] = [];
  for (const uri of uris.slice(0, MAX_IMAGE_ATTACHMENTS)) {
    const attachment = await loadImageAttachment(uri.fsPath, workspaceRoot);
    if (attachment) {
      attachments.push(attachment);
    }
  }

  return attachments;
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

async function loadImageAttachment(candidatePath: string, workspaceRoot: string): Promise<TaskImageAttachment | undefined> {
  const resolvedPath = resolvePromptPathCandidate(candidatePath, workspaceRoot);
  if (!resolvedPath) {
    return undefined;
  }

  const mimeType = IMAGE_MIME_BY_EXTENSION[path.extname(resolvedPath).toLowerCase()];
  if (!mimeType) {
    return undefined;
  }

  try {
    const uri = vscode.Uri.file(resolvedPath);
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.size > MAX_IMAGE_BYTES) {
      return undefined;
    }

    const bytes = await vscode.workspace.fs.readFile(uri);
    return {
      source: vscode.workspace.asRelativePath(uri, false),
      mimeType,
      dataBase64: Buffer.from(bytes).toString('base64'),
    };
  } catch {
    return undefined;
  }
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