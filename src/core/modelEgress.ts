/**
 * The one place prompt content is cleared for transmission.
 *
 * Before this existed there were 21 prompt-bearing provider calls across 8
 * feature files, and exactly one of those files referenced the redactor. The
 * boundary was a convention every caller had to remember, and it had already
 * been forgotten seven times. Whether those seven leaked in practice is a
 * separate question from whether anything *stopped* them — nothing did, and that
 * is what this replaces. See `docs/security-data-flow.md` §1.
 *
 * Seven rules.
 *
 * **Context is labelled by origin, not pooled into strings.** A prompt is not
 * one blob: a system instruction we wrote, a file read out of the workspace, and
 * a tool result returned by somebody else's server carry different risk and want
 * different handling. Once concatenated that distinction cannot be recovered,
 * so it is carried structurally and decided per part.
 *
 * **Repository-derived context is redacted; user-authored prompts are not
 * silently rewritten.** Quietly editing what somebody typed means they believe
 * they sent one thing and sent another. A secret-shaped value in a user prompt
 * therefore *stops* and asks, rather than being scrubbed on their behalf.
 *
 * **An unknown origin fails closed.** In development and tests an unlabelled
 * part throws; in production it is treated as the most sensitive class rather
 * than the least. A new call site that forgets to label its context must be
 * loud in the place that can fix it and safe in the place that cannot.
 *
 * **Images cannot honestly be described as text-redacted.** They are passed
 * through unmodified, the destination is recorded, and the user's explicit
 * submission is treated as consent for that image only — never as standing
 * permission for a later one.
 *
 * **Trusted never exempts credentials.** A model the privacy policy trusts with
 * classified project data still does not need an API key, and no classification
 * turns credential redaction off.
 *
 * **Logs carry categories, never content.** Origin, provider, model, how many
 * redactions and which rules fired — never a matched value, never a prompt body.
 * A log that helps you debug a leak by reproducing it is not a safety feature.
 *
 * **Size limits are per origin.** A 4 000-character memory file and a two-line
 * user question are not the same risk and should not share a ceiling.
 *
 * Pure: no `vscode`, no `fs`, no network. The dispatcher that uses it lives
 * alongside; this module only decides.
 */

import type { CompletionRequest, CompletionResponse } from '../providers/adapter.js';
import { redactSecrets } from '../utils/secretRedactor.js';

/**
 * Where a piece of prompt content came from.
 *
 * Deliberately a closed union with no `string` escape hatch: an origin somebody
 * invents at a call site is exactly the unlabelled context this exists to
 * refuse.
 */
export type ModelContextOrigin =
  | 'user-prompt'
  | 'system-prompt'
  | 'session-context'
  | 'native-chat-context'
  | 'attachment'
  | 'workspace-file'
  | 'tool-result'
  | 'project-memory'
  | 'background-memory'
  | 'generated-instruction'
  | 'image-attachment';

export interface OriginTaggedText {
  origin: ModelContextOrigin;
  text: string;
}

interface OriginRule {
  /** Credential patterns are stripped before transmission. */
  redact: boolean;
  /** A secret here stops and asks rather than being rewritten. */
  confirmOnSecret: boolean;
  /** Maximum characters transmitted for one part of this origin. */
  maxChars: number;
  /** Human-readable, published wherever the policy is explained. */
  description: string;
}

/**
 * The policy, declared rather than scattered through conditionals.
 *
 * `user-prompt` is the only origin that confirms instead of redacting;
 * `image-attachment` is the only one that does neither, because it cannot.
 */
