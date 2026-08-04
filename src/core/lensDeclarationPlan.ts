/**
 * LensDeclarationPlan — the guided procedure for writing Lens declarations.
 *
 * The Atlas Lenses dashboard could already tell you that
 * `.atlasmind/lens-state.json` was missing, and it could create one for you. What
 * it created was `{"version": 1, "machines": []}`, and the advice that came with
 * it was to fill it in using schema autocomplete. That is only advice to somebody
 * who already knows both halves of the answer — what a state-machine declaration
 * *is*, and what this particular repository's state machines *are*. Everyone
 * else got a valid empty file and a dead end, which is why two lenses in a
 * feature with eight of them were effectively unreachable.
 *
 * This is the missing half. It is a {@link SetupStep} plan, so it inherits the
 * two properties that module enforces — a plan is never an installer, and a step
 * blocked only by an optional prerequisite is never nominated — and it adds
 * three of its own that matter specifically here.
 *
 * **Required and optional are different questions, and the plan says which.**
 * Four files are involved and only two of them gate anything: State Lifecycle
 * and Configuration Resolution have nothing to read without their declarations,
 * while Field Wiring and Data Trust work without theirs and merely get sharper
 * with them. Both refinements are `optional` steps, which `summarizeSetupProgress`
 * excludes from the count. A project that declares its state machines and its
 * configuration precedence is *finished*, and a guide that kept telling it
 * otherwise would teach the user to stop reading the guide.
 *
 * **A broken file outranks a missing one.** `invalid` means somebody wrote the
 * file and it does not parse — they are mid-task and stuck, and sending them to
 * a different file first is the worst possible ordering. `LENS_RULES` on the
 * dashboard already ranks it that way; this keeps the same order rather than
 * inventing a second one.
 *
 * **The plan describes; it never drafts.** Every step here is derived from the
 * inspected file status, so the guide renders identically on a machine with no
 * model configured — which is exactly the machine whose owner most needs it and
 * is least able to get an answer out of a model. Drafting is a separate,
 * explicitly-invoked thing that lives in `lensDeclarationDraft.ts`.
 *
 * Pure, `vscode`-free, and unit-tested.
 */

import {
  findLensDeclarationDescriptor,
  lensDeclarationDescriptors,
  type LensDeclarationFileStatus,
  type LensDeclarationKind,
  type LensDeclarationStatus,
  type LensDeclarationsSnapshot,
} from './lensDeclarations.js';
import type { SetupGuideSummary, SetupStatus, SetupStep } from './setupWalkthrough.js';

/** The guide as `/setup` lists it. */
export const LENS_SETUP_GUIDE: SetupGuideSummary = {
  id: 'lens',
  label: 'Atlas Lenses',
  blurb: 'Declare what your project actually does so the Lens views can show it back to you.',
  command: '/lens',
  stepIds: ['workspace', 'state', 'config'],
};

/**
 * Steps counted as "done" for the guide.
 *
 * The two refinements are deliberately absent. They appear in the plan, they can
 * be acted on, and they are never counted — see the module note.
 */
export const LENS_REQUIRED_STEP_IDS: readonly string[] = ['workspace', 'state', 'config'];

/** Every step the plan emits, required and optional, in render order. */
export const LENS_ALL_STEP_IDS: readonly string[] = ['workspace', 'state', 'config', 'mappings', 'trust'];

export interface LensDeclarationPlanInput {
  /** Absent means the files were never inspected — reported as unknown, not as missing. */
  declarations?: LensDeclarationsSnapshot;
  /** Absent means no workspace is open, which blocks everything downstream. */
  workspaceName?: string;
  /**
   * Whether a model is configured well enough for "Ask Atlas" to be worth
   * offering. Absent means unknown, and the guidance is written so it reads
   * correctly either way rather than promising a button that will not work.
   */
  drafting?: boolean;
}

