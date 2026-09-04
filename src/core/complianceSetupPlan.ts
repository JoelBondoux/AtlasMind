import {
  isSetupComplete,
  nextSetupStep,
  setupStepPosition,
  summarizeSetupProgress,
  type SetupGuideSummary,
  type SetupProgress,
  type SetupStep,
} from './setupWalkthrough.js';
import type { ComplianceMethodologyId } from './complianceControlCatalog.js';

/**
 * The `/compliance` walkthrough: getting a project to the point where it can
 * record evidence honestly.
 *
 * ── Why the per-control walk is not in here ──────────────────────────────
 *
 * The obvious design is one step per control, and it is wrong twice over.
 *
 * Mechanically, `SetupStep[]` is a flat list: `summarizeSetupProgress` counts
 * `done` over `total` and `setupStepPosition` renders a one-line trail of every
 * step. Twenty-five ISO controls makes "step 7 of 31" with a trail that wraps
 * four times, and enabling a second regime moves the finish line — the failure
 * the Buzz guide's own step-set comment warns about from the other direction.
 *
 * More fundamentally, setup is a one-time act: *make this project able to
 * record evidence honestly*. Assessing twenty-five controls is ongoing work
 * that is never finished and is redone every year. Modelling ongoing work as
 * setup progress produces a guide that is permanently incomplete, and a guide
 * that always says 60% is a guide people stop opening.
 *
 * So this ends at **assess one control end to end** — the same shape as the
 * Buzz guide's "prove one message arrives". Prove the machinery works once; the
 * per-control walk lives on the Compliance page, where there is room for a
 * control's requirement, what would settle it, and what is already attached.
 *
 * ── Nothing here records anything ────────────────────────────────────────
 *
 * Every action opens a surface. This is the guide where the shared allowlist's
 * "a plan is never an installer" becomes "a plan never marks a control
 * satisfied" — and a status needs a named person and a date, so a walkthrough
 * that could set one would be a walkthrough that could forge an attestation.
 * `findNonOpeningActions` over every state must be empty, pinned by test.
 */

export type ComplianceSetupStep = SetupStep;

/** Observed facts. Never self-reported, and never asked for. */
export interface ComplianceSetupState {
  /** `compliance-*` methodologies enabled in the project testing config. */
  readonly declaredRegimes: readonly ComplianceMethodologyId[];
  /** Declared regimes with a register file on disk. */
  readonly registeredRegimes: readonly ComplianceMethodologyId[];
  /** Declared regimes whose scope decision has been recorded. */
  readonly scopedRegimes: readonly ComplianceMethodologyId[];
  /** Declared regimes still holding a hand-edited mapping nobody has imported. */
  readonly pendingImports: readonly ComplianceMethodologyId[];
  /** The regime being worked — the only one, or the most recently written. */
  readonly focusRegime?: ComplianceMethodologyId;
  readonly focusRegimeLabel?: string;
  readonly focusControlCount: number;
  /** Controls in the focus regime carrying a status that survived the invariants. */
  readonly focusAssessedCount: number;
  readonly evidenceCount: number;
  /** Evidence a reader could actually obtain, rather than a note about where it is. */
  readonly verifiableEvidenceCount: number;
  /** Records with a stated expiry and no renewal follow-up raised. */
  readonly expiringWithoutFollowUp: number;
  /** Somebody on the Director roster can be named as an asserter. */
  readonly hasRoster: boolean;
  /** A register file this build must not write over. Blocks everything after it. */
  readonly preserveExisting: boolean;
}

/**
 * What `isComplianceSetupReady` means.
 *
 * `owner` is **required**, and that is the load-bearing choice: a status cannot
 * be recorded without a named asserter, so a guide that skipped the roster
 * would hand somebody a register in which every action silently fails.
 */
export const REQUIRED_COMPLIANCE_STEP_IDS = ['regime', 'owner', 'scope', 'evidence'] as const;

/**
 * What the walkthrough counts, which is one step more.
 *
 * Scope decided and one evidence record on file is a working register; it is
 * not proof that anybody can get a control across the line. `firstControl` is
 * the step that proves it.
 */
export const COMPLIANCE_WALKTHROUGH_STEP_IDS = [
  ...REQUIRED_COMPLIANCE_STEP_IDS,
  'firstControl',
] as const;

export const COMPLIANCE_SETUP_GUIDE: SetupGuideSummary = {
  id: 'compliance',
  label: 'Compliance',
  blurb: 'Record what actually evidences a governance regime, control by control, with a name and a date on it.',
  command: '/compliance',
  stepIds: COMPLIANCE_WALKTHROUGH_STEP_IDS,
};

