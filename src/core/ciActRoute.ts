/**
 * Running an existing GitHub workflow locally with `act`, and being honest
 * about what that proves.
 *
 * `act` is the first alternative executor the local-CI documentation picks, and
 * the reason is good: it runs the workflow YAML the repository already has,
 * without pushing, without spending hosted allowance, and without registering
 * anything with GitHub. The reason it needs care is equally good — the same
 * documentation says its default images are deliberately incomplete and that
 * several GitHub services are only partially emulated, which means **a pass
 * under `act` is weaker evidence than the same workflow on a hosted runner, and
 * the difference is invisible from the exit code**.
 *
 * So the substance of this module is not the command. It is
 * `assessActFidelity`, which reads the workflow and says which parts `act`
 * cannot faithfully reproduce, before anything runs. Offering the button
 * without that would make AtlasMind the thing that told somebody their Windows
 * job passed.
 *
 * Four rules.
 *
 * **A partial run is never reported as a full one.** Every fidelity gap found
 * is carried on the plan, stated in the confirmation, and stated again beside
 * the build. The documentation's own requirement for an executor adapter is
 * that "a missing capability is a refusal or an explicit partial run, never an
 * inferred success"; this is that requirement, implemented.
 *
 * **A job `act` cannot run at all is refused, not attempted.** A
 * `windows-latest` job under a Linux container is not a partial result, it is a
 * different thing wearing the same job name.
 *
 * **AtlasMind does not spawn `act` itself.** It plans the command, states what
 * it will and will not prove, and sends it to a terminal for the human to run —
 * the same shape the direct-local route uses, and deliberately not the shape
 * the trusted local runner uses. That runner executes a workflow only after a
 * twelve-rule policy check, because executing repository YAML with container
 * access is exactly what those rules exist to gate. `act` runs arbitrary
 * workflow content through the Docker API by design; AtlasMind will help
 * somebody run it and will not run it on their behalf.
 *
 * **Every argument is a constant here.** The workflow filename and job id are
 * validated against the same grammars the rest of the CI code uses, and nothing
 * is parsed out of documentation or produced by a model.
 *
 * Pure, `vscode`-free, unit-tested.
 */

export const ACT_DOCS_URL = 'https://nektosact.com/';
export const ACT_COMMAND = 'act';

/** Mirrors the grammars used by `trustedLocalCiStarter` and the runner config. */
const WORKFLOW_FILE = /^[A-Za-z0-9._-]+\.ya?ml$/;
const JOB_ID = /^[A-Za-z0-9_-]{1,100}$/;

export type ActFidelitySeverity =
  /** `act` cannot run this at all; attempting it would produce a different thing. */
  | 'cannot-run'
  /** It will run, but not the way GitHub would. */
  | 'partial';

export interface ActFidelityGap {
  severity: ActFidelitySeverity;
  /** What was found, in the words somebody reading the workflow would use. */
  finding: string;
  /** What that means for the result. Never omitted — it is the whole point. */
  consequence: string;
}

/**
 * Signals that `act` will not reproduce faithfully.
 *
 * A declared table rather than a model's judgement, matched with bounded
 * regular expressions against the workflow text — the same approach
 * `assessTrustedLocalCiWorkflow` takes, and for the same reason: this decides
 * what somebody is told about their evidence, so it has to be checkable.
 */
