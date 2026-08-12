/**
 * What a model is *for*, decided before it can be routed to.
 *
 * A provider's `/v1/models` list is an inventory of what it can serve, not a
 * list of things that can hold a conversation. Embedding models, rerankers,
 * transcribers, image generators and safety classifiers all appear in it — a
 * local runtime lists every set of weights it has loaded, and OpenAI's own list
 * carries `text-embedding-3-large`, `whisper-1` and `dall-e-3`. AtlasMind had no
 * concept that would tell them apart: `inferCapabilities` granted `chat`, `code`
 * and, on a bare `llama` substring or on any non-local provider,
 * `function_calling` to all of them.
 *
 * That is not a hypothetical. In v0.300.0 a turn spent its last failover attempt
 * on `local/<endpoint>@@llama-guard-3-1b`, which answered with a chat-template
 * error because Llama Guard's template accepts neither a system message nor a
 * multi-turn transcript. The turn had already burned six minutes on two
 * unrelated timeouts; this attempt was the one that could never have worked no
 * matter how long anybody waited. Local models make it worst — they are free, so
 * they win on price exactly when the router is out of options — but nothing
 * about the defect was local.
 *
 * Three properties, in the order they matter:
 *
 * **Absence of a marker is not evidence of a non-chat role.** An unrecognised
 * model is `conversational`, always. A false positive here hides capacity the
 * user installed or pays for, and it hides it silently — the model simply stops
 * appearing. So the table is short and every entry is a family somebody can
 * name, not a guess at what a prefix might mean, and a miss is the designed
 * failure mode rather than a gap to close by broadening a marker.
 *
 * **Markers match name *segments*, never bare substrings.** `bge`, `gte` and
 * `sdxl` are short enough that a substring match would sweep up ordinary chat
 * models, and the first symptom would be a model missing from the picker with
 * nothing anywhere saying why. The tokeniser is what makes a marker this short
 * safe to declare — the same reasoning `lensProbePolicy` applies to MCP tool
 * names, and for the same reason: names are stable, prose is not.
 *
 * **Every exclusion names the rule that produced it.** A model withheld for a
 * reason nobody can read is indistinguishable from a discovery bug, and the
 * report a user opens will say "my model vanished" either way.
 *
 * Rules are evaluated in declaration order and the first match wins, which is
 * load-bearing for exactly one case: `bge-reranker-v2-m3` carries both an
 * embedding marker and a reranker one, and it is a reranker.
 *
 * Pure — no imports, deliberately. Normalising the model id here duplicates
 * three lines of `registry.ts`'s decoder rather than importing it, because
 * `registry.ts` is a consumer of this module and the import would close a cycle.
 */

/** What a model can be asked to do. Only `conversational` is routable. */
export type ModelRole =
  | 'conversational'
  | 'safety-classifier'
  | 'embedding'
  | 'reranker'
  | 'transcription'
  | 'speech-synthesis'
  | 'image-generation';

/** A declared rule: the markers it matches, and why that role cannot chat. */
export interface ModelRoleRule {
  id: string;
  role: Exclude<ModelRole, 'conversational'>;
  /** Name segments that identify this role. Matched whole, never as substrings. */
  markers: readonly string[];
  /** Stated on every exclusion so a missing model is explainable. */
  reason: string;
}

/**
 * The published table. Order is evaluated order; the first match wins.
 *
 * `reranker` precedes `embedding` because reranker ids routinely carry the
 * embedding family they were distilled from (`bge-reranker-v2-m3`), and
 * reporting one as the other would be a wrong answer where a right one exists.
 */
