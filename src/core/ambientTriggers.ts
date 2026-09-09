/**
 * The event bus ambient agents subscribe to — what may wake AtlasMind up when
 * nobody asked it anything.
 *
 * Everything AtlasMind does today begins with a person typing. That is the
 * right default and it is also the ceiling: a failing pipeline, a security
 * advisory, a review sitting on you and a blocker defect all happen while you
 * are looking somewhere else, and none of them reaches you until you next open
 * the dashboard.
 *
 * A word about what "while you're away" can honestly mean. A VS Code extension
 * does not run when the editor is closed; there is no daemon and there is not
 * going to be one. So this is *ambient* rather than *background*: it works
 * while you are in the editor and not looking at AtlasMind, which is where
 * nearly all of the time goes anyway. Claiming more would be the kind of
 * promise that gets found out on the morning somebody needed it.
 *
 * Seven rules. Every one of them exists because the obvious alternative turns
 * an ambient trigger into something people switch off within a week.
 *
 * **An event is a change, not a state.** A pipeline that is red stays red. If
 * "red" were the event it would fire on every evaluation forever, and the first
 * thing anybody would do is disable it. An event is a *subject* entering a
 * condition it was not in last time — fingerprinted by subject, so one failing
 * run fires once.
 *
 * **Deny by default, twice.** A master gate and a per-event subscription, both
 * off. Nothing is subscribed on installation, and switching the feature on is a
 * different decision from subscribing to a particular event.
 *
 * **Ambient never exceeds `propose`, whatever a stage ceiling says.** This is
 * the rule that makes the rest safe. A workflow stage may permit `auto` because
 * a person is watching the run they started; nobody is watching this one. The
 * ceiling is `min(propose, master, stage, subscription)` and every reduction is
 * stated in the same sentence as the request.
 *
 * **A missed window is not a backlog.** Two weeks with the editor shut is one
 * event per subject, not one per evaluation that never happened — the same rule
 * `researchSchedule` states about due-ness, for the same reason.
 *
 * **Unknown is not quiet.** An event source that could not be read is reported
 * as `not-observed` rather than contributing silence. A source nobody could
 * read looks exactly like a source with nothing to say, and only one of those
 * is reassuring.
 *
 * **Spend defaults to nothing.** Switching ambient triggers on and letting them
 * spend money unattended are two decisions, and one switch carrying both would
 * make the first one cost something nobody agreed to — `researchSettings` makes
 * the same argument about its own cap.
 *
 * **Nothing here runs anything.** It returns a plan. A policy change cannot
 * become an execution, which is the property `producerReportPublication` has
 * for the same reason: the decision and the act are separate so that the
 * decision can be tested.
 *
 * Pure, `vscode`-free and clock-injected.
 */

/**
 * What may wake AtlasMind up.
 *
 * Deliberately small, and every one of them is something the project already
 * observes for another surface. An event kind nobody can observe is a menu
 * entry rather than a capability.
 */
export const AMBIENT_EVENT_KINDS = [
  'ci-failed',
  'security-advisory',
  'review-requested',
  'blocker-defect',
  'approval-awaiting-you',
  'test-case-failed',
  'dependency-update-stale',
  'release-blocked',
] as const;

export type AmbientEventKind = typeof AMBIENT_EVENT_KINDS[number];

/** How far an ambient response may go. Mirrors the workflow ceiling vocabulary. */
export type AmbientCeiling = 'observe' | 'propose';

export interface AmbientEventRule {
  kind: AmbientEventKind;
  label: string;
  /** What a subject key means for this kind, so a fingerprint can be read. */
  subjectIs: string;
  /** Published wherever the subscription is shown. The rule is the justification. */
  describes: string;
  /**
   * The highest this kind may ever reach, before any gate is applied.
   *
   * Two kinds are capped at `observe` by declaration rather than by
   * configuration: a security advisory and a blocked release are both
   * situations where the useful thing an agent can do is *tell you*, and where
   * a proposal generated unattended would be a confident answer about somebody
   * else's disclosure or about a step that cannot be undone.
   */
  maxCeiling: AmbientCeiling;
}