/**
 * The full plan.
 *
 * Ordered as somebody would actually work: prove there is a workspace, then the
 * two gates, then the two refinements. Within the gates, the file that is broken
 * comes before the file that is absent, because someone who half-wrote a
 * declaration is closer to finishing it than someone who has not started.
 */
export function buildLensDeclarationPlan(input: LensDeclarationPlanInput): SetupStep[] {
  const workspaceStep = buildWorkspaceStep(input);
  const hasWorkspace = workspaceStep.status === 'done';

  const fileSteps = lensDeclarationDescriptors().map(descriptor => {
    const file = input.declarations?.files.find(candidate => candidate.kind === descriptor.kind);
    return buildDeclarationStep(descriptor.kind, file, hasWorkspace, input.drafting);
  });

  const gates = fileSteps.filter(step => LENS_REQUIRED_STEP_IDS.includes(step.id));
  const refinements = fileSteps.filter(step => !LENS_REQUIRED_STEP_IDS.includes(step.id));
  return [workspaceStep, ...gates.sort(byRepairFirst), ...refinements];
}

/**
 * A broken declaration before an absent one, otherwise declaration order.
 *
 * `sort` is stable in every runtime AtlasMind targets, so equal ranks keep the
 * table's order and the guide cannot shuffle between renders.
 */
function byRepairFirst(left: SetupStep, right: SetupStep): number {
  return stepRepairRank(left) - stepRepairRank(right);
}

function stepRepairRank(step: SetupStep): number {
  return step.status === 'todo' && step.detail.includes('could not be read') ? 0 : 1;
}

function buildWorkspaceStep(input: LensDeclarationPlanInput): SetupStep {
  if (!input.workspaceName) {
    return {
      id: 'workspace',
      title: 'Open the repository you want to describe',
      status: 'todo',
      detail: 'Lens declarations live in the repository they describe, so there is nowhere to put them until a folder is open.',
      guidance: [
        { text: 'Open the project folder in VS Code. Declarations are written to `.atlasmind/` at its root.' },
      ],
      action: { command: 'workbench.action.files.openFolder', title: 'Open Folder' },
    };
  }
  if (!input.declarations) {
    // Distinct from "missing": a virtual filesystem has no `fsPath` to read, and
    // reporting a file we never looked for as absent would be a false statement.
    return {
      id: 'workspace',
      title: 'Open the repository you want to describe',
      status: 'todo',
      detail: `${input.workspaceName} is open, but its declaration files could not be inspected. This happens in virtual filesystems, where AtlasMind cannot safely read or create them.`,
      guidance: [
        { text: 'Open the repository from a local or remote disk-backed folder, then start this guide again.' },
      ],
    };
  }
  return {
    id: 'workspace',
    title: 'Open the repository you want to describe',
    status: 'done',
    detail: `${input.workspaceName} is open and its \`.atlasmind/\` declarations were inspected.`,
  };
}

/**
 * One file's step.
 *
 * The `detail` is the *current state* and the `guidance` is *what to write*,
 * kept apart on purpose: the first changes every time the file does, the second
 * is what somebody is actually reading the guide for.
 */
function buildDeclarationStep(
  kind: LensDeclarationKind,
  file: LensDeclarationStatus | undefined,
  hasWorkspace: boolean,
  drafting: boolean | undefined,
): SetupStep {
  const descriptor = findLensDeclarationDescriptor(kind);
  const optional = !descriptor.required;
  const title = optional
    ? `Sharpen ${descriptor.label} (optional)`
    : `Declare ${descriptor.label}`;

  if (!hasWorkspace || !file) {
    return {
      id: kind,
      title,
      status: 'blocked',
      detail: `${descriptor.purpose} Nothing can be read or written until a disk-backed repository is open.`,
    };
  }

  const status = declarationStepStatus(file.status, optional);
  return {
    id: kind,
    title,
    status,
    detail: describeDeclarationState(file, descriptor.purpose),
    guidance: buildDeclarationGuidance(kind, file, drafting),
    ...(status === 'done' ? {} : {
      action: {
        command: 'atlasmind.lens.openDeclarationGuide',
        title: file.status === 'missing' ? `Create ${file.workspacePath}` : `Open ${file.workspacePath}`,
        args: [kind],
      },
    }),
  };
}