export const ORIGIN_POLICY: Readonly<Record<ModelContextOrigin, OriginRule>> = {
  'user-prompt': {
    redact: false,
    confirmOnSecret: true,
    maxChars: 200_000,
    description: 'What the operator typed. Never silently rewritten; a secret-shaped value stops and asks.',
  },
  'system-prompt': {
    redact: false,
    confirmOnSecret: false,
    maxChars: 200_000,
    description: 'Instructions AtlasMind authored. Not derived from the repository.',
  },
  'session-context': {
    redact: true,
    confirmOnSecret: false,
    maxChars: 60_000,
    description: 'Earlier turns of this conversation.',
  },
  'native-chat-context': {
    redact: true,
    confirmOnSecret: false,
    maxChars: 60_000,
    description: 'Context supplied by the editor’s own chat surface.',
  },
  attachment: {
    redact: true,
    confirmOnSecret: false,
    maxChars: 60_000,
    description: 'A file or excerpt the operator attached.',
  },
  'workspace-file': {
    redact: true,
    confirmOnSecret: false,
    maxChars: 60_000,
    description: 'Content read out of the repository.',
  },
  'tool-result': {
    redact: true,
    confirmOnSecret: false,
    maxChars: 40_000,
    description: 'Output of a tool, including third-party servers. Untrusted text.',
  },
  'project-memory': {
    redact: true,
    confirmOnSecret: false,
    maxChars: 40_000,
    description: 'Retrieved SSOT entries.',
  },
  'background-memory': {
    redact: true,
    confirmOnSecret: false,
    maxChars: 8_000,
    description: 'Memory content gathered by a background task, with no operator in the loop.',
  },
  'generated-instruction': {
    redact: true,
    confirmOnSecret: false,
    maxChars: 40_000,
    description: 'Text a model produced that is being fed back to a model.',
  },
  'image-attachment': {
    redact: false,
    confirmOnSecret: false,
    maxChars: Number.MAX_SAFE_INTEGER,
    description: 'Binary image content. Cannot be text-redacted; the destination is recorded instead.',
  },
};

/** What was done to one part, for the log. Carries no content. */
export interface EgressPartAudit {
  origin: ModelContextOrigin;
  redactedCount: number;
  /** Names of the patterns that fired, e.g. `github-token`. Never the matched text. */
  redactedRules: readonly string[];
  /** True when the part was cut to its origin's limit. */
  truncated: boolean;
  /** True for content that cannot be inspected, i.e. images. */
  opaque: boolean;
}

export type EgressPreparation =
  | {
      status: 'ready';
      parts: readonly OriginTaggedText[];
      audit: readonly EgressPartAudit[];
      /** True when any part is an image, so a caller can surface the destination. */
      carriesOpaqueContent: boolean;
    }
  | {
      status: 'needs-confirmation';
      origin: ModelContextOrigin;
      /** Rule names that matched, so the prompt can say what kind of secret. */
      redactedRules: readonly string[];
      reason: string;
      /** The same parts with the offending origin redacted, for a "send redacted" option. */
      redactedAlternative: readonly OriginTaggedText[];
    }
  | { status: 'refused'; reason: string };

export interface EgressOptions {
  /**
   * Throw on an unlabelled or unknown origin rather than degrading.
   *
   * True under the test runner and when `ATLASMIND_STRICT_EGRESS=1`, so a new
   * call site that forgets to label its context fails where somebody can fix
   * it. False in a shipped extension, where the same part is treated as the
   * most sensitive class instead — loud where it helps, safe where it does not.
   *
   * Deliberately not keyed on `NODE_ENV`: VS Code leaves it unset in the
   * extension host, so a `!== 'production'` test is true for every user and
   * would arm the tripwire in exactly the place it must not fire.
   */
  strictOrigins: boolean;
  /**
   * True when the destination is not on this machine.
   *
   * Only affects whether a user-prompt secret stops and asks: sending your own
   * key to a model running on your own hardware is not an exfiltration, and
   * prompting for it would train people to click through the dialog that
   * matters.
   */
  external: boolean;
}

function ruleFor(origin: ModelContextOrigin, options: EgressOptions): OriginRule {
  const rule = ORIGIN_POLICY[origin] as OriginRule | undefined;
  if (rule) { return rule; }
  if (options.strictOrigins) {
    throw new Error(
      `Model egress: unknown context origin "${String(origin)}". `
      + 'Label the part with a declared ModelContextOrigin — an unlabelled origin cannot be policed.',
    );
  }
  // Fail closed: unknown is treated as the most restrictive text class, not the
  // least. Redacted, confirmed on secret, and held to the smallest limit.
  return {
    redact: true,
    confirmOnSecret: true,
    maxChars: 8_000,
    description: 'Unknown origin, treated as the most sensitive class.',
  };
}

/**
 * Clear a set of origin-tagged parts for transmission.
 *
 * Returns the parts to send, an audit that is safe to log, or a stop. Never
 * mutates its input.
 */