export const AMBIENT_EVENT_RULES: readonly AmbientEventRule[] = [
  {
    kind: 'ci-failed',
    label: 'CI failed',
    subjectIs: 'the run id, so one failing run fires once rather than on every check',
    describes: 'The most recent run on a branch concluded in failure. The one event where a proposal is genuinely useful unattended, because the logs say what broke.',
    maxCeiling: 'propose',
  },
  {
    kind: 'security-advisory',
    label: 'Security advisory',
    subjectIs: 'the advisory id',
    describes: 'A new high or critical advisory against a dependency. Capped at observe: whether it reaches your code is a question with a real answer, and an unattended guess at it is worse than the alert.',
    maxCeiling: 'observe',
  },
  {
    kind: 'review-requested',
    label: 'Review requested',
    subjectIs: 'the pull-request number',
    describes: 'Somebody asked you to review a pull request. Their work is stopped until you do.',
    maxCeiling: 'propose',
  },
  {
    kind: 'blocker-defect',
    label: 'Blocker defect raised',
    subjectIs: 'the defect id',
    describes: 'A defect graded blocker by the register\'s rule table was recorded and is still open.',
    maxCeiling: 'propose',
  },
  {
    kind: 'approval-awaiting-you',
    label: 'Approval waiting on you',
    subjectIs: 'the approval request id',
    describes: 'An approval request routed to you is still pending. Pending is not approved, and there is no timeout that grants one.',
    maxCeiling: 'observe',
  },
  {
    kind: 'test-case-failed',
    label: 'Manual test failed',
    subjectIs: 'the test case id',
    describes: 'Somebody ran a manual case and watched it fail. A person\'s observation, not a scanner\'s inference.',
    maxCeiling: 'propose',
  },
  {
    kind: 'dependency-update-stale',
    label: 'Dependency update sitting',
    subjectIs: 'the pull-request number',
    describes: 'A dependency update has been open past the stale threshold. An unmerged security update is worse than an unopened one, because somebody already decided it mattered.',
    maxCeiling: 'propose',
  },
  {
    kind: 'release-blocked',
    label: 'Release blocked',
    subjectIs: 'the gate id',
    describes: 'A release gate stopped passing. Capped at observe: a release is the one step that cannot be undone.',
    maxCeiling: 'observe',
  },
];

const RULE_BY_KIND = new Map(AMBIENT_EVENT_RULES.map(rule => [rule.kind, rule]));

export function ambientEventRule(kind: AmbientEventKind): AmbientEventRule | undefined {
  return RULE_BY_KIND.get(kind);
}

// ── Observation ──────────────────────────────────────────────────

/**
 * What the caller could see.
 *
 * Per kind: the subjects currently in that condition, or **absent** when the
 * source could not be read. The distinction is the whole of rule 5, and it is
 * carried in the shape rather than in a flag so a caller cannot accidentally
 * report "nothing" for something it never looked at.
 */
export interface AmbientObservation {
  subjects: Partial<Record<AmbientEventKind, readonly string[]>>;
  /** When the observation was taken. Carried onto every event it produces. */
  observedAt: string;
}

export interface AmbientEvent {
  kind: AmbientEventKind;
  /** What entered the condition — a run id, a defect id, a pull-request number. */
  subject: string;
  /** `kind::subject`. Stable, so the same condition is never reported twice. */
  fingerprint: string;
  observedAt: string;
}

/** The subjects already reported, so a standing condition does not fire again. */
export type AmbientSeen = readonly string[];

export interface AmbientDerivation {
  events: AmbientEvent[];
  /** Kinds the caller could not read. Never reported as "nothing happened". */
  notObserved: AmbientEventKind[];
  /**
   * Fingerprints to carry into the next evaluation.
   *
   * Derived from what is observable **now**, not by accumulating: a condition
   * that has cleared must be forgotten, or it could never fire again if it came
   * back. Kinds that could not be observed keep whatever was already known
   * about them, since "not looked at" must not clear a memory.
   */
  seen: string[];
}

export function ambientFingerprint(kind: AmbientEventKind, subject: string): string {
  return `${kind}::${subject}`;
}

/**
 * Turn an observation into events.
 *
 * A subject that was already known is not an event — that is rule 1, and it is
 * what stops a standing red pipeline firing forever. A subject that has cleared
 * is dropped from `seen`, so the same condition returning later is a new event;
 * accumulating instead would mean a flaky pipeline fired exactly once ever.
 */