const ACT_FIDELITY_RULES: ReadonlyArray<{
  pattern: RegExp;
  severity: ActFidelitySeverity;
  finding: string;
  consequence: string;
}> = [
  {
    pattern: /runs-on:\s*\[?\s*['"]?(?:windows|macos)-[a-z0-9.-]+/i,
    severity: 'cannot-run',
    finding: 'A job targets Windows or macOS.',
    consequence: '`act` runs Linux containers. Running this job here would execute something else under the same name, so it proves nothing about that platform.',
  },
  {
    pattern: /uses:\s*actions\/(?:upload|download)-artifact@/i,
    severity: 'partial',
    finding: 'The workflow uploads or downloads artifacts.',
    consequence: '`act` needs a local artifact server for this. Without one the step behaves differently from GitHub, and a pass does not mean the artifact would have been produced.',
  },
  {
    pattern: /uses:\s*actions\/cache@/i,
    severity: 'partial',
    finding: 'The workflow uses the Actions cache.',
    consequence: 'There is no cache service locally, so timings and any behaviour that depends on a warm cache will differ.',
  },
  {
    pattern: /^\s{4,}services:\s*$/m,
    severity: 'partial',
    finding: 'A job declares service containers.',
    consequence: 'Service containers are emulated partially. A pass is not evidence that the service wiring works on GitHub.',
  },
  {
    pattern: /\$\{\{\s*secrets\./i,
    severity: 'partial',
    finding: 'The workflow reads a GitHub secret.',
    consequence: 'AtlasMind supplies no secrets to `act`. Steps needing one will behave as though it were empty, which frequently passes for the wrong reason.',
  },
  {
    pattern: /\$\{\{\s*github\.event\./i,
    severity: 'partial',
    finding: 'The workflow reads the event payload.',
    consequence: '`act` synthesizes the event, so these values are not the ones GitHub would provide.',
  },
  {
    pattern: /\bid-token:\s*write\b|\buses:\s*azure\/login@|\baws-actions\/configure-aws-credentials@/i,
    severity: 'cannot-run',
    finding: 'The workflow authenticates with OIDC.',
    consequence: 'There is no GitHub OIDC issuer locally, so this cannot work and cannot be made to work by supplying a value.',
  },
];

export interface ActFidelityAssessment {
  gaps: ActFidelityGap[];
  /** True when at least one gap makes a faithful run impossible. */
  blocked: boolean;
  /** One sentence for a surface that has room for one. */
  summary: string;
}

/**
 * Read a workflow and report what `act` will not reproduce.
 *
 * Never throws and never claims fidelity it has not checked: an empty gap list
 * means *these declared rules found nothing*, which the summary says in those
 * words rather than as "this will run exactly like GitHub".
 */
export function assessActFidelity(workflowText: string): ActFidelityAssessment {
  const text = String(workflowText ?? '').replace(/\r\n/g, '\n').slice(0, 1_000_000);
  const gaps: ActFidelityGap[] = [];
  for (const rule of ACT_FIDELITY_RULES) {
    if (rule.pattern.test(text)) {
      gaps.push({ severity: rule.severity, finding: rule.finding, consequence: rule.consequence });
    }
  }
  const blocked = gaps.some(gap => gap.severity === 'cannot-run');
  const partial = gaps.filter(gap => gap.severity === 'partial').length;
  return {
    gaps,
    blocked,
    summary: blocked
      ? 'Parts of this workflow cannot run under `act` at all.'
      : partial > 0
        ? `${partial} part${partial === 1 ? '' : 's'} of this workflow will run differently here than on GitHub.`
        : 'These checks found nothing `act` is known to reproduce badly. That is not the same as a guarantee it matches GitHub.',
  };
}

export interface ActRunPlanInput {
  workflowFile: string;
  /** Optional: run one job rather than everything the event triggers. */
  jobId?: string;
  /** The event to simulate. Validated against a closed list. */
  event?: string;
  fidelity: ActFidelityAssessment;
}

/** Events `act` is asked to simulate. Closed, because it reaches a command line. */
const ACT_EVENTS = ['push', 'workflow_dispatch', 'schedule', 'release'] as const;

export type ActRunOutcome =
  | { ok: true; plan: ActRunPlan }
  | { ok: false; reason: string };

export interface ActRunPlan {
  routeId: 'act';
  /** argv, ready to render or send. Never a shell string. */
  command: string;
  args: string[];
  /** Exactly what a terminal will receive, derived from argv. */
  line: string;
  workflowFile: string;
  jobId?: string;
  fidelity: ActFidelityAssessment;
}

/**
 * Build the `act` invocation, or refuse.
 *
 * `--pull=false` is deliberate: `act` will otherwise pull large images the user
 * did not ask for, on a route whose whole appeal is that it is local and cheap.
 * A missing image then fails with a message naming the image, which is a better
 * outcome than a silent multi-gigabyte download.
 */
export function planActRun(input: ActRunPlanInput): ActRunOutcome {
  const workflowFile = String(input.workflowFile ?? '').trim();
  if (!WORKFLOW_FILE.test(workflowFile)) {
    return { ok: false, reason: 'The workflow must be one YAML filename inside .github/workflows.' };
  }
  const jobId = input.jobId === undefined ? undefined : String(input.jobId).trim();
  if (jobId !== undefined && !JOB_ID.test(jobId)) {
    return { ok: false, reason: 'That job id is not a name AtlasMind will put on a command line.' };
  }
  const event = input.event === undefined ? 'push' : String(input.event).trim();
  if (!ACT_EVENTS.includes(event as (typeof ACT_EVENTS)[number])) {
    return { ok: false, reason: `AtlasMind only simulates these events with act: ${ACT_EVENTS.join(', ')}.` };
  }
  if (input.fidelity.blocked) {
    return {
      ok: false,
      reason: `${input.fidelity.summary} Running it here would produce a result that looks like the workflow's and is not. `
        + 'Use GitHub-hosted runners for those jobs.',
    };
  }

  const args = [
    event,
    '--workflows', `.github/workflows/${workflowFile}`,
    ...(jobId ? ['--job', jobId] : []),
    // Never pull on somebody's behalf: this route's appeal is being local and
    // cheap, and act's default images are large.
    '--pull=false',
  ];
  return {
    ok: true,
    plan: {
      routeId: 'act',
      command: ACT_COMMAND,
      args,
      line: [ACT_COMMAND, ...args].join(' '),
      workflowFile,
      ...(jobId ? { jobId } : {}),
      fidelity: input.fidelity,
    },
  };
}

export interface ActRunConfirmation {
  title: string;
  detail: string;
  confirmLabel: string;
}

/**
 * The sentence read before `act` is sent to a terminal.
 *
 * Leads with the fidelity gaps rather than the command, because the command is
 * the part somebody already understands and the gaps are the part that decides
 * whether the result means anything.
 */
export function buildActRunConfirmation(plan: ActRunPlan): ActRunConfirmation {
  const lines = [
    'AtlasMind will type this into a terminal for you to run:',
    '',
    `  ${plan.line}`,
    '',
  ];
  if (plan.fidelity.gaps.length > 0) {
    lines.push('Before you trust the result:', '');
    for (const gap of plan.fidelity.gaps) {
      lines.push(`  • ${gap.finding} ${gap.consequence}`);
    }
    lines.push('');
  } else {
    lines.push(plan.fidelity.summary, '');
  }
  lines.push(
    'A pass here is evidence about a Linux container on this machine, not about GitHub’s runners.',
    'AtlasMind does not run act for you and does not read the terminal, so it cannot report how this ends.',
  );
  return {
    title: `Run ${plan.workflowFile} locally with act?`,
    detail: lines.join('\n'),
    confirmLabel: 'Send to terminal',
  };
}