export function prepareEgress(
  parts: readonly OriginTaggedText[],
  options: EgressOptions,
): EgressPreparation {
  const prepared: OriginTaggedText[] = [];
  const audit: EgressPartAudit[] = [];
  let carriesOpaqueContent = false;

  for (const part of parts) {
    const rule = ruleFor(part.origin, options);

    if (part.origin === 'image-attachment') {
      carriesOpaqueContent = true;
      prepared.push(part);
      audit.push({ origin: part.origin, redactedCount: 0, redactedRules: [], truncated: false, opaque: true });
      continue;
    }

    // Detection runs on every part, including those that are not rewritten:
    // a user prompt is not redacted but still has to be *checked*.
    const scan = redactSecrets(part.text);

    if (rule.confirmOnSecret && scan.redactedCount > 0 && options.external) {
      return {
        status: 'needs-confirmation',
        origin: part.origin,
        redactedRules: scan.redactedTypes,
        reason:
          `What you typed looks like it contains a credential (${scan.redactedTypes.join(', ')}), `
          + 'and this request goes to an external provider. AtlasMind will not rewrite your prompt without asking.',
        redactedAlternative: parts.map(other =>
          other === part ? { origin: other.origin, text: scan.text } : other),
      };
    }

    const text = rule.redact ? scan.text : part.text;
    const truncated = text.length > rule.maxChars;
    prepared.push({ origin: part.origin, text: truncated ? text.slice(0, rule.maxChars) : text });
    audit.push({
      origin: part.origin,
      redactedCount: rule.redact ? scan.redactedCount : 0,
      redactedRules: rule.redact ? scan.redactedTypes : [],
      truncated,
      opaque: false,
    });
  }

  return { status: 'ready', parts: prepared, audit, carriesOpaqueContent };
}

/**
 * One log line per dispatch, safe to write anywhere.
 *
 * Built here rather than at call sites so no surface can invent its own format
 * and include the thing this omits.
 */
export function describeEgressAudit(
  audit: readonly EgressPartAudit[],
  providerId: string,
  model: string,
): string {
  const redactions = audit.reduce((total, part) => total + part.redactedCount, 0);
  const rules = [...new Set(audit.flatMap(part => part.redactedRules))];
  const truncatedOrigins = audit.filter(part => part.truncated).map(part => part.origin);
  const opaque = audit.filter(part => part.opaque).length;

  const bits = [
    `provider=${providerId}`,
    `model=${model}`,
    `parts=${audit.length}`,
    `redactions=${redactions}`,
  ];
  if (rules.length > 0) { bits.push(`rules=${rules.join('|')}`); }
  if (truncatedOrigins.length > 0) { bits.push(`truncated=${truncatedOrigins.join('|')}`); }
  if (opaque > 0) { bits.push(`images=${opaque}`); }
  return `[AtlasMind] model egress: ${bits.join(' ')}`;
}

export class ModelEgressRefused extends Error {
  constructor(
    readonly origin: ModelContextOrigin | undefined,
    readonly redactedRules: readonly string[],
    message: string,
  ) {
    super(message);
    this.name = 'ModelEgressRefused';
  }
}

/**
 * The minimum a destination must expose.
 *
 * Structural rather than `ProviderAdapter`, because the boundary needs exactly
 * two things — somewhere to send, and a name for the audit line. Demanding the
 * full adapter would push callers holding a narrower handle into casting around
 * the gate, which is the one thing it must not encourage.
 */
export interface EgressDestination {
  providerId?: string;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  /**
   * Optional streaming form.
   *
   * Declared here so a streaming caller does not have to reach past the
   * boundary to get one. A path that had to call the provider directly in
   * order to stream would be an unlabelled path, and the commonest one.
   */
  streamComplete?(request: CompletionRequest, onTextChunk: (chunk: string) => void): Promise<CompletionResponse>;
}