export function deriveAmbientEvents(
  observation: AmbientObservation,
  previouslySeen: AmbientSeen,
): AmbientDerivation {
  const known = new Set(previouslySeen);
  const events: AmbientEvent[] = [];
  const notObserved: AmbientEventKind[] = [];
  const seen = new Set<string>();

  for (const kind of AMBIENT_EVENT_KINDS) {
    const subjects = observation.subjects[kind];
    if (subjects === undefined) {
      notObserved.push(kind);
      // Not looked at is not "cleared": whatever was known about this kind is
      // carried forward, or an unreadable source would replay every standing
      // condition the moment it came back.
      for (const fingerprint of known) {
        if (fingerprint.startsWith(`${kind}::`)) {
          seen.add(fingerprint);
        }
      }
      continue;
    }
    for (const subject of subjects) {
      const clean = String(subject).trim().slice(0, 200);
      if (!clean) {
        continue;
      }
      const fingerprint = ambientFingerprint(kind, clean);
      seen.add(fingerprint);
      if (!known.has(fingerprint)) {
        events.push({ kind, subject: clean, fingerprint, observedAt: observation.observedAt });
      }
    }
  }

  return { events, notObserved, seen: [...seen] };
}

// ── Subscriptions and gates ──────────────────────────────────────

export interface AmbientSubscription {
  kind: AmbientEventKind;
  enabled: boolean;
  /** What the subscriber asks for. Never what it gets — see `resolveAmbientCeiling`. */
  requested?: AmbientCeiling;
  /** The agent to hand the event to, when one is named. */
  agentId?: string;
}

export interface AmbientGates {
  /** `atlasmind.ambient.enabled`. Off by default. */
  masterEnabled: boolean;
  /** The operator's workflow ceiling, from the committed workflow file. */
  masterCeiling: AmbientCeiling;
  /** Monthly spend allowed for unattended work. Defaults to nothing. */
  monthlySpendCapUsd: number;
  /** What has already been spent this month, when the caller knows. */
  spentThisMonthUsd?: number;
  /** How many events one evaluation may raise. The remainder is stated. */
  maxPerEvaluation: number;
}

export interface AmbientCeilingDecision {
  ceiling: AmbientCeiling;
  /** Every reduction, stated in the same sentence as the request. */
  reductions: string[];
}

const CEILING_RANK: Record<AmbientCeiling, number> = { observe: 0, propose: 1 };

/**
 * How far a response to this event may go.
 *
 * `min` of four things, and the first of them is the constant `propose`: a
 * stage may permit more because somebody started that run and is watching it,
 * and nobody is watching this one. Every step down is named, because a ceiling
 * that silently lowers something is a ceiling nobody can debug.
 */
export function resolveAmbientCeiling(
  kind: AmbientEventKind,
  gates: AmbientGates,
  subscription: AmbientSubscription | undefined,
): AmbientCeilingDecision {
  const reductions: string[] = [];
  let ceiling: AmbientCeiling = 'propose';

  const rule = RULE_BY_KIND.get(kind);
  if (rule && CEILING_RANK[rule.maxCeiling] < CEILING_RANK[ceiling]) {
    ceiling = rule.maxCeiling;
    reductions.push(`${kind} is capped at ${rule.maxCeiling} by declaration: ${rule.describes}`);
  }
  if (CEILING_RANK[gates.masterCeiling] < CEILING_RANK[ceiling]) {
    ceiling = gates.masterCeiling;
    reductions.push(`the workflow ceiling for this operator is ${gates.masterCeiling}.`);
  }
  const requested = subscription?.requested;
  if (requested && CEILING_RANK[requested] < CEILING_RANK[ceiling]) {
    ceiling = requested;
    reductions.push(`this subscription asked for ${requested}.`);
  }
  return { ceiling, reductions };
}

// ── Planning ─────────────────────────────────────────────────────

export type AmbientSuppression =
  | 'master-gate-off'
  | 'not-subscribed'
  | 'spend-cap-reached'
  | 'over-evaluation-cap';

export interface AmbientAction {
  event: AmbientEvent;
  ceiling: AmbientCeiling;
  /** Every reduction applied, so the level can be argued with. */
  reductions: string[];
  agentId?: string;
  /** The declared rule this event was raised under. */
  rule: string;
}

export interface AmbientSuppressed {
  event: AmbientEvent;
  reason: AmbientSuppression;
  detail: string;
}

export interface AmbientPlan {
  actions: AmbientAction[];
  suppressed: AmbientSuppressed[];
  /** Kinds the caller could not read. Rule 5, carried to the surface. */
  notObserved: AmbientEventKind[];
  /** Events past the per-evaluation cap. Stated, never silently dropped. */
  droppedByCap: number;
  /** One line for a notification, or undefined when there is nothing to say. */
  summary?: string;
}

