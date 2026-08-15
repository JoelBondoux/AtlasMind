# Chat window — remediation plan

Derived from the stress battery at `evals/chat-window.stress.ts` (v0.310.1: 57 probes, 24 held,
33 findings). Grouped by **root cause**, not by probe — sixteen changes close all thirty-three,
because several findings are one defect seen from different angles.

**The acceptance criterion for every item already exists.** Each work item names the probes that
must flip from `×` to `✓`, so "done" is `npx vitest run --config evals/vitest.stress.config.ts`
and not a judgement call. Any item that changes a probe's expectation rather than the code it
measures should be treated as a failed fix.

**Four items were decisions rather than defects.** All four are now resolved and folded into the
work items; the reasoning is kept at the end. One of them — `DECISION-3` — changed a finding:
`ask-on-external` behaves as designed, and what is actually wrong is how the four approval modes
are presented.

---

## Sequencing

| Phase | Theme | Items | Findings closed |
|---|---|---|---|
| **P0** | Stop the damage that outlives the turn | W1–W2 | 4 |
| **P1** | Make the stop honest | W3–W4 | 6 |
| **P2** | Repair the question path | W5–W7 | 6 |
| **P3** | Surfaces, footers, grading | W8–W12 | 9 |
| **P4** | Give chat knowledge of AtlasMind | W13–W16 | 8 |

P0 first because those two are the only findings that **persist after the conversation ends** —
one corrupts the router's model/agent history, the other writes to a file most repos commit.
Everything else is bad within a turn and gone by the next one.

P2 is cheaper and more visible than P1 and would be the tempting place to start. Resist it: P1
contains the finding where a run is planned, estimated and costed against the string `go ahead`,
and every day that ships is a day of runs nobody can audit.

---

## P0 — Stop the damage that outlives the turn

### W1 · Narrow the tool-failure predicate, and stop it overwriting answers
**Closes** `O3` · keeps `O4` green
**Touches** `src/core/orchestrator.ts` (`classifyToolFailure`, `~:2955–2973`)

Two separate changes, both required — either alone leaves the defect half-live:

1. **Narrow the predicate.** Drop the bare `includes('failed')` and the keyword regex over raw
   tool output. Classify on the declared prefixes and on a non-zero exit code only. A tool that
   wants to report failure should say so in a way it controls, not leave it to whether the file it
   read happens to contain the word "cannot".
2. **Append, never replace.** When results test as failed, append the failure summary below the
   model's answer rather than substituting `completion.content`, and only stamp
   `finishReason: 'error'` when the model produced no substantive text. The stamp is what reaches
   `agents.recordOutcome` and `router.recordExecutionOutcome`, so a false positive is a permanent
   penalty on an agent and model that did nothing wrong.

**Watch:** `TOOL_EXECUTION_FAILURE_PREFIX` is also read at the subtask boundary to detect an
unrecovered failure. Changing what produces that prefix changes that consumer — check it in the
same pass rather than discovering it from a Mission Loop that no longer stops.

**Risk:** genuine failures becoming quieter. Mitigated by keeping the existing `console.warn`, and
by the fact that a failure the model can see and explain is more useful than a dump that replaced
the explanation.

**Bump:** patch. **Docs:** `docs/architecture.md`, `wiki/Architecture.md` (core service behaviour).

### W2 · Frustration: stop the false positives, name what it writes
**Closes** `R2`, `G8`, part of `R1` (the rest in W2b)
**Touches** `src/chat/participant.ts` (`detectUserFrustrationSignal`, `applyFrustrationSettingsTuning`)

The detector currently misses five of eight real complaints and fires on two ordinary polite
requests — and the adaptation it triggers writes `chatSessionTurnLimit` and
`chatSessionContextChars` at `ConfigurationTarget.Workspace`, i.e. into `.vscode/settings.json`,
naming neither in anything the user reads.