function declarationStepStatus(status: LensDeclarationFileStatus, optional: boolean): SetupStatus {
  if (status === 'ready') {
    return 'done';
  }
  if (status === 'unavailable') {
    return 'blocked';
  }
  // An optional file that is absent is a choice, not an omission. An optional
  // file that is *broken* is still broken, and saying "optional" about a parse
  // error would be the guide declining to mention the one thing that is wrong.
  if (optional && (status === 'missing' || status === 'empty')) {
    return 'optional';
  }
  return 'todo';
}

function describeDeclarationState(file: LensDeclarationStatus, purpose: string): string {
  switch (file.status) {
    case 'ready':
      return `${file.workspacePath} declares ${file.declarationCount} ${file.declarationCount === 1 ? 'entry' : 'entries'}. ${purpose}`;
    case 'empty':
      return `${file.workspacePath} exists and declares nothing yet. ${purpose}`;
    case 'missing':
      return `${file.workspacePath} does not exist. ${purpose}`;
    case 'invalid':
      return `${file.workspacePath} could not be read as a valid declaration, so it is refused whole rather than partly trusted. ${purpose}`;
    case 'unreadable':
      return `${file.workspacePath} exists but could not be read. Check the file permissions. ${purpose}`;
    case 'unavailable':
      return purpose;
  }
}

/**
 * What to actually write, per kind.
 *
 * A worked example rather than a description of the schema. Somebody stuck on an
 * empty `machines: []` does not need to be told it takes machines; they need to
 * see one, small enough to read in full and obviously about a different project
 * than theirs so it reads as a shape to copy rather than an answer to accept.
 */
function buildDeclarationGuidance(
  kind: LensDeclarationKind,
  file: LensDeclarationStatus,
  drafting: boolean | undefined,
): SetupStep['guidance'] {
  if (file.status === 'ready') {
    return [
      { text: `Add another entry any time. Every lens re-reads ${file.workspacePath} when you open it, so there is nothing to restart.` },
    ];
  }
  if (file.status === 'invalid' || file.status === 'unreadable') {
    return [
      { text: `Open ${file.workspacePath} and look for the first error VS Code underlines. The installed JSON schema validates it as you type.` },
      { text: 'AtlasMind refuses the whole file rather than trusting the parts of it that happen to parse, so one bad entry hides all the good ones.' },
    ];
  }

  const example = LENS_DECLARATION_EXAMPLES[kind];
  return [
    { text: example.opening },
    { text: 'A worked example — the shape, from a project that is not yours:', command: example.json, authored: true },
    { text: example.closing },
    ...(drafting === false
      ? []
      : [{
        text: drafting
          ? 'Or let Atlas read the repository and propose a first draft. It is shown to you in full and written only if you accept it; anything it cannot anchor to a real file is dropped and said so.'
          : 'Atlas can also read the repository and propose a first draft, once a model provider is configured. Nothing is written without you seeing it first.',
      }]),
    { text: `The installed JSON schema gives autocomplete and validation as you type in ${file.workspacePath}.` },
  ];
}

interface LensDeclarationExample {
  opening: string;
  json: string;
  closing: string;
}

/**
 * The examples, held as data so the guide and any future surface share them.
 *
 * Each is deliberately minimal and deliberately about a generic domain. An
 * example drawn from AtlasMind's own repository would be read as the answer by
 * anybody working on something else.
 */
