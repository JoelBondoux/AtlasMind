/**
 * What to ask Atlas about one entry in the Delivery page's artifact inventory.
 *
 * The inventory could say a file was missing and could not do anything about
 * it. Every row was a dead end: a red `SECURITY.md` row told you the file was
 * absent and left you to write it, and a green `README.md` row told you the
 * file existed and said nothing about whether it still described the project —
 * which, for a document nobody has re-read in eight months, is the question
 * worth asking.
 *
 * Four rules carry the semantics:
 *
 * **The row's own facts choose the request, not the surface and not a model.**
 * `classifyArtifactCompliance` reads `exists`, `type` and `retention` off the
 * signal the host already built, and the webview renders the intent it was
 * given. A second classifier in the browser would eventually disagree with this
 * one, and the symptom would be a button whose icon promises a fix and whose
 * hand-off asks a question.
 *
 * **A produced artifact is never authored.** `out/`, `dist/`, `coverage/`,
 * `node_modules/` and a packaged `.vsix` are absent most of the time, and that
 * absence is usually correct — they are the output of a build, not a document
 * somebody forgot. Asking an agent to "create the missing coverage directory"
 * invites it to fabricate one, which would be a lie about the project written
 * into the repository. Those rows get an `explain` request that states, in the
 * prompt, that nothing is to be authored or committed.
 *
 * **An existing file gets reviewed, never rewritten on sight.** The `review`
 * prompt asks what is stale, missing or contradicted by the repository as it
 * stands, and asks for the smallest correction — because a wholesale rewrite of
 * a `CONTRIBUTING.md` loses decisions nobody recorded anywhere else.
 *
 * **Look before creating.** The inventory probes a fixed list of paths, so an
 * artifact filed under a name it does not know (`LICENCE`, `docs/SECURITY.md`)
 * reads as missing. Every `author` prompt therefore begins by searching for an
 * equivalent, since a second licence file is worse than the reported gap.
 *
 * Pure: no `vscode`, no filesystem. The catalog, the probing and the chat
 * hand-off stay in the panel.
 */

export type ArtifactComplianceIntent = 'author' | 'explain' | 'review';

/** The facts a request is derived from — a subset of the dashboard's signal. */
export interface ArtifactComplianceSubject {
  label: string;
  description: string;
  /** Workspace-relative path, or the primary probe path when the artifact is absent. */
  path: string;
  type: 'persistent' | 'ephemeral';
  origin: 'manual' | 'generated' | 'tooling';
  lifecycle: 'source' | 'build' | 'test' | 'deploy' | 'runtime';
  retention: 'keep' | 'cache' | 'discard';
  exists: boolean;
}

/**
 * The declared rules that choose a request. Published on the surface for the
 * reason the debt register publishes its grading table: a button that asks one
 * thing for `README.md` and another for `coverage/` should be able to say why.
 */
export const ARTIFACT_COMPLIANCE_RULES: ReadonlyArray<{
  id: ArtifactComplianceIntent;
  describes: string;
}> = [
  { id: 'review', describes: 'The artifact is present, so the open question is whether it still describes this project.' },
  { id: 'author', describes: 'The artifact is absent and is one the repository is expected to keep, so it has to be written.' },
  { id: 'explain', describes: 'The artifact is absent and is produced rather than authored, so its absence is usually correct and nothing should be created.' },
];

const RULE_TEXT = new Map(ARTIFACT_COMPLIANCE_RULES.map(rule => [rule.id, rule.describes]));

export interface ArtifactComplianceRequest {
  intent: ArtifactComplianceIntent;
  /** The declared rule that chose this intent. */
  rule: string;
  /** Short imperative for the control's tooltip and accessible name. */
  action: string;
  /** The draft handed to chat. */
  prompt: string;
}

/**
 * Which of the three questions this row deserves.
 *
 * Order is the policy: presence outranks everything, because a file that exists
 * cannot be missing whatever its retention says. Then "the repository is
 * expected to keep this" — persistent *and* `keep`, which is the same pair
 * `needsAttention` is derived from, so the amber rows and the `author` requests
 * are the same set by construction rather than by coincidence.
 */
export function classifyArtifactCompliance(subject: ArtifactComplianceSubject): ArtifactComplianceIntent {
  if (subject.exists) {
    return 'review';
  }
  return subject.type === 'persistent' && subject.retention === 'keep' ? 'author' : 'explain';
}