1. **Remove the neutral cues.** `can you do (this|that|it|them) for me` and `just do (it|that)`
   are ordinary instructions, not friction. They are the two that fired on benign phrasing.
2. **Add the missed shapes.** "you're not listening", "that's the Nth time", "I asked you to X,
   not Y", "forget it, I'll do it myself", "why do you keep offering instead of doing".
3. **Never write a setting silently.** See `DECISION-2` — the recommendation is to convert the
   automatic tuning into the suggestion pattern that already exists for the iteration limit
   (W16), so the same mechanism serves both. If tuning stays automatic, the turn must name the
   key, the old value and the new one, and offer a one-click revert.

**Bump:** patch. **Docs:** `wiki/Configuration.md` if the tuning behaviour changes.

---

## P1 — Make the stop honest

### W3 · One resolver decides whether a turn is waiting
**Closes** `S2`, `S3`, `S4`, `S8`
**Touches** `src/chat/participant.ts`, `src/views/chatPanel.ts`

Three detectors currently decide independently whether a turn is pending a project run:
`detectProjectRunProposal` draws the card, `detectResponseQuickReplies` draws the pills, and
`isAutonomousContinuationPrompt` **accepts the answer** — unconditionally. The acceptor is strictly
more permissive than either announcer, which is the whole "it hard stops and never told me"
symptom.

Introduce a single `resolvePendingDecision(reply, transcript)` returning
`{ goal, announcement } | undefined`, and derive all three behaviours from it:

- the decision card renders when it is defined;
- the pills render from the same result rather than being **deleted** when a proposal is set
  (`chatPanel.ts:1306–1308` currently strips `followupQuestion` and `quickReplies`, leaving the
  card as the only affordance);
- a continuation word only starts a run when it is defined. Otherwise the turn asks what to
  continue rather than resolving a goal out of the transcript.

Also narrow the negation veto: it currently scans the last 400 characters, so any `don't`
anywhere in the reply deletes the card. Scope it to the offer sentence.

**Bump:** minor (behaviour change users will notice). **Docs:** `wiki/Project-Planner.md`,
`wiki/Chat-Commands.md`.

### W4 · A run's goal must be a goal
**Closes** `S5`, `S6`
**Touches** `src/chat/participant.ts` (`resolveAutonomousContinuationGoal`, `normalizeAutonomousSourcePrompt`)

`"Shall I go ahead?"` currently resolves to the goal `go ahead` after the offer lead-in is
stripped — and the plan, subtask table, file estimate and cost estimate are all derived from that
string. Separately, `"Once you confirm X, I can start a run"` plus `continue` starts a run the
model had just declined to start.

1. **Refuse affirmation fragments.** A resolved goal matching `go ahead|proceed|continue|yes|ok|
   sure|do it|carry on` is not a goal. Fall back to the last actionable user prompt; if none
   resolves, **ask** rather than run.
2. **Honour a stated precondition.** When the reply defers ("once you", "after you", "before I"),
   a continuation word must not override it.
3. **Show the goal before the run.** The Preview already prints an estimate; print the resolved
   goal in the same block, so a fragment is visible before it costs anything.

**Bump:** minor. **Docs:** `wiki/Project-Planner.md`, `docs/agents-and-skills.md`.

---

## P2 — Repair the question path

### W5 · A full stop inside a filename is not a sentence boundary
**Closes** `Q1`, `Q2`, `Q4`
**Touches** `src/chat/participant.ts` (`extractQuestionClause`)

`/([^.!?]*\?)\s*$/` cannot cross a `.`, so "Want me to update README.md?" yields `md?` — three
characters, below the ≥6 guard, discarded. Any closing offer naming a file, a path or a version
disappears entirely. Split on sentence-final punctuation followed by whitespace and a capital,
and protect `\w\.\w` (filenames, paths), `v\d+\.\d+` (versions) and the common abbreviations.

This one regex is the largest single win in the battery: three QUESTION findings and the visible
half of `S4`.