export const LENS_DECLARATION_EXAMPLES: Record<LensDeclarationKind, LensDeclarationExample> = {
  state: {
    opening: 'Pick one thing in your project that moves through stages — an order, a job, a document, a session — and write down its stages and what moves it between them.',
    json: JSON.stringify({
      version: 1,
      machines: [{
        id: 'order',
        label: 'Order lifecycle',
        initial: 'draft',
        states: [
          { id: 'draft', label: 'Draft', terminal: false },
          { id: 'paid', label: 'Paid', terminal: false },
          { id: 'cancelled', label: 'Cancelled', terminal: true },
        ],
        transitions: [
          { id: 'pay', from: 'draft', to: 'paid', event: 'payment.succeeded' },
          { id: 'cancel', from: 'draft', to: 'cancelled', event: 'order.cancelled' },
        ],
      }],
    }, null, 2),
    closing: 'Mark a state `terminal` when nothing leaves it. The lens derives the rest — which states are unreachable from `initial`, and which are dead ends you did not mark as terminal. Those two findings are the point of writing it down.',
  },
  config: {
    opening: 'Pick one setting whose value has ever surprised you, and write down every place it could come from, in precedence order.',
    json: JSON.stringify({
      version: 1,
      settings: [{
        id: 'log-level',
        key: 'LOG_LEVEL',
        label: 'Log level',
        valuePolicy: 'display',
        sources: [
          { id: 'default', label: 'Built-in default', kind: 'default', precedence: 0, applies: true, value: 'info' },
          { id: 'file', label: 'config/app.json', kind: 'config-file', precedence: 10, applies: true, value: 'warn' },
          { id: 'env', label: 'LOG_LEVEL env var', kind: 'environment', precedence: 20, applies: false, value: null },
        ],
      }],
    }, null, 2),
    closing: 'Higher `precedence` wins. `applies: false` means the source is not in play right now — the lens draws it as shadowed, which is how you see that the env var you have been editing is being beaten by a config file; write `"value": null` when it is simply not set. Every source of a `display` setting must carry a value, even an unset one. Use `valuePolicy: "masked"` for anything you would not want on a screenshot: its sources then carry `"present": true` instead of a value, and the lens shows the precedence without it.',
  },
  mappings: {
    opening: 'Field Wiring already pairs fields across two contracts by itself. This file is for the pairs it gets wrong, and the pairs you have decided on purpose not to wire.',
    json: JSON.stringify({
      version: 1,
      mappings: [{
        id: 'customer-email',
        kind: 'rename',
        upstreamContractId: 'api.User',
        downstreamContractId: 'db.customers',
        from: { contractId: 'api.User', fieldPath: 'emailAddress' },
        to: { contractId: 'db.customers', fieldPath: 'email' },
        note: 'Renamed in the v2 API; the names no longer match.',
      }],
      suppressions: [{
        id: 'legacy-id',
        field: { contractId: 'db.customers', fieldPath: 'legacy_id' },
        reason: 'Retained for the 2019 import only. Deliberately not exposed.',
      }],
    }, null, 2),
    closing: '`kind` is one of `equivalent`, `rename`, `transform`, `drop`, `introduce`, `inferred`. A `drop` carries only `from` and an `introduce` only `to`; every other kind needs both, and each side\'s `contractId` must match the contract it belongs to. Write this file *after* running Field Wiring, not before — the point is to correct what it inferred, and you cannot correct a pairing you have not seen. A `reason` on a suppression is what stops the next person re-wiring it.',
  },
  trust: {
    opening: 'Say how sensitive each contract field is. AtlasMind will not guess this from field names or sample values, so a field with no rule here reads as "unknown classification" rather than as safe.',
    json: JSON.stringify({
      version: 1,
      fields: [{
        id: 'user-email',
        contractId: 'api.User',
        fieldPath: 'emailAddress',
        classification: 'confidential',
        controls: ['consent', 'redaction'],
        note: 'Marketing consent is checked at the send boundary, not here.',
      }],
    }, null, 2),
    closing: 'Classification is one of `public`, `internal`, `confidential`, `restricted`. Controls are `consent`, `authorization`, `redaction`, `encryption`, `retention`, `residency`. One rule per `contractId` + `fieldPath` pair. This file holds metadata about fields and never a value from one — do not paste a sample in to illustrate a rule.',
  },
};