/**
 * Decide what, if anything, should happen — and return it rather than doing it.
 *
 * Suppressions are returned alongside the actions rather than filtered away: a
 * feature that silently does nothing is indistinguishable from one that is
 * broken, and the commonest reason for silence here is a gate somebody meant to
 * open.
 */
export function planAmbientResponses(
  derivation: AmbientDerivation,
  subscriptions: readonly AmbientSubscription[],
  gates: AmbientGates,
): AmbientPlan {
  const byKind = new Map(subscriptions.map(subscription => [subscription.kind, subscription]));
  const actions: AmbientAction[] = [];
  const suppressed: AmbientSuppressed[] = [];
  const capReached = gates.monthlySpendCapUsd <= 0
    || (gates.spentThisMonthUsd !== undefined && gates.spentThisMonthUsd >= gates.monthlySpendCapUsd);
  let droppedByCap = 0;

  for (const event of derivation.events) {
    if (!gates.masterEnabled) {
      suppressed.push({
        event,
        reason: 'master-gate-off',
        detail: 'Ambient triggers are switched off. Nothing was raised, and nothing will be until they are switched on.',
      });
      continue;
    }
    const subscription = byKind.get(event.kind);
    if (!subscription?.enabled) {
      suppressed.push({
        event,
        reason: 'not-subscribed',
        detail: `Nothing subscribes to ${event.kind}. Switching ambient triggers on and subscribing to an event are two decisions.`,
      });
      continue;
    }
    const decision = resolveAmbientCeiling(event.kind, gates, subscription);
    // The spend cap only bites on a ceiling that can spend. Telling somebody
    // what happened costs nothing, and refusing to tell them because a budget
    // is exhausted would be the worst possible reading of a cost control.
    if (decision.ceiling === 'propose' && capReached) {
      suppressed.push({
        event,
        reason: 'spend-cap-reached',
        detail: gates.monthlySpendCapUsd <= 0
          ? 'No unattended spend is allowed, so this can only be reported rather than worked on. Set a monthly cap to let an ambient run cost something.'
          : 'The monthly ambient spend cap has been reached, so this can only be reported.',
      });
      continue;
    }
    if (actions.length >= Math.max(0, gates.maxPerEvaluation)) {
      droppedByCap += 1;
      continue;
    }
    actions.push({
      event,
      ceiling: decision.ceiling,
      reductions: decision.reductions,
      ...(subscription.agentId === undefined ? {} : { agentId: subscription.agentId }),
      rule: event.kind,
    });
  }

  const plan: AmbientPlan = {
    actions,
    suppressed,
    notObserved: derivation.notObserved,
    droppedByCap,
  };
  const summary = describeAmbientPlan(plan);
  return summary === undefined ? plan : { ...plan, summary };
}

/**
 * One line for a notification.
 *
 * Names what happened rather than saying "an event occurred", because a message
 * that does not say what it is about gives nobody a reason to look at it — the
 * lesson `approvalAttention` already learned about tool approvals.
 *
 * Returns undefined when there is nothing to say. A plan whose only content is
 * a suppression is *not* nothing to say from a debugging point of view, but it
 * is nothing to interrupt somebody with: the surface can still show it.
 */
export function describeAmbientPlan(plan: AmbientPlan): string | undefined {
  if (plan.actions.length === 0) {
    return undefined;
  }
  const first = plan.actions[0]!;
  const rule = RULE_BY_KIND.get(first.event.kind);
  const label = rule?.label ?? first.event.kind;
  const more = plan.actions.length - 1;
  const remainder = plan.droppedByCap > 0 ? ` (+${plan.droppedByCap} past this check's cap)` : '';
  return more > 0
    ? `${label}: ${first.event.subject}, and ${more} other event${more === 1 ? '' : 's'}${remainder}.`
    : `${label}: ${first.event.subject}${remainder}.`;
}

/**
 * The prompt for an ambient hand-off.
 *
 * Two things it must say that an interactive prompt does not. **Nobody is
 * watching**, which is the whole reason the ceiling is what it is — so the
 * standing instruction is propose, never apply, whatever the task looks like.
 * And **the trigger is not a brief**: an event says a condition exists, not
 * what should be done about it, and an agent that treated "CI failed" as
 * authorisation to change the build would be acting on nobody's decision.
 */