### W6 · Detect the question before the sanitizer deletes it
**Closes** `Q8`, `A2`
**Touches** `src/chat/participant.ts` (`sanitizeResponseTail` and its call order)

A closing question written as a heading (`### Ready to proceed?`) is stripped by the tail
sanitizer, which runs *before* detection — so the question is deleted before the user sees it.
Either run detection on the pre-sanitize text, or keep a trailing heading that ends in `?`. For
`A2`, do not strip a heading when what remains ends in a colon, which leaves the answer pointing
at nothing.

### W7 · Long options and two-question endings
**Closes** `Q6`, `Q7`
**Touches** `src/chat/participant.ts` (`detectResponseQuickReplies`)

The 48-character label cap silently drops chips when a model describes its options in clauses
rather than naming them — which is what a model does when asked to explain the choice. Truncate
for display and keep the full text as the submitted prompt (the pill-fidelity control `Q9` must
stay green, so display truncation needs an ellipsis the user can read as truncation). For `Q7`,
when a turn closes with two questions, surface the block rather than the last sentence alone.

**Bump for P2:** patch. **Docs:** none triggered — internal behaviour of an existing surface.

---

## P3 — Surfaces, footers, grading

### W8 · Command-router edges
**Closes** `M3`, `M4` · keeps `M6` green
**Touches** `src/views/chatSlashRouting.ts`

Lowercase the candidate token and strip trailing punctuation before matching, so `/Cost`,
`/runs?` and `/ship!` dispatch or are corrected rather than reaching a model. The path guard is
load-bearing and must keep passing: `/usr/local/bin/node`, `/etc/hosts` and `/README.md` stay
prose. The safest shape is to normalise only when the candidate is a single token with no second
slash — the existing rule — and to compare case-insensitively against `ATLAS_SLASH_COMMANDS`.

### W9 · Footer says what it cost, and asks once
**Closes** `I1`, `I2`
**Touches** `src/chat/participant.ts` (`renderAssistantResponseFooter`)

Add cost and token count beside the model name — the transcript is where the spend is incurred
and it is the one surface that never mentions it. Suppress the "Next step" block when the
question it would render is already the last line of the answer.

### W10 · Carry-forward on a short instrumental follow-up
**Closes** `C1`
**Touches** `src/chat/participant.ts` (`shouldCarryForwardConversationContext`)

"Use Playwright instead" shares no tokens with the last three prompts and drops the context. Add
a pattern for short imperative follow-ups carrying a substitution cue (`instead`, `rather than`,
`switch to`, `use X`), which are contextual by construction. Keep `C3` green — an explicit subject
change must still drop the thread.

### W11 · Grade MCP tools by what they do — introduce `network-read`
**Closes** `T1`, `T3`, `T4` · keeps `T2`, `T5` green
**Touches** `src/core/toolPolicy.ts` (`classifyUnknownToolName`, `ToolInvocationPolicy` category union)

`READ_LIKE_PREFIXES` matches with `startsWith`, and every MCP name starts with `mcp:` — so the
read detection is unreachable for exactly the tools it was written for, and every MCP read grades
`network`/high, identically to a delete.

Strip the `mcp:<server>:` namespace before name classification, then grade a read-shaped name as a
**new `network-read` category** rather than as `read`. This is the resolution of `DECISION-4`: the
current grading conflates two questions that have different answers for an MCP tool — *will this
change something?* (no) and *does this leave the machine?* (yes, always). Calling it `read` throws
away the second, which is the one that matters for a tool pulling the user's mail into model
context.

`requiresToolApproval` then places it: no prompt under `ask-on-write` (it mutates nothing), prompt
under `ask-on-external` (it is egress) and `always-ask`. Write-wins must stay — `send`, `create`,
`delete` still beat a read-like prefix — and an unrecognised name still grades `network`/high.