/**
 * The `*.vsix` row takes its path from a directory listing, so a filename in the
 * workspace reaches this text. Everything else comes from a fixed catalog, but
 * the boundary is treated the same way at every entrance rather than at the ones
 * that currently need it.
 */
function safe(value: unknown, max = 300): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max)
    : '';
}

/** How the artifact is described to the agent, in one line it can act on. */
function facts(subject: ArtifactComplianceSubject, label: string, target: string): string[] {
  return [
    `Artifact: ${label}`,
    `Inventory path: ${target}`,
    `Classification: ${subject.lifecycle} lifecycle, ${subject.type}, ${subject.origin} origin, ${subject.retention} retention`,
    `Inventory description: ${safe(subject.description, 400)}`,
  ];
}

export function buildArtifactCompliancePrompt(subject: ArtifactComplianceSubject): ArtifactComplianceRequest {
  const intent = classifyArtifactCompliance(subject);
  const label = safe(subject.label, 120) || 'this artifact';
  const target = safe(subject.path, 300) || label;
  const rule = RULE_TEXT.get(intent) ?? '';
  const evidence = facts(subject, label, target).join('\n');

  if (intent === 'review') {
    return {
      intent,
      rule,
      action: `Check ${label} against the project`,
      prompt: [
        `Review the project artifact "${label}" and report whether it still describes this project as it actually is. It exists; the question is whether it is current, complete and consistent with the repository.`,
        evidence,
        [
          'Do this:',
          `1. Read ${target} in full.`,
          '2. Compare it against what the repository actually does now — the manifest, scripts, workflows, source layout, configuration and any related documents it refers to.',
          '3. Report, as a short list: what is stale (states something no longer true), what is missing (something the project has that this artifact should cover and does not), and what is inconsistent with another document.',
          '4. Say plainly if you find nothing wrong. "This is current" is a useful answer and must not be padded with speculative improvements.',
          '5. Propose the smallest correction that closes each real gap, and show the exact change before applying anything. Do not rewrite the file wholesale: it records decisions that are not written down anywhere else, and a rewrite loses them.',
        ].join('\n'),
        'Every fact you report must be traceable to something you read in this repository. Do not compare against a general idea of what a file of this kind usually contains.',
      ].join('\n\n'),
    };
  }

  if (intent === 'author') {
    return {
      intent,
      rule,
      action: `Create ${label} with Atlas`,
      prompt: [
        `The project artifact "${label}" is missing from this repository, and it is one the project is expected to keep. Establish whether it is genuinely absent, and if so draft it from what the repository already says about itself.`,
        evidence,
        [
          'Do this, in order:',
          `1. Search the workspace first. The inventory probes a fixed list of paths, so an equivalent filed under another name or another directory reads as missing. If one exists, say where it is and stop — a second copy is worse than the reported gap.`,
          '2. If it is genuinely absent, gather the content from the repository itself: the manifest, the README, the existing documentation, the workflows, the license metadata already declared, and the project instructions. Do not invent facts about the project, its owners, its support commitments, or its security process.',
          '3. Where a required fact is not recorded anywhere in the repository, leave a clearly marked placeholder and list what you could not determine. A confident invented answer in a file like this is worse than a visible gap, because nobody re-checks it later.',
          `4. Show the full proposed content of ${target} and what you based each part on, then create it through the normal approval flow. Do not modify unrelated files.`,
        ].join('\n'),
      ].join('\n\n'),
    };
  }

  return {
    intent,
    rule,
    action: `Explain how ${label} is produced`,
    prompt: [
      `The project artifact "${label}" is absent. It is produced rather than authored, so its absence is often correct — do not create one.`,
      evidence,
      [
        'Answer these, from evidence in the repository:',
        `1. What produces ${target} in this project — the exact script, command or workflow step — or state that nothing does.`,
        '2. Whether its absence right now is expected, or whether it points at something not wired up.',
        `3. Whether the repository handles it correctly for its ${subject.retention} retention: ignored by .gitignore where it should not be committed, cached where a build depends on it, and cleaned where it is regenerated.`,
        '4. What, if anything, is actually worth changing — and if the answer is nothing, say so.',
      ].join('\n'),
      `Do not author, generate, or commit a ${label}. Producing one by hand would put something in the repository that no build made, which is a false record of the project rather than a fix.`,
    ].join('\n\n'),
  };
}