export function buildAmbientHandoffPrompt(action: AmbientAction): string {
  const rule = RULE_BY_KIND.get(action.event.kind);
  const lines = [
    `An ambient trigger fired while nobody was looking: ${rule?.label ?? action.event.kind}.`,
    '',
    `Subject: ${action.event.subject}${rule ? ` (${rule.subjectIs})` : ''}`,
    `Observed: ${action.event.observedAt.slice(0, 19).replace('T', ' ')} UTC.`,
    rule ? `Raised by the declared rule \`${action.event.kind}\`: ${rule.describes}` : '',
    `How far you may go: **${action.ceiling}**.`,
    ...action.reductions.map(reduction => `  - ${reduction}`),
    '',
    'Nobody asked for this and nobody is watching it. Two things follow.',
    '',
    'The trigger is not a brief. It says a condition exists; it does not say what',
    'should be done about it, and it is not authorisation to change anything.',
    '',
    action.ceiling === 'observe'
      ? 'You are at **observe**. Report what you find and stop. Do not propose a change, because a proposal generated unattended reads as a recommendation somebody made.'
      : 'You are at **propose**. Say what you would change and why, and stop there. Apply nothing.',
  ];
  return lines.filter(line => line !== '').join('\n');
}

/**
 * Where the seen-set has to live.
 *
 * Stated here rather than left to a caller for the reason `observedDelta` states
 * its own: `project_memory/` is git-tracked, and a shared seen-set would mean
 * "has *anybody* been told about this", which is not the question — two people
 * on the same team each need telling, and the first one to open their editor
 * would silence it for the other.
 */
export const AMBIENT_SEEN_STORAGE_NOTE =
  'Per developer, in workspace state. Never in project_memory: a shared seen-set silences an event for everybody the moment one person is told.';

/** Bounded, so a long-lived workspace cannot grow the memory without limit. */
export const MAX_AMBIENT_SEEN = 500;

/** Trim the carried set, keeping the most recent. */
export function boundAmbientSeen(seen: readonly string[]): string[] {
  return seen.length <= MAX_AMBIENT_SEEN ? [...seen] : seen.slice(-MAX_AMBIENT_SEEN);
}

// ── Service ──────────────────────────────────────────────────────

export interface AmbientTriggerDeps {
  /** What can be seen right now. Absent kinds are "not looked at". */
  observe: () => Promise<AmbientObservation>;
  getGates: () => AmbientGates;
  getSubscriptions: () => AmbientSubscription[];
  /** Persisted by the caller, per developer. See {@link AMBIENT_SEEN_STORAGE_NOTE}. */
  getSeen: () => string[];
  setSeen: (seen: string[]) => void;
  /** Surface the plan. Never sends anything; the caller decides how loud to be. */
  present: (plan: AmbientPlan) => void;
}

/**
 * Evaluates the bus on a timer and hands the plan to the caller.
 *
 * Holds the timer and nothing else: the observation, the gates, the storage and
 * the presentation are all injected, so every rule above is testable without a
 * running editor. It never executes an action — `present` receives a plan, and
 * what happens next is the caller's decision under the ordinary approval
 * regime.
 */
export class AmbientTriggerService {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly deps: AmbientTriggerDeps) {}

  /**
   * One evaluation. Returns the plan so a caller can test or log it.
   *
   * The seen-set is written **before** the plan is presented, and it is written
   * even when the master gate is off. Both matter: a crash between presenting
   * and storing would replay the same event on the next tick, and a gate that
   * is off must still track what has been seen or switching it on would raise
   * every standing condition at once.
   */
  async runOnce(): Promise<AmbientPlan> {
    const observation = await this.deps.observe();
    const derivation = deriveAmbientEvents(observation, this.deps.getSeen());
    this.deps.setSeen(boundAmbientSeen(derivation.seen));
    const plan = planAmbientResponses(
      derivation,
      this.deps.getSubscriptions(),
      this.deps.getGates(),
    );
    this.deps.present(plan);
    return plan;
  }

  /** Start the recurring evaluation (idempotent). */
  start(intervalMs: number): void {
    this.stop();
    this.timer = setInterval(() => {
      void this.runOnce().catch(() => {
        // Best-effort. A bad tick must never crash the extension host, and a
        // failed observation is already reported as `not-observed` rather than
        // as a quiet check.
      });
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  dispose(): void {
    this.stop();
  }
}