### W12 · The approval modes are not a ladder, and the dropdown says they are
**Closes** `O5` (reframed — see `DECISION-3`)
**Touches** `package.json` (enum order + `markdownDescription`), `src/views/settingsPanel.ts`

Not a behaviour change. The four modes gate as follows:

| Mode | read | git‑read | terminal‑read | terminal‑write | network | workspace‑write | git‑write |
|---|---|---|---|---|---|---|---|
| `always-ask` | prompt | prompt | prompt | prompt | prompt | prompt | prompt |
| `ask-on-write` | — | — | prompt | prompt | prompt | prompt | prompt |
| `ask-on-external` | — | — | prompt | prompt | prompt | **—** | **—** |
| `allow-safe-readonly` | — | — | **—** | prompt | prompt | prompt | prompt |

The last two are **orthogonal, not ordered**: neither gates a superset of the other.
`ask-on-external` drops the workspace-write gate and keeps terminal-read; `allow-safe-readonly`
does the exact opposite. The manifest enum order drives the dropdown order, so they are presented
as a descending ladder — and a user tightening their setup by moving from `ask-on-write` to
`ask-on-external` silently **loses** the file-write and commit gates. The name compounds it:
`allow-safe-readonly` sits last and begins with "allow", yet is the stricter of the two on writes.

Fix the presentation, not the behaviour: describe each mode by what it does **not** prompt for,
split the two axes in the UI copy ("leaves the editor" vs "changes something"), and either
reorder or visually degroup so no ladder is implied. Add an enum-description test so the copy
cannot drift from `requiresToolApproval` — this is the second time a setting's description named
only its additions.

---

## P4 — Give chat knowledge of AtlasMind

This phase is a feature, not a repair, and it is ordered last because the three items below depend
on the first. Current reach: **2 of 35 pages, 0 anchors, 26 of 108 commands, 0 of 134 settings.**

### W13 · A capability index the model can see
**Closes** `G4` · unblocks W14–W16
**New** `src/core/capabilityIndex.ts`

Neither `SETTINGS_PAGE_IDS` nor `DASHBOARD_PAGE_IDS` is referenced outside the panel that owns it,
so every navigational answer chat gives is recall about a product that ships weekly. Build one
index from the manifest's commands and settings plus the two page-id spaces, bounded and injected
into the prompt, and pin it with a test against `package.json` — the same treatment
`ATLAS_SLASH_COMMANDS` already gets, and for the same reason: the failure mode of drift is silent.

### W14 · A navigation tool
**Closes** `G1`, `G2`, `G5`
**New** skill: `atlasmind-open`

`{ surface, page, section? | focus? }`, validated against the index, so chat can open the Testing
page at the card the answer is on rather than naming a menu path. The anchor space already exists
and is unused: `SettingsPanelTarget` carries `section` and `query`; `DashboardNavigationTarget`
carries a focused record. Classify as `read` in `toolPolicy` — opening a panel changes nothing.

### W15 · A settings tool — see `DECISION-1`
**Closes** `G3`, and is the honest fix for `G8`

### W16 · Session-fit suggestions
**Closes** `G7`
**Touches** `src/chat/participant.ts`

The pattern exists and works for exactly one thing: hit the tool-iteration ceiling and chat names
a value and offers a button. Extend it to the cases the session visibly demonstrates — a budget
mode starving a refactor, an approval mode prompting on every MCP read, a context window too
small for the file under discussion. Suggestions only; the application stays a click.

**Bump for P4:** minor per item; W15 may be major if it changes the tool-approval contract.
**Docs:** `docs/agents-and-skills.md`, `wiki/Skills.md`, `wiki/Tool-Execution.md`,
`wiki/Security.md`, `wiki/Configuration.md`, `docs/architecture.md`, `wiki/Architecture.md`.

---

## Decisions — resolved

**DECISION-1 · May chat write settings at all?** → **Yes, gated.** (`G3`, `W15`)
Reads are free. A write goes behind a `{modal: true}` confirmation naming the key, the current
value and the new one, matching how every other outward-facing write in this codebase is gated.
`W15` is scoped on that basis.