export const MODEL_ROLE_RULES: readonly ModelRoleRule[] = [
  {
    id: 'safety-classifier-family',
    role: 'safety-classifier',
    markers: [
      'guard', 'guardian', 'llamaguard', 'shieldgemma', 'nemoguard', 'wildguard',
      'guardreasoner', 'moderation',
    ],
    reason: 'Safety classifiers answer a fixed verdict and their chat templates reject a system message or a multi-turn transcript.',
  },
  {
    id: 'reranker-family',
    role: 'reranker',
    markers: ['rerank', 'reranker', 'reranking'],
    reason: 'Rerankers score a query against candidate passages and return no generated text.',
  },
  {
    id: 'embedding-family',
    role: 'embedding',
    markers: ['embed', 'embedding', 'embeddings', 'bge', 'gte', 'minilm', 'sfr'],
    reason: 'Embedding models return a vector, not a completion.',
  },
  {
    id: 'transcription-family',
    role: 'transcription',
    markers: ['whisper', 'wav2vec', 'parakeet'],
    reason: 'Speech recognition models transcribe audio and cannot answer a text prompt.',
  },
  {
    id: 'speech-synthesis-family',
    role: 'speech-synthesis',
    markers: ['tts', 'xtts', 'piper', 'kokoro'],
    reason: 'Speech synthesis models return audio, not a completion.',
  },
  {
    id: 'image-generation-family',
    role: 'image-generation',
    markers: ['sdxl', 'diffusion', 'dall', 'dalle', 'flux1'],
    reason: 'Image generation models return an image, not a completion.',
  },
] as const;

/** A role assessment, carrying the rule so the decision can be published. */
export interface ModelRoleAssessment {
  role: ModelRole;
  /** Whether this model may be routed to as a chat model. */
  conversational: boolean;
  /** The id of the rule that decided, or `unmarked` when nothing matched. */
  rule: string;
  /** Human-readable reason, suitable for a log line or a tooltip. */
  reason: string;
}

const UNMARKED: ModelRoleAssessment = {
  role: 'conversational',
  conversational: true,
  rule: 'unmarked',
  reason: 'No non-conversational marker found; treated as a chat model.',
};

/**
 * Strip the routing decoration a model id accumulates.
 *
 * `local/<endpointId>@@<rawModelId>` is the encoded local form; either half may
 * be absent, and a cloud id carries only the provider prefix. Only the raw model
 * id says anything about what the weights do.
 */
function rawModelId(modelId: string): string {
  const withoutProvider = modelId.includes('/') ? modelId.slice(modelId.indexOf('/') + 1) : modelId;
  const delimiter = withoutProvider.indexOf('@@');
  const raw = delimiter >= 0 ? withoutProvider.slice(delimiter + 2) : withoutProvider;
  return raw.trim().toLowerCase();
}

/**
 * Split an id into comparable name segments.
 *
 * Each segment also yields a version-stripped form, so `guard3` matches `guard`
 * and `embed2` matches `embed` without `8b` collapsing to nothing useful. Forms
 * shorter than two characters are dropped: `l6` stripping to `l` would match
 * anything.
 */
function nameSegments(raw: string): Set<string> {
  const segments = new Set<string>();
  for (const token of raw.split(/[^a-z0-9]+/)) {
    if (token.length < 2) { continue; }
    segments.add(token);
    const withoutVersion = token.replace(/\d+$/, '');
    if (withoutVersion.length >= 2) {
      segments.add(withoutVersion);
    }
  }
  return segments;
}

/**
 * What this model is for.
 *
 * Total: any input, including an empty or malformed id, yields an assessment.
 * An id that says nothing is `conversational`, never withheld.
 */
export function classifyModelRole(modelId: string): ModelRoleAssessment {
  if (typeof modelId !== 'string') { return UNMARKED; }
  const raw = rawModelId(modelId);
  if (raw.length === 0) { return UNMARKED; }

  const segments = nameSegments(raw);
  for (const rule of MODEL_ROLE_RULES) {
    if (rule.markers.some(marker => segments.has(marker))) {
      return { role: rule.role, conversational: false, rule: rule.id, reason: rule.reason };
    }
  }
  return UNMARKED;
}

/** Whether this model may be routed to as a chat model. */
export function isConversationalModel(modelId: string): boolean {
  return classifyModelRole(modelId).conversational;
}

/** One line explaining why a model was withheld from routing. */
export function describeModelRoleExclusion(modelId: string): string | undefined {
  const assessment = classifyModelRole(modelId);
  if (assessment.conversational) { return undefined; }
  return `${modelId} is a ${assessment.role.replace(/-/g, ' ')} (rule ${assessment.rule}): ${assessment.reason}`;
}