const OPEN_DASHBOARD = 'atlasmind.openProjectDashboard';
const OPEN_TESTING = 'atlasmind.openSettings';
const OPEN_DIRECTOR = 'atlasmind.openProjectDirector';

/**
 * Build the plan from observed state.
 *
 * Steps are pushed in dependency order, so the first non-`done` one is always
 * the right next thing to do.
 */
export function buildComplianceSetupPlan(state: ComplianceSetupState): ComplianceSetupStep[] {
  const steps: ComplianceSetupStep[] = [];
  const focusLabel = state.focusRegimeLabel ?? 'the regime';

  // 0 — a register this build cannot read. Everything downstream is blocked,
  // and saying so before somebody fills in eight fields is the whole point.
  if (state.preserveExisting) {
    steps.push({
      id: 'preserved',
      title: 'A compliance register was written by a newer AtlasMind',
      status: 'blocked',
      detail: 'This build cannot read it, and will not write over it. Update AtlasMind, or open the file to see what it holds.',
      guidance: [{
        text: 'Overwriting an assessor-visible record with a build that could not read it is not an inconvenience — it is a compliance incident with a git commit attached. Nothing here will save until the versions match.',
      }],
      action: { command: OPEN_DASHBOARD, title: 'Open the Compliance page', args: ['compliance'] },
    });
  }

  // 1 — a regime has to be declared before anything else means anything.
  const hasRegime = state.declaredRegimes.length > 0;
  steps.push({
    id: 'regime',
    title: 'Declare which governance regime applies',
    status: hasRegime ? 'done' : 'todo',
    detail: hasRegime
      ? `${state.declaredRegimes.length} regime${state.declaredRegimes.length === 1 ? '' : 's'} declared.`
      : 'Nothing is declared yet. Turn on the regimes a customer, a regulator or a contract actually asks of you.',
    guidance: [
      {
        text: 'Settings → Testing lists them under the Compliance headings. Turn on only what genuinely applies: an undeclared regime costs nothing, and a declared one you never assess reads as an outstanding obligation forever — correctly.',
      },
    ],
    action: { command: OPEN_TESTING, title: 'Open Settings → Testing', args: ['testing'] },
  });

  // 2 — an existing hand-edited mapping, offered before anybody retypes it.
  const pending = state.pendingImports.length;
  steps.push({
    id: 'import',
    title: 'Bring across an existing control mapping',
    status: pending === 0 ? 'optional' : 'todo',
    detail: pending === 0
      ? 'No hand-written mapping is waiting to be imported.'
      : `${pending} hand-written mapping${pending === 1 ? '' : 's'} can be imported rather than retyped.`,
    guidance: [{
      text: 'The import keeps every status you typed and shows, before it writes anything, how many cannot be carried across as recorded. A row that says "Satisfied" with no asserter and no evidence imports as Not assessed with your wording kept as a note — which is what it always was.',
    }],
    action: { command: OPEN_DASHBOARD, title: 'Open the Compliance page', args: ['compliance'] },
  });

  // 3 — somebody has to be nameable, or every later action fails silently.
  steps.push({
    id: 'owner',
    title: 'Have somebody who can assert a control',
    status: state.hasRoster ? 'done' : 'todo',
    detail: state.hasRoster
      ? 'The Director roster has somebody who can be named as an asserter.'
      : 'Nobody is on the roster yet, so no status could be recorded against a name.',
    guidance: [{
      text: 'A control status needs a named person and a date. That is not bureaucracy — it is the difference between evidence and a claim, and it is enforced rather than requested: a status with no asserter is not carried, however it was written.',
    }],
    action: { command: OPEN_DIRECTOR, title: 'Open the Director roster' },
  });

  // 4 — scope. The gate everything else sits behind.
  const scoped = state.focusRegime !== undefined && state.scopedRegimes.includes(state.focusRegime);
  steps.push({
    id: 'scope',
    title: 'Decide what is in scope',
    status: !hasRegime ? 'blocked' : scoped ? 'done' : 'todo',
    detail: !hasRegime
      ? 'Declare a regime first.'
      : scoped
        ? `Scope is recorded for ${focusLabel}.`
        : `Nothing is in scope for ${focusLabel} until somebody says so.`,
    guidance: [{
      text: 'Until scope is decided every control reads Not assessed whatever is entered against it — a mapping filled in before anybody decided what applies looks complete and answers nothing. This is also the first thing an assessor establishes, before reading a single control.',
    }],
    action: { command: OPEN_DASHBOARD, title: 'Open the Compliance page', args: ['compliance'] },
  });

  // 5 — one evidence record, so the shape of the thing is concrete.
  steps.push({
    id: 'evidence',
    title: 'Record one piece of evidence',
    status: !scoped ? 'blocked' : state.evidenceCount > 0 ? 'done' : 'todo',
    detail: !scoped
      ? 'Decide scope first.'
      : state.evidenceCount > 0
        ? `${state.evidenceCount} record${state.evidenceCount === 1 ? '' : 's'} on file.`
        : 'Nothing is on file yet.',
    guidance: [
      {
        text: 'Three honest ways to say where something is: a file in this repository, an https link, or a description — "held in Vanta, ask the security lead". The third is a real answer, not a fallback: it tells somebody how to obtain the document, where a path from your own machine tells them nothing.',
      },
      {
        text: 'AtlasMind records where a document is and never the document. project_memory/ is tracked by git, so a certificate or a signed agreement committed there goes to everyone who can clone the repository — and AtlasMind could not take it back out.',
      },
    ],
    action: { command: OPEN_DASHBOARD, title: 'Open the Compliance page', args: ['compliance'] },
  });

  // 6 — prove one control can actually cross the line.
  const assessed = state.focusAssessedCount > 0;
  steps.push({
    id: 'firstControl',
    title: 'Assess one control end to end',
    status: state.evidenceCount === 0 ? 'blocked' : assessed ? 'done' : 'todo',
    detail: state.evidenceCount === 0
      ? 'Record a piece of evidence first.'
      : assessed
        ? `${state.focusAssessedCount} of ${state.focusControlCount} controls in ${focusLabel} carry a recorded decision.`
        : `None of ${focusLabel}'s ${state.focusControlCount} controls has been decided yet.`,
    guidance: [{
      text: 'Attach the evidence, then set the status separately. The two are deliberately different acts: attaching says what exists, setting a status says what you conclude from it — and only the second needs your name on it.',
    }],
    action: { command: OPEN_DASHBOARD, title: 'Open the Compliance page', args: ['compliance'] },
  });

  // 7 — optional, and optional on purpose.
  steps.push({
    id: 'verifiable',
    title: 'Hold at least one record somebody could produce',
    status: state.verifiableEvidenceCount > 0 ? 'done' : 'optional',
    detail: state.verifiableEvidenceCount > 0
      ? `${state.verifiableEvidenceCount} record${state.verifiableEvidenceCount === 1 ? '' : 's'} point at something retrievable.`
      : 'Everything on file is described rather than linked, which is a legitimate final answer.',
    guidance: [{
      text: 'Optional deliberately. A report held in a compliance platform and recorded as "held in Vanta" is the right answer for that report, and marking it incomplete forever would be nagging somebody for doing the honest thing. It does mean an artifact-class control stops at Partial, which is also honest.',
    }],
  });

  // 8 — optional, and about the thing that quietly lapses.
  steps.push({
    id: 'renewals',
    title: 'Set a reminder before something expires',
    status: state.expiringWithoutFollowUp === 0 ? 'done' : 'optional',
    detail: state.expiringWithoutFollowUp === 0
      ? 'Nothing with a stated expiry is unwatched.'
      : `${state.expiringWithoutFollowUp} record${state.expiringWithoutFollowUp === 1 ? '' : 's'} will lapse with nobody scheduled to renew it.`,
    guidance: [{
      text: 'A lapsed certificate is not a late task. It is a claim on a page an outsider reads that has quietly become false, which is why it surfaces as needing a person rather than as a reminder.',
    }],
    action: { command: OPEN_DASHBOARD, title: 'Open the Compliance page', args: ['compliance'] },
  });

  return steps;
}

/** The next thing to do, scoped to the walkthrough's own step set. */
export function nextComplianceSetupStep(steps: ComplianceSetupStep[]): ComplianceSetupStep | undefined {
  return nextSetupStep(steps, COMPLIANCE_WALKTHROUGH_STEP_IDS);
}

/**
 * Can this project record evidence honestly?
 *
 * Deliberately narrower than the walkthrough: proving one control end to end is
 * worth walking somebody through and is not a precondition for the register
 * working. Reporting a correctly-configured project as unready would be wrong
 * in the same way reporting an unassessed regime as met would be.
 */
export function isComplianceSetupReady(steps: ComplianceSetupStep[]): boolean {
  return isSetupComplete(steps, REQUIRED_COMPLIANCE_STEP_IDS);
}

export function complianceSetupProgress(steps: ComplianceSetupStep[]): SetupProgress {
  return summarizeSetupProgress(steps, COMPLIANCE_WALKTHROUGH_STEP_IDS);
}

export function complianceSetupStepPosition(
  steps: ComplianceSetupStep[],
  stepId: string,
): ReturnType<typeof setupStepPosition> {
  return setupStepPosition(steps, COMPLIANCE_WALKTHROUGH_STEP_IDS, stepId);
}