**DECISION-2 · Automatic frustration tuning?** → **Replace with a suggestion.** (`W2`, `G8`)
The automatic path is removed. The signal still feeds the turn's approach; what it no longer does
is write to `.vscode/settings.json`. The suggestion mechanism in `W16` carries it, with the
user's hand on it.

**DECISION-3 · Is `ask-on-external` leaving file writes unprompted intended?** → **Yes — it is a
mode the user chooses, and the finding was mis-stated.** (`O5`, `W12`)
The defect is not the behaviour, it is that the four modes are presented as a ladder while the
last two are orthogonal axes, so tightening your setting can loosen a gate. `W12` fixes the
presentation. The `O5` probe is rewritten to assert the *documentation* matches
`requiresToolApproval`, not that every mode gates writes.

**DECISION-4 · MCP read grading?** → **New `network-read` category.** (`W11`)
Neither "leave it high" nor "call it a read" is right: a read-only MCP call mutates nothing but is
always egress, and often pulls the user's data into model context. A third category keeps both
facts and lets `ask-on-external` become the mode that genuinely means "prompt on anything leaving
the editor" — which is what `W12` will then be able to say truthfully.

---

## Not doing

- **Rewriting the question detector.** W5–W7 are three narrow repairs to a detector whose shape is
  sound; the controls (`Q3`, `Q5`, `Q9`) prove the lane works where the edges do not.
- **Chasing `S8` as a defect.** Accepting "yes" and "sure" is correct behaviour — narrowing the
  accepted words would make the window worse without touching the asymmetry the probe measures.
  `S8` is a **regression detector for W3**: when one resolver decides whether a turn is pending,
  the acceptor becomes conditional and `S8` flips on its own. If W3 lands and `S8` still fails,
  W3 was implemented wrong. That is the whole reason it earns a place in the battery.
- **Model-assigned severity in the harness.** A severity a model assigns today is not comparable
  with one it assigns in March, which is the argument `debtRegister` and `researchScanCatalog`
  already make in this codebase. See below for what to do instead.

## Worth adding: a declared severity table

The objection above is to *ungrounded* severity, not to severity. A declared rule table is the
house pattern and would work here — every finding names the rule that graded it, and the table
travels in the report so the reader can check the grading rather than trust it. Evaluated in
order, first match wins:

| Rule | Grade | Why it outranks the next |
|---|---|---|
| The defect persists after the conversation ends | `serious` | It corrupts state a later session reads — routing history, a committed settings file. Nothing else here survives the turn. |
| An action is taken that the user was not shown | `serious` | A run planned against `go ahead` is not a bad answer, it is an unaudited action. |
| The turn misreports what will happen next | `high` | A stop that says nothing, a question deleted before it renders. |
| An affordance is lost but the information survives | `medium` | Chips missing on a question the user can still read and answer by typing. |
| The user is told less than the system knows | `low` | Cost absent from the footer; a question printed twice. |

Under that table this plan's P0 and P1 are exactly the `serious` findings, which is a useful
check on the sequencing: the ranking was argued before the table existed and the table agrees
with it. Adding it is a change to the harness's reporting only — no probe's verdict moves.

## Running alongside

The live battery (`evals/chat-window-live-battery.md`, 12 lanes, /136) has **not been run**. It
does not block any item here — every finding above is reproduced without a model — but it will
tell you which of them you actually feel, and it is the only way to catch the failures no harness
reaches. Probe **10.1** first: it reveals whether W1's overwrite is firing on ordinary turns.

## Commit discipline

Each work item is one commit: a SemVer bump in `package.json`, a matching `CHANGELOG.md` entry,
the README banner if the version changes, and the documentation rows named on the item — in the
same commit, per `CLAUDE.md`. Target `develop`. Do not batch P0 with anything else; those two
commits should be revertable on their own.
