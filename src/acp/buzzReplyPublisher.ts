/**
 * Buzz-specific delivery for AtlasMind's agent-side ACP endpoint.
 *
 * buzz-acp supplies a structured `[Context]` block and expects the agent to
 * publish its answer with `buzz messages send`. AtlasMind does that
 * deterministically through the existing communication-only bridge instead of
 * handing Buzz's shell/file-edit MCP surface to the model.
 */
import type { BuzzCliBridge } from '../mcp/buzzCliBridge.js';

const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const EVENT_ID_PATTERN = '[0-9a-f]{64}';
const MAX_BUZZ_ACP_PROMPT_CHARS = 2_000_000;

export interface BuzzReplyTarget {
  channelId: string;
  replyTo: string;
}

export interface AcpReplyPublisher {
  publish(prompt: string, response: string, signal?: AbortSignal): Promise<boolean>;
}

/**
 * Read only buzz-acp's generated `[Context]` section.
 *
 * Message content appears later in `[Event]`, so a human cannot create a fake
 * destination by pasting `Channel:` or `--reply-to` into their message.
 * The reply anchor must also be named by the generated event/thread metadata.
 */
export function parseBuzzReplyTarget(prompt: string): BuzzReplyTarget | undefined {
  if (!prompt || prompt.length > MAX_BUZZ_ACP_PROMPT_CHARS) {
    return undefined;
  }

  const contextStart = prompt.search(/(?:^|\n)\[Context\]\r?\n/);
  if (contextStart < 0) {
    return undefined;
  }
  const contextBodyStart = prompt.indexOf('\n', contextStart) + 1;
  const nextSection = prompt.slice(contextBodyStart).search(/\r?\n\[[^\]\r\n]{1,80}\]\r?\n/);
  if (nextSection < 0) {
    return undefined;
  }
  const context = prompt.slice(contextBodyStart, contextBodyStart + nextSection);
  if (!/^Scope: (?:channel|thread|dm)$/m.test(context)) {
    return undefined;
  }

  const channelMatch = context.match(new RegExp(
    `^Channel:\\s*(?:[^\\r\\n#]{1,160}\\s+\\(#(${UUID_PATTERN})\\)|(${UUID_PATTERN}))\\s*$`,
    'im',
  ));
  const replyMatches = [...context.matchAll(new RegExp(`--reply-to\\s+(${EVENT_ID_PATTERN})(?=[\\s\`'".,;]|$)`, 'ig'))];
  const channelId = (channelMatch?.[1] ?? channelMatch?.[2] ?? '').toLowerCase();
  const replyTo = (replyMatches[0]?.[1] ?? '').toLowerCase();
  if (!channelId || !replyTo || replyMatches.length !== 1) {
    return undefined;
  }

  const generatedMetadata = prompt.slice(contextBodyStart + nextSection);
  const metadataIds = [
    ...generatedMetadata.matchAll(new RegExp(`^(?:Event ID|Thread root):\\s*(${EVENT_ID_PATTERN})\\s*$`, 'igm')),
  ].map(match => match[1]?.toLowerCase());
  if (!metadataIds.includes(replyTo)) {
    return undefined;
  }
  return { channelId, replyTo };
}

export class BuzzAcpReplyPublisher implements AcpReplyPublisher {
  constructor(private readonly bridge: Pick<BuzzCliBridge, 'postMessage'>) {}

  async publish(prompt: string, response: string, signal?: AbortSignal): Promise<boolean> {
    const target = parseBuzzReplyTarget(prompt);
    if (!target) {
      return false;
    }
    await this.bridge.postMessage(target.channelId, response, target.replyTo, signal);
    return true;
  }
}