export interface GuardedCompletionInput {
  provider: EgressDestination;
  request: CompletionRequest;
  /**
   * What each message is, positionally.
   *
   * Positional rather than inferred, because guessing an origin from a role is
   * exactly the unlabelled context this module exists to refuse: `role: 'user'`
   * is used both for what the operator typed and for a workspace file pasted
   * into a prompt, and those are not the same risk. A shorter list than
   * `messages` leaves the remainder unlabelled, which fails closed.
   */
  origins: readonly (ModelContextOrigin | undefined)[];
  /** True when the provider is not on this machine. */
  external: boolean;
  /**
   * Stream the response, when the destination can.
   *
   * Falls back to a whole-response completion rather than refusing: streaming
   * is a delivery detail, and failing a turn over it would push callers back
   * to the direct provider call this replaces.
   */
  onTextChunk?: (chunk: string) => void;
  strictOrigins?: boolean;
  /** Receives one content-free audit line per dispatch. */
  onAudit?: (line: string) => void;
  /**
   * Asked when a user-authored prompt carries a secret bound off-machine.
   *
   * Absent means **refuse**: a path with no way to ask a human is not a path
   * that may answer on their behalf. Background work therefore cannot send a
   * prompt containing a credential, which is the correct outcome rather than an
   * inconvenience.
   */
  confirmSecret?: EgressSecretConfirmer;
}

/**
 * Asks a human whether a credential in their own prompt may leave the machine.
 *
 * Named so a host can hold one without importing the whole input shape, and so
 * the three answers are stated in one place: send it, send it redacted, or do
 * not send at all.
 */
export type EgressSecretConfirmer = (
  details: { origin: ModelContextOrigin; rules: readonly string[]; reason: string },
) => Promise<'send-original' | 'send-redacted' | 'cancel'>;

/**
 * The single guarded path to a provider.
 *
 * Every prompt-bearing call should arrive here. `tests/security/modelEgressBoundary.test.ts`
 * fails when one does not, and ratchets, so the list of exceptions can only
 * shrink.
 */
export async function dispatchGuardedCompletion(
  input: GuardedCompletionInput,
): Promise<CompletionResponse> {
  // Keyed on signals that exist here. The first version read
  // `NODE_ENV !== 'production'`, which is true in a *shipped* extension —
  // VS Code does not set NODE_ENV in the extension host — so the developer
  // tripwire was armed for real users and the documented production
  // behaviour below was unreachable. A missed label should degrade to the
  // most restrictive class for somebody using the product, and stop the
  // build for somebody writing it.
  const strictOrigins = input.strictOrigins
    ?? (process.env['VITEST'] !== undefined || process.env['ATLASMIND_STRICT_EGRESS'] === '1');

  const parts: OriginTaggedText[] = input.request.messages.map((message, index) => ({
    // An index past the supplied origins is deliberately not defaulted to
    // something benign: `undefined` reaches `ruleFor`, which fails closed.
    origin: input.origins[index] as ModelContextOrigin,
    text: message.content,
  }));

  const prepared = prepareEgress(parts, { strictOrigins, external: input.external });

  if (prepared.status === 'refused') {
    throw new ModelEgressRefused(undefined, [], prepared.reason);
  }

  let cleared = prepared.status === 'ready' ? prepared.parts : undefined;

  if (prepared.status === 'needs-confirmation') {
    if (!input.confirmSecret) {
      throw new ModelEgressRefused(prepared.origin, prepared.redactedRules, prepared.reason);
    }
    const answer = await input.confirmSecret({
      origin: prepared.origin,
      rules: prepared.redactedRules,
      reason: prepared.reason,
    });
    if (answer === 'cancel') {
      throw new ModelEgressRefused(prepared.origin, prepared.redactedRules, 'Cancelled before sending.');
    }
    cleared = answer === 'send-redacted' ? prepared.redactedAlternative : parts;
  }

  const messages = input.request.messages.map((message, index) => ({
    ...message,
    content: cleared?.[index]?.text ?? message.content,
  }));

  if (prepared.status === 'ready' && input.onAudit) {
    input.onAudit(describeEgressAudit(prepared.audit, input.provider.providerId ?? 'unknown', input.request.model));
  }

  const cleanedRequest = { ...input.request, messages };
  return input.onTextChunk && input.provider.streamComplete
    ? input.provider.streamComplete(cleanedRequest, input.onTextChunk)
    : input.provider.complete(cleanedRequest);
}

/**
 * Read the origins a message array is carrying.
 *
 * Still explicit labelling, not inference: it reads a field somebody set at the
 * point the message was built, and an unset one stays `undefined` so the
 * boundary refuses. The alternative — a second array kept in step by hand —
 * desynchronises the first time a caller evicts a message, and a mislabelled
 * origin is worse than a missing one.
 */
export function originsFromMessages(
  messages: readonly { origin?: ModelContextOrigin }[],
): readonly (ModelContextOrigin | undefined)[] {
  return messages.map(message => message.origin);
}
