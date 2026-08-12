# Changelog

**What changed in each release, newest first.**

This page carries the highlights. The complete, formal changelog lives in
[CHANGELOG.md](https://github.com/JoelBondoux/AtlasMind/blob/main/CHANGELOG.md).

A few things worth knowing as you read:

- **Version numbers follow SemVer.** Patch releases are fixes, docs and refactors; minor releases add
  features, commands or UI; major releases change something you'd have to migrate.
- **Every commit ships a version bump**, not just every pull request — so the version you see always
  corresponds to an exact state of the code.
- **The Marketplace version may trail the source version.** The badge shows what's published; the source
  version comes from `package.json` on whichever branch you're reading.
- AtlasMind stays branded **Beta** until 1.0.0, when the configuration and memory formats are frozen.

Older entries below describe the software as it was at the time and are deliberately left as written.

---

## v0.292.1 — The orchestrator says when it discards an answer

When every tool result in an agentic loop's final round tests as failed, AtlasMind throws away the
model's completion and substitutes a summary of the failures. That test matches substrings such as
`failed`, `cannot` and `not found` against **raw** tool output — and reading a file returns its
contents verbatim, so an ordinary source file can satisfy it. With one tool call in the round, a
perfectly good answer can be replaced by a failure notice.

The substitution now logs which tools were involved and what triggered each verdict, separating a tool
that declared its own failure from a bare keyword match on its output. The trigger token is recorded,
never the output itself, because the log persists and tool results can carry secrets.

Nothing branches on the new record and the substitution itself is unchanged — this is measurement,
added before any fix, so the size of the problem is known rather than assumed.

## v0.292.0 — Reusable component definitions and instances

UI Studio format v8 adds target-independent reusable components to the same revisioned graph as screens and
tokens. A definition declares a root type, typed properties, variants, bounded slots, and supported states.
The canvas creates an instance explicitly and may override only declared properties; definition edits and
instance edits remain visibly separate actions.

UI System edits definitions through exact host commands, while the canvas inspector assigns compatible
definitions, variants, states, property overrides, and parent slots. Studio, Full Preview, and the Markdown
mirror project the same facts. The v7 → v8 migration adds an empty collection and invents no component.

## v0.291.0 — Visual typed-token editing and preview projection

UI System now edits the v7 token authority directly: add typed values, make same-kind aliases, change a
definition, and delete an unused token. Every operation crosses the exact graph command boundary, advances
one revision, and participates in undo/redo. The host refuses broken dependency graphs and protects tokens
that still have aliases.

Reserved semantic ids now drive colour, typography, spacing, radius, and responsive breakpoints in both the
Studio canvas and Full Preview. The adapter additionally publishes every resolved token under a uniquely
encoded CSS custom property without turning graph ids into raw CSS. The Markdown mirror lists definitions
and aliases for review outside the Studio.

## v0.290.0 — Typed UI Studio token authority

Phase 3 begins with bounded typed token definitions inside the same authoritative graph as screens and
nodes. Colour, typography, spacing, radius, shadow, motion, and breakpoint values stay independent of CSS
or any implementation target. Same-kind aliases resolve deterministically and retain their source chain;
missing targets, cross-kind links, cycles, malformed values, duplicates, and oversized collections are
refused by the host sanitizer.

Website workspace format v7 adds an empty token collection to v6 graphs without inventing visual decisions
or changing any existing screen fact. The architecture record also fixes this boundary before reusable
component definitions and instances are added in the next Phase 3 slices.

## v0.289.0 — Responsive layout diagnostics

Every Studio breakpoint now reports viewport overflow, a child extending outside its clipping parent,
unintended visible-node overlap, and interactive nodes smaller than a 44px touch target. The touch threshold
uses the responsive lab's real 1280, 834, and 390px widths rather than treating canvas units as pixels.

The checks run over the same deterministic host projection used by Studio and Full Preview. Parent/child
overlap and overlay siblings are intentional and excluded. Findings carry only closed codes and graph
identities; clicking one selects the owning node and synchronizes that selection with Full Preview. This
completes the recorded Phase 2 responsive-layout milestone.

## v0.288.0 — Atomic multi-selection drag

Dragging any block in a multi-selection now moves the complete selection while preserving relative spacing.
The complete bounds stay on-canvas, and the primary block snaps against the grid and unselected blocks rather
than being attracted to another member of its own group.

Pointer-up submits one `set-node-frames` command, producing one revision and one undo step at the base,
tablet, or mobile breakpoint. The reducer validates the whole batch first; locked and container-positioned
members refuse the gesture, and group drag never reparents anything.

## v0.287.0 — Atomic subtree duplication and node locking

UI Studio can now duplicate a block together with everything nested inside it. The operation remaps every
identity and parent reference, offsets base and explicitly authored responsive rectangles, selects the new
root, and creates one revision and one undo step. The original remains untouched.

Lock keeps a node selectable and inspectable but disables canvas gestures, inspector edits, multi-selection
transforms, delete, and duplicate. This is enforced again in the host reducer: incomplete or colliding copy
maps, locked descendants, over-limit copies, atomic batches containing a locked node, and deletion that would
implicitly reparent a locked direct child all refuse without partial mutation.

## v0.286.0 — Stack wrapping and responsive child order

Stack containers can now continue onto another row/column, and every node carries a bounded responsive order
used before geometry/id tie-breakers in container flow. Fill claims its own wrapped line; fixed and hug items
pack until the next item no longer fits.

The same deterministic projection drives Studio and Full Preview. Neither wrap nor order rewrites stored
geometry, node-array order, or hierarchy. The closed edit boundary accepts only `nowrap`/`wrap` and integer
orders from -1000 to 1000.

## v0.285.0 — Responsive min/max constraints

Every node can now declare optional minimum and maximum width/height in canvas units. The bounds inherit and
reset with the existing layout-behaviour family, report per-property provenance, and constrain the same pure
screen projection used by the Studio canvas and full built-in-browser preview.

Constraints never rewrite the rectangle they limit: removing one recovers the retained drawn/intrinsic size.
The webview sends `null` for an empty field, and the host admits only finite canvas-bounded values with ordered
minimum/maximum pairs. Container-positioned children remain protected from direct movement, while a merely
size-constrained free node remains positionable.

## v0.284.0 — Container layout is real and shared with Full Preview

Free, stack, grid, and overlay now drive direct-child placement. Containers expose direction, gap, padding,
columns, alignment, and distribution; child axes support fixed, fill, and hug. One pure extension-host engine
projects the result into both the Studio canvas and built-in-browser preview at every breakpoint.

Responsive behaviour inherits with per-property provenance and resets independently of geometry/visibility.
Computed child rectangles name the container that positioned them. The underlying drawn rectangles are never
rewritten, so returning to free layout or undoing restores the exact prior arrangement. Layout messages remain
closed to named enums, bounded spacing, bounded columns, saved identities, and one optional breakpoint.

## v0.283.0 — Multi-selection transforms are atomic

Shift, Ctrl, or Cmd now toggles canvas blocks into a multi-selection. The inspector can align left, centre,
right, top, middle, or bottom; distribute three or more blocks across or down; clear back to the primary
selection; and nudge the group. The tools operate on base geometry or the active responsive breakpoint.

Every group transform is one closed `set-node-frames` command, one revision, and one undo step. The host
validates every unique identity and bounded rectangle before applying any of them, so a missing or invalid
target refuses the whole batch. Hierarchy is untouched, and multi-delete remains unavailable until narrowed.

## v0.282.0 — Responsive layouts support direct manipulation

Tablet and mobile nodes can now be dragged, resized from all eight handles, and nudged with the keyboard.
The gesture begins from the host-resolved rectangle, becomes an explicit override at pointer-up, and remains
revision-checked, undoable, resettable, snapped, and bounded like base editing.

The browser only paints an optimistic rectangle while the gesture is active; the extension host validates
the existing closed command and returns the authoritative projection. Drawing, deletion, nesting, and parent
changes remain base-only so a responsive adjustment cannot silently alter shared structure.

## v0.281.0 — Responsive layout is visible and editable in the Studio

The Wireframe canvas now switches among Desktop, Tablet, and Mobile using layouts resolved by the extension
host. Selecting a node—including one hidden at that breakpoint—shows computed geometry, visibility, layout
mode, sizing, and the exact base or override breakpoint behind every value.

Tablet/mobile geometry and visibility can be applied or reset independently through the revisioned reducer,
so returning geometry to inheritance does not discard an intentional visibility choice. The webview never
computes inheritance or submits a graph. Structural drawing and direct manipulation remain base-only until
responsive pointer editing is delivered explicitly.

## v0.280.0 — Full Preview responds to the saved design graph

The deterministic full-browser draft now projects the authoritative screen at tablet and mobile widths.
Geometry inherits in desktop → tablet → mobile order, visibility can change independently, and the spatial
canvas height follows visible content. The same result appears in VS Code's built-in browser and the fixed
Responsive lab widths across website, web-app, and native desktop reference projects.

Responsive rendering is static CSS from the pure renderer. Graph identities are escaped before becoming
selectors, a screen that does not own the rendered page is ignored, and no browser-write capability or
generated script was added; AtlasMind's frozen live reload/selection runtime remains the only injection.

## v0.279.0 — Responsive values inherit and explain themselves

UI Studio's Phase 2 layout work has begun. Desktop values now flow through tablet into mobile, and every
resolved mode, rectangle, size mode, and visibility value reports the base or override breakpoint that
supplied it. Migrated tablet/mobile bases remain honest about wider layouts: only an exact wider override
changes them.

Viewport geometry and visibility overrides use exact revisioned set/clear commands, participate in bounded
undo/redo history, and reject malformed, empty, extra-field, base-breakpoint, and stale requests. Clearing
an override restores the inherited value. All three reference projects exercise that behaviour.

## v0.278.0 — The UI Studio foundation passes all three reference projects

Phase 1 is complete with executable fixtures for a marketing website, a data-rich operations web app, and
a native desktop control room. Each scenario proves lossless v5 → v6 migration and reopening, the same
revisioned edit/undo/redo/stale-event behaviour, current-revision selection identity, and a deterministic
full-browser preview containing real review copy plus the frozen live runtime.

The tests also walk the graph shape itself: website delivery fields, source locations, surface profiles,
and Astro/React/SwiftUI target choices remain outside the authoritative target-independent graph. Phase 2
now starts from evidence rather than an assumed foundation.

## v0.277.0 — Canvas edits have one revisioned path

Drawing, moving, resizing, nesting, deleting, changing a block's kind, label, or design intent, and undo/redo
now use UI Studio's authoritative design graph and pure command reducer. Every accepted gesture advances the
revision exactly once; stale, malformed, invalid-parent, cyclic, oversized, and no-op edits are refused and
the canvas reconciles to host-owned state.

The webview sends an exact command, never a graph patch. Save carries only the revision the canvas observed;
the extension supplies the graph from its bounded edit session, so a tampered or stale webview cannot replace
the design document. Ctrl/Cmd+Z undoes and Shift+Ctrl/Cmd+Z redoes while revision continues forward.

## v0.276.0 — Studio and full preview select together

Selecting a saved canvas block now highlights it in every connected built-in-browser preview, and clicking
a deterministic preview block focuses that same node back in UI Studio. The exchange is presentation state,
not an edit: it never changes the graph or writes a file.

The browser may send exactly three bounded fields — the current render revision, screen ID, and node ID — to
one token-scoped endpoint. Stale revisions, unknown fields, malformed or oversized bodies, invalid IDs, wrong
methods/media types, and wrong tokens are refused. The extension resolves every accepted identity against the
current saved graph before the Studio sees it; paths, commands, source, graph fragments, and edit operations
do not exist in this protocol.

## v0.275.0 — Full preview follows the saved design live

An open UI Studio draft in VS Code's built-in browser now reloads when saved structure, UI-system choices,
or Markdown content produces a newer deterministic render. The listener is a frozen AtlasMind runtime on
the existing token-protected loopback server; it receives revision numbers only and cannot send edits,
paths, commands, graph fragments, or source code.

The live channel is deliberately small: two exact endpoints, same-origin-only CSP, at most eight listeners,
no event backlog, stale revisions ignored, and immediate connection cleanup when preview stops. Static
JavaScript in the preview root is still refused.

The screen inventory also keeps its own address now: `/` renders as `home.html` instead of overwriting
the `_wireframe/index.html` entry point, and its links resolve correctly from that folder.

## v0.274.0 — UI Studio gets an authoritative design core

UI Studio's complete visual-builder direction now lives in the repository as an approved product plan,
with phased requirements, acceptance criteria, reference projects, metrics, risks, and explicit decisions
about design authority and the built-in-browser preview boundary.

The first foundation is implemented too. Format v6 transcribes existing wireframes into one revisioned,
target-independent design graph without losing page structure or inventing responsive/component intent.
A closed edit reducer validates revisions, nodes, geometry, and hierarchy before changing the graph; its
bounded undo and redo keep revisions moving forward so stale browser events cannot become current again.

## v0.273.0 — Full preview becomes the design loop

UI Studio now has a numbered **Full Preview** step. Its primary canvas opens in VS Code's built-in
browser and combines the saved wireframe, UI colours and typography, and exact Markdown copy in one
deterministic draft. Each screen also includes a complete content proof, so clipped canvas copy cannot
hide and unresolved placeholders stay conspicuous.

The desktop/tablet/mobile view remains as a responsive inspection lab using the same guarded loopback
server. Model-generated output is linked from the preview index but kept separate from the live Studio
draft, so pressing Generate never changes what “preview my current design decisions” means.

## v0.272.0 — UI Studio designs the whole interface

Website Studio is now UI Studio. Website is a profile alongside web app, mobile app, desktop app,
editor extension, embedded UI and another/custom interface. The shared visual workflow covers screens
and flows, wireframes, the UI system, content, and a source-aware implementation handoff. Every profile
can generate a sandboxed HTML/CSS visual reference; only the website profile shows SEO, stack, hosting,
Delivery comparison and n8n.

Content Design is now a numbered step rather than a status somebody updates elsewhere. It records the
product voice, principles, terminology, comprehension target, locales and accessibility guidance, and
edits the real Markdown file for each screen. A missing file can be seeded only with explicit
placeholders. A file changed elsewhere while the Studio was open is refused rather than overwritten.

The SSOT moves to format v5. Existing work migrates to the website profile—the only kind v4 could
represent—and gets empty content and implementation guidance rather than invented decisions. Existing
command ids and `project_memory/domain/website.*` paths stay stable for compatibility.

---

## v0.271.6 — Branch choices and recency stay truthful

The Branch Dashboard now remembers its saved view, sort field, direction, grouping, and SCM-colour
choice after the panel is closed and reopened. Preferences remain workspace-specific and pass through a
closed host validator before they are stored; the webview keeps its own copy for immediate re-renders.

Recent activity now means the newest commit visible on the logical branch. When a local branch and its
upstream are folded into one card, AtlasMind uses the newer side's timestamp and commit summary, so a
behind or diverged local ref no longer sorts the whole branch as artificially old.

---

## v0.271.5 — Director attention and exact dashboard links

Project Director now gives assigned dashboard work the same treatment as Project State. Active work
owned by the contact marked as **me** joins due and overdue reminders under **Follow-ups**; its count is
visible on the Project Director title while collapsed, on the Follow-ups row while expanded, and on the
AtlasMind activity icon.

Project State and Director rows now open the page and the record they name. The validated deep link
carries only an allowlisted page/work kind and a bounded stable id. The dashboard clears a hiding view
filter, scrolls the record into view, gives it keyboard focus, and outlines it. A stale or unloaded id
still lands on the correct page. This also fixes the command bridge that accidentally honoured only the
Ideation page and discarded every other requested dashboard destination.

---

## v0.271.4 — Closed Project State keeps its attention signal

Collapsing Project State no longer hides the count. VS Code removes a view's title description with its
body, so the live signal now forms part of the native title itself: **Project State · N waiting**. The
title returns to plain **Project State** as soon as nothing needs attention.

The activity-bar badge and coloured **Waiting on you** row badge continue to use the same count; this
change closes the last presentation state where that count was available but invisible.

---

## v0.271.3 — Project State shows its badge inside the panel

The assignment count no longer stops at AtlasMind's activity-bar logo. The open Project State header
now carries an **N waiting** title signal, and **Waiting on you** uses a real coloured numeric tree-row
decoration rather than a plain trailing description.

This split follows VS Code's native API boundary: `TreeView.badge` is implemented as activity on the
view container and is not rendered inside an expanded view header. AtlasMind therefore sends the same
count through the container badge, title description, and row-decoration APIs, so all three locations
update together without replacing the native tree.

---

## v0.271.2 — Assigned work reaches Project State

Choosing your own Director identity as the owner of dashboard work now adds that active assignment to
Project State → **Waiting on you** immediately. Each assignment is a separate ToDo row with its status,
priority, and a link back to the branch, roadmap, issue, pull request, gap, risk, debt, document, run, or
Director surface that owns it.

The same number appears beside **Waiting on you** and in the Project State view badge, which VS Code also
shows on the AtlasMind activity-bar icon. Completed, cancelled, and assignments owned by somebody else
stay out of the personal count. Direct owner changes and external edits of the Project Director source
of truth now both run the same refresh path.

---

## v0.271.1 — Compact branch Work controls

The expanded Branch card no longer drops its Work actions into the narrow label column when an Owner
picker is present. Owner and actions now occupy one flexible content column, and the daily actions use
fixed-size icons instead of verbose pills. Hovering an icon still gives the complete action, eligibility
or blocker, and safety behaviour; assistive technology receives the same description through its
accessible label.

---

## v0.271.0 — Branch workflows and shared Director ownership

Expanded branch cards now separate everyday **Work** from **Review**. A user can bring a branch into
the workspace, prepare its pending changes in Source Control, pull with a fast-forward-only guard,
push or publish without force, create a new local branch at its current commit, and open GitHub's
pull-request form. Actions that do not apply remain visible but disabled with an explanation, so each
card also says what must happen next.

The browser still knows only the card's opaque id and a closed action name. The extension host rebuilds
the branch inventory, current working-tree state, tracking ref, live remotes and source commit before it
runs anything. AtlasMind does not commit automatically, choose merge versus rebase, bypass branch
protection, or force-push from this surface.

Project Director ownership now appears where work is actually discussed. The same person picker is on
branches, active roadmap items, open issues and pull requests, gaps, risks, debt, and documents needing
attention, while Director → Assignments lists active work so it can make the first assignment as well
as change one. These are not parallel assignee fields: every picker reads and writes the same sanitized
Project Director assignment record.

---

## v0.270.3 — Resolve & run prepares the complete release

**Resolve & run** no longer bumps only `package.json` and `CHANGELOG.md` and then discovers in the
pre-commit hook that the repository requires other release surfaces to agree. It now treats versioning
as one release-metadata operation: npm's root lockfile version, recognised README current-version
markers, the formal changelog, and an existing wiki changelog are synchronized and committed together.

The Detected Runbook also names **Prepare release version** as a prerequisite and surfaces an exact
repository release-preparation script when one is declared. Failed hooks are rendered from sanitized,
secret-redacted tail output, and verbose successful hooks receive a larger bounded capture buffer.

---

## v0.270.2 — Buzz persona-team implementation plan

The Buzz integration roadmap now records how Director will recommend a small set of useful
Buzz-facing AtlasMind roles—such as Engineering, Business, Marketing, Research and Oversight—from a
project's enabled agents. One AtlasMind agent may support several Buzz identities, while each identity
keeps its own constrained orchestration and permission ceiling.

The plan separates project-owned persona intent from local deployment state, the secret-free runtime
manifest, and Buzz-owned keys. It also requires a two-agent compatibility proof before a channel
default is enabled, so an unaddressed message reaches the default identity while an explicit specialist
mention produces exactly one specialist reply.

---

## v0.270.1 — Workflow status colour is quieter

The **Your workflow file** stage rows now follow the dashboard's standard status treatment. Colour is
limited to the segment outline and the **Enabled** tag; row contents and the larger state marker remain
neutral. The written **Enabled** / **Disabled** label and pressed state still make the distinction clear
without colour.

---

## v0.270.0 — Pipeline becomes a CI control centre

Pipeline now explains and manages the parts of CI that are usually hidden in YAML: what each workflow
defines, which events and branches assign it work, and which required checks make its result enforceable.
Each GitHub Actions workflow shows readable triggers, jobs, runners, timeouts, permissions, concurrency,
validation coverage and cautions, alongside its live run history.

Existing files can be opened or handed to AtlasMind for a proposal-first review. A Node repository with
no quality CI can create a starter from its declared branches, supported lockfile and package scripts
after reviewing the exact plan. Release and pull-request labelling automation are kept distinct from
code-quality validation. The browser supplies no YAML, path, branch or command, and creation never
overwrites a file.

---

## v0.269.1 — Workflow stages are clear at a glance

The Workflow page's committed-file card now colour-codes each stage segment: enabled stages use a
green accent and disabled stages use a muted treatment. Every segment also carries a larger marker and
an explicit **Enabled** or **Disabled** label, so the state remains clear without colour.

---

## v0.269.0 — Compact runbooks and one AtlasMind action language

The Delivery runbook now starts with every phase collapsed. The numbered phase marker carries the
strongest status inside — green when everything is configured, blue for a runtime convention, amber for
a manual or non-blocking gap, and red for a blocker — so the page stays compact without hiding risk.
Every non-green step has an AtlasMind-logo control that opens a focused repair draft after the host
rebuilds the current runbook from the workspace.

That logo is now the single visual affordance for asking AtlasMind to explain, check, draft, repair or
review something throughout the extension. Hover text names the exact action, and an accessible label
provides the same meaning without relying on the image.

---

## v0.268.0 — The runbook stops being something you retype

0.267.0's Delivery guide could tell you the right command. You then read it off the screen and typed it
somewhere else, which is the part that made it feel like documentation rather than a tool.

Every command in the detected runbook now has two icons — **⧉** copies it, **>_** types it into a
terminal named `AtlasMind Delivery`, opened at the project root — and every column header has a
**▶ Run** button for the whole phase.

The read-only framing that came with it is gone, and what replaced it is stronger, because it has to hold
now that there *is* a button:

- **The page names a step; only AtlasMind says what it runs.** The webview sends an opaque id and nothing
  else. The command is resolved by rebuilding the guide from your workspace, so a crafted message can
  name a step that does not exist — it can never supply a command.
- **Send to terminal does not press Enter.** The keystroke is left to you deliberately, which is why that
  button asks nothing first and running a column does.
- **A column run confirms the exact list**, in order, marking the commands that reach beyond your machine
  — a push, a deployment, a publication — and saying plainly that AtlasMind does not read the output.
- **Whether a failure stops the rest is stated, not assumed.** Commands chain with `&&` where the shell
  supports it. Windows PowerShell 5.1 does not, and an unrecognised shell has promised nothing, so there
  they are sent separately and the dialog tells you a failing test will not stop the publish behind it.

Which commands count as reaching beyond your machine is a written-down table, matched on word boundaries,
not a judgement call made per command. Guarded promotion is untouched: it remains the only path that runs
commands from a reviewed `delivery.json`, with its own preflight, approval and protected-stage gates.

---

## v0.267.0 — A delivery guide for the project in front of you

The Delivery page now answers the question a new contributor actually has: **what do I need, what do I
run, and what happens after that?** AtlasMind reads the project's own manifests, lockfiles, scripts,
delivery routine, stages, workflows, target and safety gates, then lays out Prerequisites → Validate →
Package → Deploy → Publish.

It labels where every step came from. A repository-declared command is **configured**; a standard Go,
Cargo, Python, Node, Maven/Gradle, .NET or container command is a **runtime convention**; a human gate is
**manual**; and an absent load-bearing step is **missing**. That makes the page dynamic without making it
confidently wrong. The guide is read-only — it displays commands but has no command-running action — so
the guarded promotion flow remains the only route that can execute a deployment.

The README's source-build comparison also catches up to the latest published tag, v0.266.3.

---

## v0.266.3 — One dependency advisory, and a note on the others

Pinned `js-yaml` to 4.3.1, clearing a high-severity advisory about CPU consumption when parsing a
particular YAML construct. It only ever reached the tree through the packaging tool, so it never
shipped inside the extension — but a clean audit is worth more than an argument about exposure.

On the eleven alerts GitHub is showing: those are **already fixed here**. Dependabot scans the
default branch, which is `main`, and `main` is still on 0.257.5 — several releases behind, without
the dependency overrides that resolved them. They clear when `main` next catches up. Nothing is
outstanding on `develop`.

---

## v0.266.2 — The shared panel theme, actually applied

v0.263.0 said every panel had moved onto the Project Dashboard's design language. The code for that
had been written but never committed — it had been sitting in a working tree the whole time, which is
why v0.266.1 had to ship the half of it the Website Studio depended on.

This is the rest: twenty-six panels opting into the shared skin and deleting the private palette each
had grown. Five different prefixes collapse into one definition, and the release note from v0.263.0
is now true.

Colour that means something is untouched — the Ideation board's tinted notes, the chat transcript,
warnings, each Lens accent. The Personality Profile keeps its warm palette on purpose.

---

## v0.266.1 — A build fix

Website Studio was using a piece of the shared panel theme that had not been committed yet: the
panel asked for the shared skin, and the code providing it existed only as work in progress. It
compiled on the machine doing that work and nowhere else.

This commits the missing half — the shell option and the shared tokens. Both are purely additive, so
panels that have not moved onto the shared theme are unaffected. Nothing looks different.

---

## v0.266.0 — You can finally see the wireframe, and your client can finally talk about it

**The preview was showing a white page.** Here is why, because the reason is more interesting than the
fix: there was no code anywhere in AtlasMind that could turn a wireframe into HTML. The only HTML in
the whole core was the preview server's error page. So a wireframe could not reach a browser at all
without first spending a model call — and if you opened the preview before generating, you got that
error page, which is white with one line of small grey text.

Wireframes now render straight to HTML with **no model involved**. Instant, free, and the same every
time, so the preview becomes something you work against — draw, look, adjust — rather than something
you pay to consult.

And every block is *obviously* a placeholder. Hatched fill, dashed border, its own label. A text block
is grey bars, not lorem ipsum. An image is a crossed rectangle, not a stock photo. Your nav shows the
real page names from your sitemap, because those are facts rather than filler. The banner says
outright that nothing on the page is real content.

That last point is the theme of this release.

**Generated pages used to be full of invented copy** — plausible headlines, fictional testimonials,
made-up statistics. That is worse than an empty page, because an empty page is obviously unfinished
and a page of confident fiction gets signed off.

So page copy now lives in **markdown files under `content/`**, one per page. A copywriter edits them in
their own editor. They diff properly in a pull request. Every static framework in the Stack catalog
reads markdown natively. And where the words are not written yet you leave a `[PLACEHOLDER: what is
needed]` marker — which AtlasMind *counts*, so a page's readiness is "four placeholders remaining"
rather than a status somebody ticked.

Generation reads your real copy and is explicitly told not to fill the gaps.

Two distinctions in there are load-bearing. **A page with no content file is not the same as a page
with an empty one** — one has not been started, the other was started and left blank — and they stay
different everywhere. And **the file always wins**: if you edit the markdown while the Studio has it
open, the save is refused rather than merged, because automatically resolving two versions of somebody's
prose produces a document neither of them wrote.

**Then your client can comment on it.** Not by emailing "the hero is too big" and leaving you to work
out which hero. They open the site, click the thing they mean, and type.

Comments are anchored to the actual element, tracked through open → addressed → resolved, and turn into
scoped work with one click — using the element-prompt machinery from v0.264.0. They *transition, never
delete*, because "we fixed it" and "we decided not to" are different facts. And if you delete an
element somebody commented on, **the comment survives and is flagged**, still carrying the element's
old label. That is the evidence the thing was removed while under review — and it is exactly the
comment a naive implementation loses.

**AtlasMind hosts none of this.** The review overlay is generated *into your site*, so it travels to
the password-protected staging environment the Stack page already sets up — your client's own hosting.
Comments come back either as a file they download and send you, or by POST to an endpoint you already
own. No endpoint is ever invented: unset means download-only, and the page then cannot make a network
request at all.

That was a real architectural decision rather than a default, and it is written up in
`project_memory/decisions/website-client-review-hosting.md` — including the things it deliberately
cannot do: no live presence, no threaded replies, and comments sitting in the client's browser until
they send them.

The overlay is the only place AtlasMind puts JavaScript into a generated page, so it is a **frozen
constant**: hand-written in one file, never touched by a model, with nothing from your project
interpolated into it — its settings travel in a data attribute instead. The preview server's script
exception is one named file, not a widened rule.

---

## v0.265.0 — Website Studio can start the project, not just design it

v0.264.0 let you design a site. It still couldn't *start* one — you'd plan a whole Cloudflare Pages
site and then be left to `npm create` it yourself, guess the build command, and hand-write the deploy
config. Because nothing in AtlasMind knew what a framework was. It knew your project was a "website";
it had never heard of Astro.

**The Platforms page is now a Stack page**, and it covers both halves — because they're one decision.
"Astro on Cloudflare Pages" has a known build command, a known output directory and a known deploy
config; splitting the choice across two pages just meant you had to already know which pairings work.

Ten frameworks, each graded against your chosen platform, each with the reason written on the card.
Including the ones that don't fit: pick Shopify and Hugo still appears, marked unsupported, saying
"Shopify serves Liquid templates from its own theme system, so a separate build has nowhere to go."
Removing it would have left you wondering where it went.

**Then press "Set up this stack".** AtlasMind runs the framework's own create command, writes the
deploy config for your host, adds the dev and build scripts, writes a `.env.example` with the variable
*names* and no values, and creates your develop, staging and production branches. Turn on CI
generation and it writes a GitHub Actions workflow that deploys each branch to its own environment.

You see all of it first — every command with what it's for, every file with its full contents,
including the whole workflow YAML. Nothing is summarised, because a confirmation nobody can read only
launders responsibility.

Some things about how it behaves are deliberate:

- **Every command is a constant in AtlasMind's source.** Never composed from a setting, never parsed
  out of documentation, never written by a model — any of those would be remote code execution with
  extra steps. And nothing runs through a shell.
- **Everything is create-only.** A config file, a script, a branch, a workflow: if it's already there,
  it's reported untouched. Re-running a setup is safe, which matters because coming back to a
  half-configured project is exactly when you need it.
- **Frameworks we don't have a verified command for don't get one.** Custom stacks, plain HTML and
  WordPress themes are honest about the gap rather than improvising something that usually works.
- **Success is checked, not assumed.** A scaffold command can exit zero having done nothing; the
  report comes from looking at the filesystem afterwards.

Three separate switches, all off by default: scaffolding, generating CI, and letting AtlasMind run
your hosting provider's CLI. They're separate because they're genuinely different decisions — the last
one authenticates as you and creates billable resources on your account, and a run that fails halfway
leaves them orphaned. With it off you still get the exact command; you just run it.

The generated workflow gets the same care as everything else. It's built from a declared template with
only checked values substituted, never by a model. Production deploys declare a GitHub Environment, so
you can require reviewers on GitHub's side and not just trust ours. Secrets are named, never written.
An existing workflow is never replaced — losing somebody's deploy pipeline to a scaffolder isn't
something you recover from in an editor.

**And the Stack page now cross-checks itself against Delivery.** Website Studio keeps its own three
environments, which means the two copies can drift apart. Rather than pretend otherwise, the page
tells you exactly which fields disagree and what each side says — and when nobody has compared them
yet, it says that too, instead of showing a reassuring blank.

There's also a strategy document in the repo now, at
`project_memory/ideas/website-studio-strategy.md`: an honest read of where Webflow, Framer, v0 and
WordPress each genuinely beat us, the five gaps worth closing in order, and what we should
deliberately *not* build. Worth arguing with.

---

## v0.264.0 — Website Studio: draw the site, point at it, and watch it build

Website Studio could describe a website. It could not show you one.

A "wireframe" was the first eight strings from a page's section list, rendered as coloured blocks on a
three-class CSS grid. It had no position, no size, no nesting and no identity, so nothing downstream
could act on it and no two people looking at it were looking at the same thing. The sitemap was a flat
table: adding `/services/seo` produced another row, not a child of Services. Nothing knew that Home's
nav pointed at Services, or that nothing at all pointed at the page you added last week. And there was
no way to see the result — the extension had no preview anywhere.

**Now you draw the page.** Pick a nav, a hero, a grid, a card or a form from the palette and drag it
onto a snapping 12-column grid. Resize from eight handles. Drop one block inside another to nest it.
Nudge with the arrow keys, delete with Delete — and deleting a wrapper *promotes* what was inside it
rather than quietly taking six cards with it. Every block is a real focusable control that announces
its kind, its width and where it sits, so the canvas is not mouse-only.

Coordinates are stored on a fixed 1000-unit grid rather than in pixels. `website.json` is committed, and
pixels would record the author's monitor size — the same design would then read differently on a laptop
and a 4K panel. You never claimed "980px"; you claimed "most of the width".

**The sitemap draws itself.** Hierarchy comes from the slug path as pages are added, so `/services/seo`
appears under Services without anybody drawing an edge — and an explicit parent overrides it, because a
decision somebody made on purpose outranks a naming convention. A page whose slug names a parent that
isn't there goes to the top level *and says so*, rather than being hidden or attached to the nearest
thing that happens to exist. The map is deterministic: the same pages always produce the same picture.

**The inventory knows where every page leads** — outbound links, inbound counts, pages nothing links to,
and links whose target was deleted. A broken link is kept and marked, never tidied away; it is the
evidence that a nav is broken. Nav and CTA blocks suggest links by matching their label to a page title
exactly or case-insensitively, and never more loosely than that: "Get in touch" silently wired to "Get
Started" is a wrong answer that looks like a right one.

**Select anything and just say what you want.** Click a hero, type "full-bleed photo, headline left, one
button", and Atlas receives a prompt that names the selection completely — what kind of thing it is,
what it's called, how wide it is, what contains it, which page it's on, and the shared design tokens it
has to stay consistent with. That's what makes "make this wider" answerable. It works for a whole page
and for the whole site too. Everything read out of the project file is fenced as reported content,
because labels and stored prompts can be written by a model; your own sentence isn't fenced, because it
is the instruction.

**Every page can carry a design prompt in plain English** — which means a whole site can reach
first-draft design from the sitemap alone, without anybody drawing a single box.

**And Generate works from wherever you are.** From the brief you get a one-page concept. From the sitemap
you get every page, each driven by its own prompt and wired to the others. From a wireframe you get that
page with the layout you drew honoured. From a selected element you get that element reworked. The
result renders in a preview window that opens beside the Studio.

Three things about Generate are deliberate. The file list is **decided before any model runs**, so the
confirmation dialog names every file you're agreeing to and the same sitemap always produces the same
list — a plan a model composed would differ on every press and nobody could learn what "yes" means.
Files land **only** in `.atlasmind/website-preview/`, never in your source tree. And what a stage
*couldn't* account for is reported with the result: generating from a brief cannot honour a layout that
doesn't exist yet, and a partial answer stored as a whole one lies by omission.

Both switches are **off by default**, and they are two switches rather than one: writing model-authored
files and opening a local port are different decisions, and one control carrying both would make the
second happen without being agreed to. The preview server binds `127.0.0.1` only, serves nothing but the
preview folder, has no directory listing, and puts a random per-session token in its URL so another
process on your machine can't simply guess the port and read your client's work. It stops when you close
the window.

Existing projects migrate automatically: your old section lists become stacked bands on the canvas, so
nothing opens onto an empty page. Design prompts and links start empty rather than guessed — a migration
has no business writing a design intent on your behalf. And a `website.json` written by a *newer*
AtlasMind now opens read-only with an explanation, where an older build would previously have
overwritten it without a word.

---

## v0.263.0 — One design language, across every panel

Every AtlasMind panel now looks like the Project Dashboard. Settings, MCP, Model Providers, Agent
Manager, Mission Control, Run Center, Cost Dashboard, Model Comparison, Website Studio, Ideation,
Vision, Voice, Specialists, Tool Webhooks, Skill Scanner, Chat and the ten Lens surfaces draw the same
card, the same header, the same tab and the same input.

The reason they didn't is structural rather than careless. Each webview is an isolated document, so a
panel genuinely cannot inherit another panel's stylesheet — the tokens have to be injected into each
one. What that produced over time was nineteen palettes under five different prefixes, four of them
near-verbatim copies of the dashboard's that had each drifted by a radius here and a surface mix
there. None of it was ever decided; it was what happened when a panel written in March could not see
one written in July.

The fix is one definition applied in two layers, and the ordering is the whole idea: the tokens and
the page frame go in **before** a panel's own CSS, and the surfaces go in **after** it. So a panel
keeps its layout — where its cards sit, how its columns wrap, what stays stuck to the top — which is
the part it legitimately owns, and loses its private palette, which it never really chose.

Some things are deliberately left alone, because a shared surface must not overwrite a colour that
means something. The Ideation board's sticky notes keep the tint you gave them. The chat transcript
stays a conversation rather than becoming a deck of cards. Warnings keep their warning colour. And
each Lens keeps its own accent — eight lenses, eight hues, so the rule under the title still tells you
which one you are reading.

The **Personality Profile is unchanged**, on request. Its warm palette is a choice, not drift.

---

## v0.262.0 — The Pipeline page can read CI itself

CI was only ever fetched as a side effect of the Issues refresh. The one page whose entire subject is
*did the build pass* therefore had no way to go and find out — its empty state told you to open a
different tab. It now has its own **Refresh CI**, costing two `gh` calls instead of that refresh's
five, so watching a build no longer means re-reading a hundred issues.

An empty run list also stopped meaning two opposite things at once. "This branch has never been
built" and "we could not ask" rendered identically, and only one of them is good news; the page now
reports the failure, its reason, and the command that fixes it, and does not show stale runs
underneath a fresh timestamp.

Separately, the **CI pass rate** on the Workflow page had been hardcoded to *not measured* — wired to
an empty array left over from a phase that had no check-run fetch, so it abstained however many runs
were already in memory. It now derives from the checks on the head commit. Just that commit is the
point: the metric answers questions about one commit, and a fortnight of branch history would have
kept its labels while changing their meaning, reporting a clean commit as 60% green because of
failures somebody already fixed. A re-run counts as another attempt at one check rather than a second
check, and a build still running contributes no duration — its last-updated time is not a completion,
and treating it as one would report a slow build as fast exactly while you were watching it.

---

## v0.261.1 — Security: all six open advisories cleared

Four high, two moderate. `npm audit` and Dependabot agreed on the set, and every one was a transitive
dependency pinned by its parent — which is why `npm audit fix` changed nothing at all while still
reporting that a fix was available. The real fix was version overrides, and one of the overrides
already in the project turned out to be what was holding `undici` inside the vulnerable range.

Patched: `undici`, `ip-address`, `fast-uri`, `brace-expansion`, `hono` and `postcss`. Three of them
ship inside the extension; the other three are build-time only. Each override was checked against
what its parent actually requires before being applied, and two are deliberately held *below* the
latest version because the next major would break the package that depends on them.

One thing worth knowing if you hit this yourself: `npm install` reported *"up to date … found 0
vulnerabilities"* while the vulnerable versions were still sitting in `node_modules`. The audit was
reading the lockfile's intent rather than the installed tree. `npm ci` was needed to make it real,
and the fix was confirmed by reading versions off disk rather than trusting the summary line.

---

## v0.261.0 — Connect a database directly, and measure it

The live lenses shipped reaching a database only through a connected MCP server. Most people with a
Neon, Supabase, RDS, Railway or self-hosted instance don't have one, so the practical answer to "can I
point this at my database?" was "install something else first". Now there are three direct kinds:
`postgres` and `mysql` connect with bundled drivers, and `sql-http` reaches vendors that expose SQL
over HTTPS and have no wire protocol at all.

That changes a boundary the previous release stated, so here is the honest version that replaces it:
**AtlasMind never *composes* SQL — it sends a *constant*.** Every statement lives in one file as a
module-level constant with no interpolation, no parameters, and no code path that accepts a fragment
from a caller, a setting, a webview or a model. A test walks every statement the code can emit and
fails on a write verb, a placeholder, or a second statement. It's the same guarantee the GraphQL
introspection query already carried. Going through MCP still refuses a generic query tool, for its own
reason: with somebody else's tool AtlasMind can't guarantee what happens to the string it hands over.

Everything runs inside `BEGIN READ ONLY` with a timeout, opened first and **not optional** — a server
too old to support it fails the probe rather than getting one that runs unguarded. The connection is
closed on every path, including failures; one left open against a production pooler is a worse bug
than anything it was looking for.

**It also measures.** Row counts, table and index sizes, constraints, how stale the statistics are,
latency percentiles with cold starts called out separately, and the query plan. Every number comes
from the catalog the database already maintains — no `COUNT(*)`, no table scan, no row of your data
read to produce any of it. And **a table nobody has analyzed reports unknown, never zero**, because
"this table is empty" is the most expensive thing this could get wrong in front of somebody checking
whether a migration ran. Each estimate carries when it was last refreshed, since a row count from a
table last analyzed in March is a fact about March. `EXPLAIN` is sent without `ANALYZE` — a probe that
executes whatever it explains is a shape nobody should build.

**The connection string goes in the OS keychain and nowhere else.** `AtlasMind: Store a Live Service
Credential` takes it through a password box: never echoed, never logged, and validated by *parsing*
rather than by connecting, so a typo fails while you can still see what you pasted instead of opening
a socket to whatever host it produced. The parsed host, database, user and TLS mode are shown back —
that's what catches a production string pasted into the staging endpoint. The committed file only ever
names the key, that name is namespaced so it can't reach a model provider's credential, and driver
errors are scrubbed of anything connection-shaped before they can reach a dialog.

AtlasMind can't verify what a credential is permitted to do, so it recommends a read-only role at the
moment you store one. Least privilege is the control that doesn't depend on AtlasMind being correct.

---

## v0.260.0 — The lenses can look at your live services

Every lens read the repository, which meant the question people actually have — *does the running system
still agree with what the code believes?* — was one AtlasMind could not answer. Field Wiring could compare
two declarations and said so in its own limit line. Nothing could compare a declaration against reality.

Three new lenses close that. **Live Contract Drift** compares the schema your repository declares against
the one a live API or database serves, and names every field that has gone missing, changed type, or
turned up without being declared. A field the code declares and the service doesn't serve is a dead end
and a schema failure at once — kept deliberately separate from a field the service serves that nobody
declared, because those need opposite fixes and one combined "mismatch" would hide which you're looking
at. **Service Reachability** asks the prior question: which declared services answered at all, which
didn't, and which nobody has looked at. **Live Data Trust** lists the fields a service actually serves
that no classification covers — unknown sensitivity on real data currently crossing the wire, which the
static view can't see because the field was never in a file.

**It reads shape and nothing else.** An API probe fetches the OpenAPI document the service publishes or
sends one fixed introspection query; a database probe asks a connected MCP server what tables and columns
exist. There is no function anywhere in that path that accepts a query, so `SELECT * FROM users` isn't
something any caller can reach — and value-bearing keys like OpenAPI `example` and `default` are dropped
*by name*, because they're where a real customer record ends up when somebody pastes one in while
debugging.

Which services may be reached is a **committed file**, so a change to what AtlasMind can touch arrives as
a diff with a reviewer. It names a stored secret rather than holding one — a file containing an actual
token is refused whole rather than quietly cleaned up — and it's the one declaration kind Atlas refuses
to draft, because a hostname nobody typed is a request sent to a stranger in your name.

Probing is off by default. Production isn't in the default allowed environments, and **an endpoint that
doesn't say which environment it is gets treated as production**, asking you to type its name before every
probe. Redirects aren't followed. Databases go through an MCP server you already approved, and only via a
tool whose name says it reads schema — AtlasMind bundles no database driver and won't compose SQL for a
generic query tool.

And an unassessed service is never reported as healthy: refused, timed out and never-probed stay distinct
from unreachable, and a drift report for an endpoint nobody probed says outright that this is not a
finding of "no drift".

---

## v0.259.0 — "Promote to staging" means what your project says it means

AtlasMind records your delivery pipeline — the stages, what each one is called, which branch represents
it. The chat side never read it. Ask it to promote to staging and it would go looking for a branch called
`staging`, fail to find one, and ask you which branch you meant — while the answer sat in a file AtlasMind
had written itself.

It now reads that file before answering, and **a stage's kind counts as a name**, so "staging" finds your
staging stage whatever you called it. (In this repository that stage is called `Integration`, which is
exactly why matching only display names wasn't good enough.) It will not invent a stage you never
declared: a wrong stage name aims a promotion at the wrong branch, and that isn't a mistake you can fix by
editing a file afterwards.

**A request to merge now arrives with the tools to merge.** Tool selection worked word by word, so "merge
to main then publish" — which contains neither *commit* nor *push* — was given the three tools that
describe a repository and none of the tools that change one. A model handed that set doesn't stop; it
writes a confident report about a merge it never made, which is worse than failing outright because the
report reads like work. Merging, rebasing, cherry-picking and promoting now get the write tools together.
Asking a question *about* a commit still doesn't hand over the ability to publish one, and every tool
stays behind its normal approval prompt.

**A failing provider costs you less.** Three things changed when a subscription agent crashes mid-turn:

- AtlasMind no longer walks back into the same broken process under a different model name. It already
  avoided that when recovering from a failure; it now also avoids it when *upgrading* to a stronger model,
  which was a way back into the endpoint the turn had just watched fail.
- Recovery has its own budget. An optional quality upgrade used to spend the attempts that a real outage
  would need, so a turn that escalated once had one attempt left to survive a provider going down.
- The next message doesn't start with the endpoint that just failed twice. It's set aside for ten
  minutes — unless it's the only thing that can do the job, in which case AtlasMind tries it rather than
  refusing you.

And when it does give up, it names the limit it actually hit instead of reporting a ceiling it never
reached.

**Large tool sets no longer flood the context.** An agent set to use every skill was sending every tool
description on every query, including every connected integration, however small the question. There's now
a ceiling of 24 for all agents. If your list already fits, nothing changes; when it trims something, it
says so — a silent cut reads as "this is everything I have".

---

## v0.258.0 — The Lens declaration files come with a guide

Two of the eight lenses read a file you have to write yourself. Until now the help on offer was an empty
`{"version": 1, "machines": []}` and the advice to use schema autocomplete — which only helps if you
already know both what the format means and what your project's state machines are.

**AtlasMind: Lens: Declaration Guide** — also `/lens`, also every **Show me how** button on the Lenses
dashboard — says what each file is for, shows a worked example small enough to read in one go, and can ask
Atlas to read your repository and propose a first draft.

A draft is a proposal, never a write:

- It goes through **the same check the lens itself uses**, and is refused whole if it fails rather than
  patched up. A repaired draft would be AtlasMind inventing your project's topology in a way that then
  looks derived from it.
- **Every file path it claims is verified** against your workspace and dropped if it does not resolve. A
  plausible-but-wrong path renders, draws, and leads nowhere, which is worse than no link at all.
- **Any value that looks like a credential is left out of the file entirely.** These files are committed,
  so masking it on screen would still put the secret in your repository.
- You see the whole thing, with **every correction listed**, before anything is written — and entries you
  wrote yourself always win over drafted ones.

Two more declaration files are now visible as well: `lens-mappings.json` (Field Wiring overrides) and
`lens-data-trust.json` (Data Trust policy). Both are **optional** and neither is ever counted against you,
so a project that has declared its state machines and its configuration precedence reads as finished.

## v0.257.5 — Windows launcher tests now report why they failed

`acpWindowsLauncher.test.ts` still launches real process trees, but the test timeout now sits above the
child timeout so the child process's own error appears instead of Vitest killing the test first.

The release also corrected reader-facing docs so the wiki matches the runtime: `wiki/Home.md` now says 27
built-in agents, and `wiki/Remote-Control.md` now names the gateway enable command and no longer
contradicts its own settings table.

---

## v0.257.4 — Windows launcher tests can report why they failed

The three tests that launch a real Windows process tree gave their child processes a 10-second limit
while declaring no limit of their own, so they inherited the 5-second default and were killed before
the child limit could fire. A failure arrived as a bare "timed out in 5000ms" with nothing behind it.

Both limits are now named, with the test's above the child's so the child's own error is what you see.
No assertion changed.

## v0.257.3 — Three documentation corrections

`Home.md` still claimed 21 built-in agents where the runtime registers 27 — the figure was fixed in the
README but missed on the wiki's front page, leaving the two most-read documents disagreeing.

The Remote Control page also gained the `AtlasMind: Enable Remote Control (Gateway)` command in its
"Turning it on" table, where gateway mode was previously only mentioned in prose further down, and its
safety table no longer contradicts its own settings table about whether `atlasmind.remote.enabled`
starts the server. It does not; the commands do.

## v0.257.2 — Documentation written for the reader

The README and all 24 wiki pages are rewritten for people evaluating and using AtlasMind rather than for
the people maintaining it. Every page now opens by saying what the thing is, who it is for, and what it
does for you, before any implementation detail.

Release archaeology and maintainer-facing rationale are gone from the user-facing pages; the reasoning
that explains a behaviour you will actually meet is kept and stated plainly. Every technical claim,
count, setting name and safety boundary is preserved.

The README's 165-line block of internal release notes becomes a short "what's new" plus five user-visible
highlights, and its 50-row source-file table becomes a 12-row map. A stale figure is corrected: the
README claimed 21 built-in agents where the runtime registers 27.

`Configuration` now opens with the six settings people actually change, and two settings are labelled
honestly as declared-but-not-read rather than described as working controls. `Architecture` becomes a
readable overview, with the full service map staying in the contributor docs. The last pointer to the
long-removed competitor comparison page is gone.

## v0.257.1 — Atlas Lenses gets a dashboard, and one visual language

Lens had eight surfaces and no front door: each was reached by knowing its command, and nothing said what the set was or why one of them refused to open. **AtlasMind: Lens: Open Atlas Lenses Dashboard** is that door — every lens with the question it answers, a plain-language explanation, the evidence it reads, whether it is ready, and the declared rule behind the verdict. A flow map draws evidence → lens → question, hovering follows the links, everything is clickable, and a **Do this next** band ranks only what needs a person, empty when nothing does. All eight surfaces now share one stylesheet, one card, one header, and one flowing-link renderer: state transitions curve between the states they connect, impact links point into the selected symbol from its callers and out of it to its callees, and configuration precedence flows to the source that wins. A ⓘ on each lens says what it cannot prove, so "no test evidence found" cannot be read as "this code is untested". Review follow-up in 0.257.1: the `no-contract-files` rule now describes the condition it actually tests — fewer than two contract sources, not none — since that rule table is published on the page precisely so a reader can check the grading.

---

## v0.256.0 — One request, one declared delivery route

Commit, push, pull-request, promotion, and publication requests can now follow the project’s enabled declared workflow in the same chat turn. `atlasmind.workflow.chatGuidance` defaults to `follow`, so AtlasMind no longer asks for a second “follow the workflow” message after the operator already named the desired outcome. `inform` remains available for a visible non-blocking note, `gate` remains the explicit stop, and `off` remains silent.

Following changes sequencing, not authority. Existing tool approvals, automation ceilings, protected-ref checks, release gates, and outward-write confirmations still apply. The host gives the Orchestrator only a narrow validated policy object; free-form repository text never becomes system-prompt instruction. Unrelated working-tree edits are left untouched, and branch-changing delivery work prefers an isolated temporary Git worktree instead of stashing or switching the operator’s active checkout.

## v0.255.3 — Quiet authorized ACP execution

**Let subscription agents act** now means what its opt-in wording suggests for routed tool-backed work: once enabled, AtlasMind automatically answers readable ACP operation requests with `allow_once` rather than showing a modal for every edit, command, or search. Ordinary completions remain isolated, the Orchestrator must still authorize the exact tool-backed provider request, every operation is classified and logged, disabling the setting is checked live, and no permanent `allow_always` grant is stored inside the external agent.

On Windows, capability probes, routed models, replacements, and later tool processes remain under one native supervisor. With private mode enabled, that parent owns a non-interactive window station, a kill-on-close Job Object, and one `SW_HIDE` console inherited by the complete tree. A later shell therefore does not allocate a separate blank `conhost.exe` or take focus. Npm adapters use a real `node.exe` rather than VS Code's GUI `Code.exe`, and native plus shipped-binary tests exercise supervisor → Node → PowerShell and verify that the nested console is not visible.

## v0.255.2 — Feedback workspace documentation updates

The latest release includes documented updates to ideation workspace feedback tracking and chat-command guidance. The changes capture AtlasMind workspace ideas and command coverage used by the current project context.

## v0.255.1 — Clearer branches and reliable hidden ACP PowerShell

The Branch dashboard now uses VS Code's theme blue for local branch-title chips and theme purple for remote-only chips. The persisted **Show SCM colours** checkbox has moved directly above the branch-card inventory and sits beside a live Local/Remote preview, so the setting and its effect remain in the same place.

The opt-in Windows ACP helper now gives processes on its non-interactive station the documented station/desktop access sets and lets children inherit the established connection instead of reopening generated objects by name. PowerShell can therefore initialize there without the blocking `0xc0000142` dialog. Inherited Windows error-mode flags also keep future loader failures on the process failure path instead of presenting an unattended modal dialog.

## v0.255.0 — Refreshes show their work

Every Project Dashboard refresh now carries visible progress inside the button that started it. The dashboard-wide action, Issues, Pull Requests, branch PR/CI, remote branch fetch, and branch-review controls share the same VS Code progress colour, active label, disabled duplicate-click state, and accessible busy announcement. Progress follows explicit extension-host start and finish messages rather than an arbitrary animation timer; reduced-motion users see a static fill.

The dashboard-wide refresh is also available without scrolling: press **Ctrl+Shift+R** on Windows/Linux or **⌘⇧R** on macOS anywhere while focus is inside the dashboard. The shortcut is visible beside the header action and carried in its tooltip and accessibility metadata.

## v0.254.0 — A quieter, ordered Branch dashboard

Branch cards now start compact, leading with branch identity, readiness, CI, traceability, and the latest commit. Click a card to disclose its full evidence and actions, or use **Expand all** / **Collapse all** for the whole inventory. Commit subjects truncate with an ellipsis when necessary and retain their complete text on hover.

Review Details is no longer a detached panel above every branch. It stays absent until the explicit action is pressed on an expanded card, then appears immediately below that branch and can be closed. Failing CI, blocked readiness, merge conflicts, change requests, unresolved review comments, and broken branch state now use critical red styling rather than sharing amber with pending signals.

Ordering is explicit in both directions: newest/oldest activity, highest/lowest risk, most/least drift, and A–Z/Z–A. Branch-family grouping keeps matching prefixes together while applying that order inside each family. A persisted checkbox can render branch names as chips using VS Code's own Source Control Git-decoration colour.

## v0.253.1 — Exact-ref Lens answers and stricter ACP isolation

**Ask Atlas** from a Change Story now reads the selected Git ref and changed path rather than asking a model to infer a cached remote file from the checked-out workspace. The Orchestrator validates the one-shot context and sends a bounded, explicitly fenced patch plus small-file content as a model-visible message. Large files receive the patch and object size; a failed read refuses the handoff. These turns are completion-only and cannot invoke workspace or ACP-native tools.

ACP delegated execution now requires two independent gates: the global **Let subscription agents act** setting and authority on the exact provider request. An ordinary completion shares no configured MCP servers and receives no permission policy. On Windows, the opt-in helper now launches the agent on a token-ACL-scoped, non-interactive window station and its default desktop, closing the path where a descendant could choose a new desktop on `WinSta0`. It remains same-user, stdio-only, hash-pinned, Job-bounded, disclosed, and fail-closed.

## v0.253.0 — Lens declarations explain their setup

State Lifecycle and Configuration Resolution no longer assume users already know about their repository-authored inputs. The Getting Started walkthrough, Settings → Project Runs, and Project Dashboard Overview now show or link to the same declaration setup flow. The dashboard reports whether each required file is missing, an empty starter, ready, invalid, or unreadable.

**AtlasMind: Lens: Set Up Repository Declarations** creates a valid empty `.atlasmind/lens-state.json` or `.atlasmind/lens-config.json` starter and opens it with the installed schema/autocomplete. Creation is exclusive and never overwrites an existing declaration; the starter contains no invented project states, transitions, configuration values, or secrets. Missing-file messages explain why the active editor is not used and offer the same direct remedy.

## v0.252.1 — Dedicated implementation branches

AtlasMind's committed workflow now permits branch creation and local development for this repository. Issue intake, pull requests, CI, release, maintenance, and general automation retain their existing limits, so the permission change is deliberately scoped to building work on dedicated branches.

## v0.252.0 — Branches becomes the daily decision dashboard

Project Dashboard → Branches now answers the operational questions behind the inventory. Every card combines local drift with the last explicitly loaded PR, review decision, mergeability, unresolved review comments, branch-level CI, issue linkage, and roadmap references through one deterministic rule table. The result is a visible readiness verdict with its reasons, not a model score; GitHub evidence that has not been loaded remains unknown instead of becoming a reassuring zero.

PR/check context, requested-reviewer and “mine” signals, issue/roadmap traceability, and cleanup candidacy sit on the card. My branches, Needs my review, Ready, CI failing, and Cleanup are persisted views with separate scope, sorting, and grouping controls. A two-card selection compares unique commits, changed files, overlap, areas, and contributors from the shared merge base. **Review details** classifies the changed areas and applies CODEOWNERS last-match-wins while naming recent contributors separately, and **Open Change Story** sends the host-resolved selected ref to Lens without switching branches.

Cleanup is deliberately narrower than its visual queue. A candidate is not permission to delete: AtlasMind refreshes its remote, rebuilds the inventory, refuses current/default/protected/other-worktree/open-PR branches, proves containment and zero unique commits, and shows the evidence. Local deletion uses Git's merged-only `-d` guard. Remote deletion adds a live head-hash match and typed exact-name confirmation. There is no force-delete route.

Every new webview message contains opaque ids only. The extension host owns refs, remotes, PR URLs, Git arguments, CODEOWNERS text, and changed paths; the browser receives bounded aggregate evidence. Filename categories remain path signals, overlap remains a review-order clue rather than a conflict claim, contributors remain history rather than ownership, and branch-name issue matching is visibly labelled inference.

## v0.251.0 — AtlasMind Lens joins the current develop line

The complete Lens suite is now integrated with the current `develop` work: the active-file Code Explorer, source-backed possible-flow journeys, impact and test-evidence maps, contract wiring and drift review, schema-impact and relationship projections, explicit data-trust metadata, declared state lifecycles, configuration resolution, and committed-branch Change Stories. The four `.atlasmind/lens-*.json` declaration formats include editor validation, while Lens commands remain available through the Code Explorer title actions and Command Palette.

The merge retains the newer ACP, dashboard, routing, testing, dependency, and Models-sidebar changes from `develop`. Lens remains bounded and host-authoritative: it does not execute repository code or SQL, connect to databases, read live secrets, fetch remotes, or invoke a model while rendering. Source and chat actions revalidate workspace-relative targets, and Ask Atlas prepares an editable draft rather than submitting automatically.

## v0.241.2 — Cross-platform ACP launch evidence

The ACP launch-evidence test now asserts the real platform contract: a requested hidden desktop must be reported as `private-desktop` on Windows and as the explicit `ordinary` fallback on macOS and Linux. This keeps the diagnostic honest and restores the three-platform CI matrix without changing runtime launch behavior.

## v0.241.1 — GitHub work is visible when the dashboard opens

Project Dashboard now loads one bounded GitHub activity snapshot on its ready handshake and refreshes it only after a five-minute freshness window. Issues, pull requests, CI, releases, labels, and milestones therefore arrive together without a hidden dependency on opening Issues first. The dashboard-wide Refresh control updates the remote-backed pages too, Pull Requests can refresh itself, and its navigation badge reports open/draft/review/unlinked work.

Issues now explains why work may exist without a ticket: AtlasMind never silently publishes an issue from a commit. It shows commits since the last tag, open PRs with no linked issue, and the effective issue-intake gate. An unlinked PR can be converted into a deterministic editable draft, while the existing permission and modal confirmation remain the only route to posting it.

The installed dependency tree is also verified clean: the `qs@6.15.2` override leaves `npm audit` at zero vulnerabilities. GitHub's alert closes when this source reaches the default branch, because Dependabot evaluates `main`, not the already-patched `develop` branch.

## v0.241.0 — A task-sized skill context

AtlasMind now distinguishes three skill policies. **Task-scoped** agents receive at most 12 deterministic, request-relevant tools; **allowlist** agents receive exactly the enabled skills they name; and the advanced **all** policy deliberately admits every enabled capability. Legacy agents migrate safely without rewriting stored data: a populated list remains an allowlist, while an empty list becomes task-scoped built-ins rather than every present and future custom/MCP integration.

The model sees each selected skill once, through its callable JSON schema. AtlasMind no longer repeats the same names and descriptions in the system prompt, and natural-language cues stay with the selected schema. Schema tokens now participate in initial estimates, memory/session budgeting, and each tool round's context-window headroom. ACP completion-only and delegated-native-tool calls receive neither AtlasMind schemas nor the removed prose catalogue.

Settings → Agents explains all three choices. Synthesized agents are pinned to task-scoped selection, external skills must be explicitly eligible before relevance selection can choose them, and progress reports the selected/eligible counts. These changes only narrow exposure: turn-level read-only limits, the approval gate, and execution-time policy checks remain independent enforcement layers.

## v0.240.1 — Bounded chats, one clean answer, and a private desktop that owns its tree

One chat turn now invokes at most three model endpoints. A timed-out execution endpoint is quarantined for the rest of that turn, so ACP effort/model aliases on the same Codex or Claude process and local aliases on the same endpoint do not trigger another launch. ACP receives its adapter-aligned 180-second timeout rather than the generic 30 seconds, empty responses escalate inside the same ceiling, and no hidden recovery model runs after the ceiling.

Streams are attempt-scoped: AtlasMind buffers each candidate and commits only the winning final completion. Failed preambles, intermediate tool narration, repeated skill-budget warnings, and duplicated long paragraphs no longer accumulate in the assistant bubble. Reply metadata is built from actually invoked attempts and states which endpoint timed out, failed, mismatched tools, was superseded, or completed.

Explicit **read-only**, **do not edit**, and **do not run commands** wording now creates an enforced turn capability ceiling. Disallowed skills are removed from the prompt and denied again immediately before execution; ACP native-tool delegation is ineligible when AtlasMind cannot impose that same ceiling. Test Developer also carries a focused testing/workspace skill list rather than every enabled integration.

On Windows, the private-desktop helper now creates the agent suspended, attaches it to a kill-on-close Job Object, assigns and hides its private desktop, and only then resumes it. Teardown starts a whole-tree kill before the root can disappear. The output channel records the effective launch mode with no command, PID, path, prompt, or credential.

## v0.240.0 — Ask Atlas about any branch without spending a model

**Every card on Project Dashboard → Branches now carries an Atlas icon.** It opens Chat with a deterministic summary assembled by the extension host from live local and cached Git metadata: branch/head/tracking state, current- and production-baseline commit counts, merge-base changed-file counts, rule-derived warnings, and up to six recent contributor names with counts from a bounded 30-commit sample.

The first response does not fetch, switch branches, inspect author email addresses or diff bodies, invoke a model, or spend subscription/API capacity. It ends with context-aware **Compare with current**, **Compare with production**, **Identify issues**, and **Recent contributors** chips; choosing one enters the ordinary routed Chat path for deeper read-only inspection. The browser still sends only the opaque inventory id, and the host re-resolves every ref before using it.

## v0.239.0 — Every branch is visible and ready for local work

**Project Dashboard → The code → Branches now shows the whole usable branch inventory, not a capped list of recent local names.** Local and cached remote refs are folded into logical cards with current, default, protected, other-worktree, tracking, ahead/behind, merged, author, commit, and 30-day staleness signals. The page includes search plus local, remote-only, attention, stale, and merged filters. Normal dashboard refresh remains offline; **Fetch latest from remotes** is a separate explicit action.

**Switch here** brings an existing local branch into the workspace. **Bring local** creates a same-named local branch tracking a remote-only ref. The browser supplies only an opaque id: AtlasMind rebuilds the live inventory before Git receives an argument, requires a clean working tree, refuses another-worktree and local-name-conflict cases, and confirms the action. Protected branches receive an additional warning so “available” never reads as “recommended for direct development.”

## v0.238.1 — Testing explanations that answer before they ask

**Every Testing Policy Coverage card now opens with a complete beginner-facing answer, not a general-agent investigation.** The visible **Ask Atlas** action explains what the selected method is, what is required to practise it, the expected result, why it is useful, the live status, what AtlasMind can and cannot infer, and the safest next step.

AtlasMind already owns those definitions and evidence rules, so the first reply is host-authored and deterministic: no model is selected, no provider fallback or escalation runs, and no ACP subscription or metered API capacity is consumed. Status-appropriate chips then make the discussion productive — for example **Check whether it fits**, **Plan a starting point**, **Explain turning it off**, **Review what it covers**, or **Explain the failures**. The one-shot direct-response boundary caps and redacts content and allows follow-up prompts only; a chip cannot name an extension command.

**The ACP tools checkbox now reaches routing as well as permission handling.** With **Let subscription agents act** enabled, a configured ACP subscription agent can satisfy a tool-backed task through its native tools. AtlasMind stands down its incompatible function-calling loop, every native operation still asks through the one-turn approval broker, and the router requires both provider capability and the live setting. With the switch off ACP remains completion-only. An empty MCP allowlist no longer hides the enabled execution mode, and toggling it replaces any live session created under the opposite isolation policy.

## v0.238.0 — AtlasMind can be the managed agent behind Buzz

**Buzz can now launch AtlasMind as an ACP v1 agent rather than treating a Director contact as though it were executable.** Run **AtlasMind: Copy Buzz ACP Agent Setup**, create a managed agent in Buzz, choose **Provider → Custom command**, and paste the copied command and comma-separated arguments. Buzz keeps its `buzz-acp` harness and identity/channel controls; AtlasMind supplies orchestration, model routing, project memory, and approval-gated tools.

The distinction is now explicit throughout setup: a Director **Person** routes inbound work, a Buzz handle identifies an identity or channel, and a Buzz **managed agent** is the process that listens and replies. The copied recipe contains no credential. AtlasMind opens no socket, refuses client-supplied MCP commands, serializes orchestration, offers only one-turn risky-tool approval, and validates Buzz-generated reply metadata before using the existing communication-only CLI bridge.

## v0.237.0 — A quieter Models sidebar, without changing routing

**Any provider, subscription route, or individual model can now be hidden with the eye-closed action on its sidebar row.** This is a user-profile display preference, not provider configuration: hidden models remain enabled, assigned, credentialed, and eligible for routing.

Settings → Models & Integrations now includes a **Sidebar visibility** card that lists every hidden entry and restores them individually. If all providers or every model under one provider is hidden, the tree keeps a direct Settings placeholder instead of becoming an unexplained blank. Restore messages carry only a bounded opaque identity; the extension host removes it only when it exactly matches an entry already in user storage.

## v0.236.0 — Errors and policy evidence can be discussed with Atlas

**Operational messages now offer a consistent AtlasMind-logo route into a reviewable Chat draft.** MCP connection failures and guided-setup warnings/errors, Project Dashboard refresh failures, and retained activated-testing results no longer leave the operator at a dead end. The existing activated-testing result handoff is live again as part of the same pattern.

On Windows, `atlasmind.acp.hideConsoleWindows` now also governs the ACP health probe. The probe was the one launch path that never asked for the private desktop, and because a panel or tree refresh past its five-minute cache re-runs it, it was the path most likely to be seen — a ticked checkbox could still be followed by terminal windows.

Every Testing Policy Coverage card also carries a compact AtlasMind logo. It drafts a plain-language conversation about what that methodology is intended to prove, what the current evidence can establish, and whether configuration or tests should change. The webview sends only a server or policy id where live state exists; the host re-resolves that state, redacts likely secrets, bounds it, fences it as reported data, and leaves the draft unsent for review.

## v0.235.3 — Webview text stays readable when panels resize

**Labels, buttons, badges, and compact data rows now preserve normal words instead of shrinking them into character-wide columns.** The shared webview shell keeps `min-width: 0` on structural containers, where responsive grid and flex layouts need it, but no longer applies it to inline content and controls. Normal prose wraps between words, genuinely long links can still break anywhere, and controls remain bounded by their panel.

Project Ideation also gives its memory-sync checkbox labels intrinsic content width and lays out analytics rows as kind · flexible title/meter · score, so `knowledge-graph`, `requirement`, and `evidence` remain legible at the panel widths where they previously fragmented.

## v0.235.2 — Gemini ACP names the license that still works

**The Google card no longer promises that a personal Gemini subscription can become ACP capacity.** Google stopped serving Gemini CLI requests for free individual and personal Google AI Pro and Ultra accounts on 18 June 2026; the browser OAuth flow can still succeed before the Code Assist backend rejects the client. The offer is now **Use my Code Assist license**, and the picker, `/acp` guide, sign-in step, settings schema, and setup confirmation all state the same boundary before anything is installed or probed: the user must have an assigned Gemini Code Assist Standard or Enterprise license.

Gemini Enterprise Standard and Plus include Code Assist Standard after a separate assignment; Gemini Enterprise Business and Frontline do not. AtlasMind's direct Gemini API provider is unchanged.

## v0.235.1 — The remaining Dependabot alert, closed

**Stryker's development-only REST client no longer resolves vulnerable `qs@6.15.1`.** The parent pins that version exactly, npm's normal audit fix proposes no change, and the latest REST-client release still carries the same constraint. A root override forces patched `6.15.2` across the tree; every other consumer already used or accepted that release, AtlasMind's production dependency audit remains clean, and a manifest test keeps the override in place until upstream catches up.

## v0.235.0 — Personality and Web/UI at the top of Chat

**Personality Profile is back in the native AtlasMind Chat title bar, and Website Studio joins it.** The account and globe icons are visible at the top right alongside Project Dashboard, Mission Control, and Settings. Project Ideation and Cost Dashboard stay available under `…`, so both requested manager links remain one click away without exceeding the five-inline-action limit.

## v0.234.0 — Instructions you can follow, and panels you can reach

**"Installed but not signed in" now names the command that signs you in.** It used to say to run the agent once in a terminal, naming nothing — and the command on screen at that moment is the one that *cannot* log you in: `gemini --acp`, `copilot --acp` and `qwen --acp` all start a JSON-RPC server, and `claude-agent-acp` uses the Claude CLI's credentials rather than holding its own. The sign-in command is now recorded separately, read from each vendor's documentation, and offered as **Open a terminal with the command** — which types it and stops there. AtlasMind never presses Enter and never sees the credential. An agent it has no documented flow for is told as much, rather than handed a guess.

**The ACP console-window choice is on a Settings page.** Settings → Safety & Verification → *Delegated agents (ACP)* carries the Windows private-desktop checkbox, its endpoint-security disclosure, and a button that reopens the guided comparison. Searching the Settings panel for `acp: hide console windows` previously found nothing twice over: the control was only in VS Code's own settings editor, and the search compared the whole query as one substring against keyword lists written as separate words. Multi-word searches now match a page when every word appears.

**Website Studio can be opened from the panels it links to.** Project Dashboard → Delivery and the Project Ideation board both offer it. The Studio pointed at both and neither pointed back, which left the command palette as the only way in.

## v0.233.3 — Honest tool previews and exploratory testing

**An approval card no longer presents unserializable tool arguments as `{}`.** A non-empty object that collapses during JSON serialization is labelled **unserializable arguments**; representable values still pass through secret redaction and the normal preview length cap.

**The committed testing posture now enables exploratory testing instead of performance testing.** The testing configuration, generated strategy, and managed instruction blocks stay synchronized, with charter-based exploratory work assigned to the Test Developer.

## v0.233.2 — Honest routing and honest empty states

**Whole-project assessment prompts now carry a high-reasoning floor.** AtlasMind no longer treats a short request for an overall project assessment as low-effort chat, and adequate local or active subscription-backed capacity wins over a pay-per-token route whose only edge is a small speed-score difference. Capability still comes first for broad review, planning, and synthesis.

**An empty completion is reported as an empty completion.** The transcript no longer turns zero output into “Answered from context.” If bounded recovery cannot produce an answer, Chat asks what to do next and renders **Retry** and **Provider status** chips; the retry explicitly prefers available local or subscription-backed capacity.

## v0.233.1 — Activated-testing repair is visible

**A testing repair no longer goes quiet after confirmation.** The Testing Dashboard now keeps an indeterminate activity indicator and a concise sequence of actual routing and approved-tool updates while the normal approval-gated task runs. It retains a completed or failed outcome with the reported output, and it never labels completion green without fresh test evidence.

**The result can move safely into Atlas Chat.** **Open result in Atlas Chat** opens a reviewable draft rather than sending anything automatically. AtlasMind redacts likely secrets and fences the captured report as untrusted agent output, so Chat is asked to verify it against workspace evidence before taking another action.

## v0.233.0 — Ideation has a home on the dashboard

**Ideation is now visible as stage 0 in Project Dashboard → Where we stand.** The overview reports what is on the active board, what has not yet become work, which live roadmap items still carry a board origin, and unresolved contradictions. Its readiness observations publish the rule that produced each concern, so an empty board reads as unstarted rather than clean.

**Existing project evidence can enter the board without another scan.** Open Gap Analysis, Security Review, Risk, Tech Debt, and Testing Coverage records are offered as evidence cards. The dashboard sends only an opaque id, re-resolves it host-side, and hands the actual write to the canvas, which preserves the complete board record and does not invent a supporting connection.

**`/ideate` reads the same state without changing it.** It reports the board and needs-attention reading, then offers the dashboard overview and canvas. It runs no scan and invokes no model.

## v0.232.0 — Testing guidance, first tests, and a green repair loop

**The Testing Dashboard can now fix the activated strategy as one coherent task.** Its **Fix activated testing** button is host-confirmed and passes the current enabled-policy coverage, existing scripts, and report failures to the normal approval-gated Atlas task. The agent must inspect before it changes anything, runs only relevant existing test commands, and re-verifies the affected surfaces. It cannot achieve a false green result by disabling or skipping tests, weakening assertions, lowering thresholds, changing runner configuration, adding dependencies, or declaring a missing environment successful.

**The testing dashboard now explains the protocols, rather than merely naming them.** It receives Settings' shared methodology catalogue, so each enabled approach has the same plain-English description, when-to-use guidance, familiar tools, and trade-offs wherever a developer meets it. There is no labels-only dashboard copy to become stale.

**Scaffolding now carries a strategy into action with a deliberately narrow safety envelope.** Once the operator confirms the existing non-destructive scaffold, AtlasMind syncs its testing instructions into instruction files that already exist. If — and only if — it finds an existing Vitest or Jest runner and a small exported source module, it starts one ordinary approval-gated authoring task for a focused first test. The agent must inspect before writing, may not add dependencies, change a manifest, or edit production code, and makes no change when the candidate has no stable behaviour worth testing.

## v0.230.2 — ACP plans without fictional credit balances

**Configure Agent Plan** now reads the current `atlasmind.acp.agents` list, so
Gemini and self-installed ACP agents appear as soon as they are configured. ACP
does not report an account tier or a trustworthy remaining allowance, so the
flow stores only the plan name the user enters—such as `ChatGPT Pro (5×)`—and
never asks for, estimates, decrements, or routes on credits. Old guessed ACP
quota records are retired. Copilot keeps its separate credit-tracking flow.

The Safety & Verification permission that lets ACP agents use their own tools
now saves to workspace settings, so returning to the page preserves the choice.

## v0.230.1 — Keep mutation sandboxes out of the VSIX

VSIX packaging now excludes Stryker's local `.stryker-tmp/` sandbox, the
separate `test/`, `e2e/`, and `performance/` directories, and the mutation
configuration itself. A local mutation run therefore cannot turn thousands of
disposable test files into extension payload.

## v0.230.0 — Quiet ACP sessions, without hiding the trade-off

The testing baseline now includes a real `fast-check` property test in the normal
Vitest suite and a separate `npm run test:mutation` command. The committed
Stryker configuration starts with the criticality, tool-policy and agent-registry
modules — decisions where a test that merely executes a line is not enough.

ACP no longer throws a coding-agent process tree away after every answer. A
successful conversation stays live for 30 idle minutes, and the next turn sends
only the exact transcript suffix the remote session has not already seen.
Branches, edits, model/effort changes, MCP or isolation changes, Windows launch
mode changes, startup instruction changes, exits and idle expiry all open a
fresh session. Concurrent setup, health and panel probes now share one one-shot
process instead of racing to start several identical trees.

Duplicate delivery is guarded separately: one stable task identity follows an
orchestrator tool round, concurrent calls for that identity share one
`session/prompt`, and a 15-second result ledger absorbs its immediate retry
without merging independent chats that happen to contain the same words. ACP is
exempt from the generic transient-provider retry loop, so an uncertain prompt
is never automatically sent again. That protects subscription allowance and
prevents an acting agent from being asked to perform the same work twice.

On Windows, setup now asks *before the first probe*: accept ordinary launching
and the possibility of brief terminal pop-ups, or tick **ACP: Hide Console
Windows**. The opt-in path uses a source-visible, dependency-free, SHA-256-pinned
native helper to put the agent and descendants on a dedicated private desktop,
with no shell and only stdio inherited. It never switches to or controls that
desktop, and a missing/changed/blocked helper fails rather than falling back.
The guided choice is written to User settings so setup does not dirty the
repository; a workspace may still override it explicitly. The configuration
schema's default does not count as a choice, so startup discovery and direct
routed turns cannot launch an older configured agent first.

The warning is intentional: hidden desktops are also used by hVNC malware, and
Microsoft Defender exposes them for threat hunting. A managed-device EDR may
flag the legitimate helper. The feature therefore remains off until selected,
and the private desktop is documented as a visibility control — never a
sandbox or permission boundary. The SHA pin verifies the bytes AtlasMind expects
but is not Authenticode; the v0.230.0 helper itself is unsigned, so an enterprise
may require its own signature or allow-rule.

While a private-desktop routed session is alive, AtlasMind also shows **ACP private
desktop: _n_** in VS Code's status bar. Click it to open Models & Providers. This
is intentionally in-editor rather than a taskbar/notification-area icon: taskbar
buttons represent windows on the active desktop, a tray icon can be hidden in
overflow and neither changes the EDR signal. The indicator is visible evidence of
the selected launch mode, never a claim that the desktop is a sandbox.

**Settings are now one click from the AtlasMind Chat title bar.** The gear takes
the fifth visible title-bar slot; the contextual project-memory action remains
in the overflow menu. Native VS Code Settings search now recognizes the exact
panel wording, **Let subscription agents act**, for `atlasmind.acp.toolsEnabled`.
The ACP card's matching Safety link now passes its allowed page id through the
webview boundary correctly, and its description begins with the plain-language
fact: use an installed Claude Code or Codex agent and its existing subscription.

---

## v0.229.0 — Groundwork for keeping the agent alive

AtlasMind throws the ACP agent away after every answer, so every question pays a fresh ten-second startup. Measured: opening a session costs about 9.7 seconds, while a second question on a session that is already open costs 1.7. Keeping one alive is worth roughly **13 seconds down to 2 per answer** — and it turns the console-window flurry from once-per-answer into once-per-lifetime.

This release lands the rules such a host has to obey, before the host itself. A background process holding a signed-in Claude session can spend your subscription and, with *Let subscription agents act* enabled, run commands — a different kind of exposure from an agent that exists for a few seconds. So the rules are settled and tested first: only this machine's user can reach it, a missing token authorizes nothing, a reused session must still match the conditions it was created under (including which side of the act/don't-act line it was started on), and the host outlives one editor window but never all of them.

Nothing is wired up yet — this is the part worth getting right before there is a process to get it wrong in.

---

## v0.228.1 — Clearing the working tree

Commits work products an earlier session left uncommitted: the first ATDD artifacts, four agent definitions, and a refresh of the SSOT memory files. No behaviour changes — it puts the repository in a known state before the ACP daemon work begins.

---

## v0.228.0 — Console windows during model discovery

Checking an ACP agent means opening a session, because that is the only honest test of "signed in". What that actually starts had been underestimated: on Windows, `claude-agent-acp` launches **your entire configured MCP fleet** inside the session — a GitKraken CLI, an `npx @azure/mcp` tree, a `contrast-checker-mcp` tree, several through `cmd.exe` — and `codex-acp` starts an `app-server` plus a REPL host. Each `cmd.exe` makes Windows allocate a `conhost.exe`, which is a console window that flashes on screen.

AtlasMind's own spawn has always been `windowsHide: true`, but that governs the process it starts, not what *that* process starts. The window was never suppressible from here, so the lever is frequency.

The probe answer was cached for **ten seconds** — a number sized for a handshake, not for booting two agent runtimes — while a dozen call sites refresh the provider catalog whenever you open a panel or change a setting. It is five minutes now, and the session is explicitly closed rather than merely killed so the agent reaps its own children instead of orphaning them. Only visible since v0.217.0, which is when ACP started being probed at all.

If you want fewer still, the lever is the MCP servers configured in the agent itself — those are what the session starts.

---

## v0.218.1 — Every variant bills the plan it actually used

ACP subscription quotas are *model-scoped*: one `acp` provider fronts several unrelated plans, so your Claude Max entry sits on `acp/claude`. The plan lookup stripped only the `#effort` suffix, so the `@model` segment introduced in v0.218.0 left `acp/claude@opus#high` resolving to a key no plan is stored under — and it fell through to a provider-level quota ACP deliberately does not have.

Silent, and in the direction that costs money: every model-variant turn looked like an *unmetered* plan. The "already paid for" preference kept applying after the quota was spent, and nothing decremented the plan those turns were billed to. Both separators now strip, because each names a choice *inside* one subscription rather than a different one.

**Also confirmed:** an ACP plan is weighed exactly as Copilot and Claude CLI are. Subscription capacity is advanced over pay-per-token by a general preference, and by a larger one on maintenance turns that pairs with a penalty for metered models — both keyed on the provider's pricing model rather than a list of provider names, so the equivalence holds by construction. A test now pins it.

---

## v0.227.1 - The ideation roadmap says what did not ship

Three releases delivered most of the ideation and research work. Five things were deliberately left — the Ideation dashboard page, findings becoming evidence cards, the spend projection shown before a scan may run unattended, `/ideate`, and two accessibility and audit items on the board itself. They are now written down with the reason each was deferred, rather than being absent from a plan whose phases all read "shipped".

---

## v0.227.0 — The ideation guide stops describing the layout and becomes it

Five sections used to be on the ideation page at once, with a four-card guide above them explaining the order they were meant to be used in. That guide had been moved twice already on the theory that placement was the problem. It was not — a guide that has to explain a layout is a symptom of the layout.

**Frame → Scaffold → Shape → Decide is now a control.** Pick a stage and only that stage renders. The board still leads the page, and each button's status reports where your *board* is rather than which tab you are reading, so the bar stays honest while you look ahead.

**An empty board offers a starting point.** Eleven starter frames derived from what your project actually looks like — a game and a command-line tool no longer open the same blank canvas — and every seeded card is a **question**, never an answer. They append; they never replace anything.

**The kind picker finally says what a kind means.** Choosing `problem` has always put "Fix: …" on the roadmap and `risk` has always put "Mitigate: …", and until now that was written down only in the source. A rule you cannot see is a rule you cannot argue with.

**Decide opens with what the board cannot defend** — unresolved contradictions first, then problems with nothing behind them, wish lists, and cards that never reached the backlog. Each line names the rule that produced it, and none of it blocks anything.

---

## v0.226.0 — The research engine gets a button

v0.225.0 shipped the modules. This makes them run.

`AtlasMind: Run a Research Scan` asks one question about the world outside your repository and records what it found. It confirms first — naming the scan, the source it will use, and the fact that it reaches the network and spends model budget — and **a scan that cannot look never reaches the model at all**. It records that it could not look, which is a different thing from finding nothing, and the only version of this feature worth having.

`/research` in chat reads the same state and presses nothing: open findings with their sources, what is due, what is blocked, and — always, even when everything else is quiet — what has never been assessed.

**Nothing runs on its own until you say what it may cost.** The monthly spend cap defaults to zero, whatever automation level a scan is set to. Switching research on and letting it run unattended are two decisions, and one switch for both would make the first one carry a cost you never agreed to.

**The register is not created until there is something to put in it.** It gets committed, and writing a file into your repository because you opened a tab is not AtlasMind's call to make.

---

## v0.225.0 — Ideation learns something nobody typed into it

Stage 0 of the workflow had exactly two inbound paths: you, and Atlas re-reading the board you had already filled in. So ideation could structure a decision but never inform one, and a board full of confident cards about an unexamined market looked identical to a board full of researched ones.

**Seven research scans, and deliberately not the five people ask for first.** gap, security, risk, debt and testing coverage are already answered by registers in AtlasMind — a second answer would eventually contradict the first, surfacing as a board citing evidence the Gap Analysis page denies. Those five are *subscribed to*. Scanning is built only for competition, customers, technology, feature gaps, market, funding and regulation — every one of which reaches outside your repository, where nothing owns the question.

**A citation, or it is not a finding.** A model asked about a market will answer: fluently, specifically, with plausible numbers. Written into git-tracked project memory and read six weeks later by somebody deciding what to build, that answer is indistinguishable from research. So the check lives in the sanitizer, not in a prompt — an uncited claim is recorded as a *question*, never counted as evidence — and it holds through a hand-edit of the file.

**With no way to look, AtlasMind refuses rather than guessing.** Before a scan runs it decides whether anything *could* have looked — an EXA key, a connected MCP search tool, or the built-in fetch. With none, the scan reports `no-source` and names the setup step. Fetching a page somebody named is kept separate from finding one nobody has: a fetch-only project running a competition scan would get the model's memory with one real citation stapled to it, which is worse than no scan, because it looks sourced.

**Scheduled means due, not automatic.** Scans have a cadence and become due; running one stays a decision, on a three-rung ladder you cap yourself. Six weeks with the editor closed produces one due scan, not six — and an automatic pass runs exactly one, never-assessed before merely overdue.

**The digest answers three questions and the third is not optional.** What changed outside, what it means, and what is still unassessed. No model writes any of it: each scan's "so what" is a sentence declared once and published, so it can be argued with. And a scan going from never-run to twelve findings is reported as a first assessment, not as twelve competitors appearing.

**The board itself:** eleven starter frames derived from your project's archetype — a game and a CLI tool no longer open the same empty canvas — every seeded card phrased as a question rather than a conclusion. And a readiness reading that says what the board cannot defend: unresolved contradictions first, then problems with nothing behind them, wish lists, and cards that never reached the backlog. A record, never a gate.

---

## v0.224.1 - The test report stops shipping inside the extension

The JUnit report added in v0.220.0 is gitignored, so it never appeared in a diff. But `.vscodeignore` is a separate list, and nothing had told it — so `atlasmind-0.224.0.vsix` carried 836 KB of this repository's own test names into every install. Excluded now, with a guard that reads the output path out of `vitest.config.ts` rather than restating it, since restating it is how the two would drift apart again.

---

## v0.224.0 - Reconcile the policy with the repository

A testing matrix drifts in one direction. Enabling a methodology takes a click; noticing months later that it never produced anything takes somebody deliberately looking. **Reconcile with the repository**, on the Testing page, compares the declared policy with what is actually here and proposes a change for each disagreement: drop what was declared and never started, keep what has tooling underway, adopt what the project practises but never declared. Nothing is written until you approve the exact lines.

Dropping is a first-class outcome. A declaration the project has outgrown is a stale statement, not work you failed to do - and a policy nobody can withdraw from is one people stop reading.

Two smaller things that let the drift happen. Three places could change the matrix and only one of them synced the AI instruction files, so turning a methodology off from the dashboard left every external agent still being told to follow it. And auto-assess arrived with every match pre-ticked, which is how one click could enable thirteen methodologies on a project with evidence for five. It now ticks only what the repository can already show, and offers the rest as intentions.

---

## v0.223.0 — Testing is worth points, and a release checks the policy

The project score had eight components and 127 points, and testing was not one of them. So a project with fourteen declared methodologies and evidence for none scored *better* than one that declared nothing — neither carried a testing number, and the first looked more organised everywhere else. That is the one comparison a health score most needs to make, and it was making it backwards.

**Testing evidence** is now worth 15 points: ten for the share of enabled methodologies that have evidence, five for having a readable test report. A project with nothing declared scores zero and is told the points are *unclaimed*, not that it has failed — nobody has looked is different from looking and finding it broken. The recommendation says *close or retire*, because a declaration the project has outgrown is a legitimate thing to withdraw.

The release gates gained **Declared testing policy met**. A failing test fails it, an enabled methodology with no evidence fails it, and coverage that was never gathered reports `unknown` — which is not a pass, because a published version can never be replaced and *"we did not check"* must stay distinguishable from *"we checked and it was fine"*.

---

## v0.222.0 — A methodology can hold work back, if you say so

AtlasMind's one real enforcement — the gate that refuses non-test writes until a failing test has been seen — never read the testing matrix. It fired on the task's role and wording, so a project that had switched TDD *off* still got the gate, and the thirteen methodologies it had switched *on* got no gate whatsoever. The declaration and the enforcement had nothing to do with each other.

Blocking is now a per-methodology opt-in rather than a project-wide switch. Enabling a methodology is a statement of intent and should stay safe to make; turning one into a gate changes how every task in the project runs. Declare fourteen as the standard you hold yourself to, and block on the one or two you are willing to stop work over. Where the config cannot be read at all the gate stays on — dropping a safety behaviour because a file would not parse is the wrong direction to fail in.

Alongside it, a real data-loss hazard closed: the config reader hard-gated on `version === 1`, so a file written by a newer AtlasMind read as *no testing policy at all* — and that is what every writer treats as licence to persist a fresh default over the top. For a document whose entire content is which methodologies are on, that is a silent way to switch a project's testing policy off. It goes through the shared migration ladder now, which keeps *corrupt* and *newer* apart.

---

## v0.221.0 — A testing policy that reaches the code

The fix for the failure v0.220.0 made visible. This project enabled fourteen testing methodologies in June and eight of them still had no evidence of any kind seven weeks later — not because the declaration was wrong, but because it was never shown to a model that could act on it.

Testing policy reached a prompt through one channel, and that channel required the task to be *already* classified as testing, or the subtask's own text to *already* contain a testing word. The turns implementing features — the only turns that could have written the tests — were precisely the ones told nothing.

Every turn that could change behaviour now carries the whole enabled set, phrased as an obligation rather than a description: a change is not finished until it carries the evidence its policy names, and an agent unable to produce that evidence must say so and say why. A project with no declared policy is told nothing at all, because generic advice nobody asked for is how a prompt block becomes something agents skim. Practices such as V-Model and Exploratory are named as context but never requested as files.

The gate is task modality and nothing else. Every narrower condition available — classification, routing needs, agent assignment, task wording — is a variation on the gate that caused the original failure.

---

## v0.220.0 — The Testing dashboard gets something to read

AtlasMind reads test pass/fail from a report your project wrote, and never runs your tests to find out. Nothing in this repository ever wrote one — not a script, not CI, not the pre-commit hook — so on its own project the Testing page had reported *"No test report"* since the day it shipped. Every `vitest run` now writes `test-results/junit.xml`, gitignored, and the pre-commit hook already runs the full suite, so the verdict on screen is never older than your last commit.

Three more things the page was getting wrong. The `continuous` policy had no file markers at all, so a project running its whole suite on every push capped at *"No tests yet"* permanently — for that one policy the pipeline definition **is** the artifact, though only the config file counts and never a matching script name. Five test files had never executed, sitting outside the runner's glob in `src/`, in a `test/` directory, and under a `.spec.ts` suffix; two of them failed once they ran, having been written against behaviour the code no longer has. And the Testing Strategy badge read *"13 / 14 active"* above a table of 23 rows, because the registry grew to 23 and four pieces of copy never followed — all four derive from the registry now, with a test refusing a literal.

---

## v0.219.0 — The Claude Code CLI provider is removed

It was a chat-only bridge that shelled out to `claude --print`: no streaming, a ~26,000-character prompt ceiling imposed by the OS argv limit, and no tool use. The ACP provider superseded it on every axis — the same subscription, with streaming, no prompt ceiling, images, and now real model *and* effort selection — so keeping it meant two routes to one Claude plan, one of them strictly worse and quietly lossy.

**Nothing breaks on upgrade.** If you pinned `claude-cli/opus` in `atlasmind.planningModelId` or `atlasmind.synthesisModelId`, the id is now unknown and those settings do what they already promised: fall back to normal routing. A subscription quota saved under the old provider is never consulted, and spending against it is inert rather than an error.

**To keep using your Claude plan**, configure an ACP agent — Model Providers → Anthropic → *"Use my Claude subscription"*, or run `/acp` for the walkthrough. You get the same plan with streaming, the full prompt, and per-model routing.

---

## v0.218.0 — The models inside a subscription

The same session response that advertises effort also advertises the plan's *models* — Opus, Sonnet, Haiku on Claude; Luna, Terra, Sol on ChatGPT — and AtlasMind was discarding that half. Each is now a routed model, and the two knobs compose: `acp/claude@opus#high`. The orchestrator can send a throwaway rename to the light model and a refactor to the deep one, inside the plan you already pay for.

**The list is detected, never assumed.** Nothing declares which models your plan has — vendors ship faster than AtlasMind releases, and a built-in roster would hide a model you are paying for.

**Where a model sits cannot be detected**: the wire carries a name and a description, not a capability rating. Standing comes from a declared rule — your `atlasmind.acp.modelStanding` setting, then a short table of naming conventions we will stand behind (Haiku / Sonnet / Opus), then the agent's own description — and every choice publishes which rule decided.

**Unknown standing is routable, never dropped.** A model matching no rule is fully selectable but never *preferred* on capability, because a guessed ranking misroutes silently. Luna, Terra and Sol are currently unknown — they read as moon/earth/sun, which is etymology rather than a vendor statement. Declare them and the router uses them fully:

```json
"atlasmind.acp.modelStanding": { "Luna": "light", "Terra": "balanced", "Sol": "deep" }
```

Composition is two more declared rules: depth is the **greater** of model and effort (asking harder does not deepen a light model), and cost **multiplies** (both spend your plan).

---

## v0.217.0 — Effort levels inside a subscription

An ACP subscription presented to the router as **one model**, running at whatever the agent defaulted to. The agents were already advertising more than that on every session — `session/new` returns a `configOptions` array carrying a `thought_level` knob — and the adapter kept the session id and discarded the rest.

Each effort level your agent actually offers is now a routed model: `acp/claude#high`, `acp/codex#max`, alongside the plain row that still means *the agent's own default*. Each tier carries a reasoning depth and a quota cost, so the budget mode you already set expresses the gradient — **cheap** reaches `low`, **balanced** reaches `high`, **expensive** reaches the top — through machinery the router already had rather than anything ACP-specific.

**Set through `session/set_config_option`, because there is no `session/set_model`.** The mechanism was read from the published v1 schema and confirmed against live `codex-acp` 1.1.7 and `claude-agent-acp` 0.63.0. The two agents name the knob differently — `reasoning_effort` and `effort` — but both label it `category: "thought_level"`, so the category is what AtlasMind matches on. Keying on the id would have worked against one agent and silently done nothing against the other, which looks exactly like success because the turn still completes.

**AtlasMind will not touch the agent's permission mode.** The same list that offers effort also offers `bypassPermissions` and `agent-full-access`. Only the model and the effort can ever be set, so a routing decision can never widen what an agent is allowed to do — and Codex's "fast mode" (*1.5x speed, increased usage*) is excluded too, because spending your plan faster is your decision.

**The cost of a tier is a declared rule.** No vendor publishes what a max-effort turn costs against a plan, so the multipliers are AtlasMind's own stated assumption, printed on the provider card the way the debt register prints the rule that graded an entry. And a tier that cannot be applied does not fail the turn — it runs at the default and says so, because it was priced at the tier you asked for.

---

## v0.216.0 — ACP works, and a plan says whose

An installed, signed-in ACP agent was reported as **⚠ ACP — agent not responding** by the Models tree, while the provider panel showed the same agent as **Ready** on the same screen, and the router refused to route to it either way.

**The cause was one missing branch.** The "is this provider configured?" check had no case for `acp`, so it fell through to reading `atlasmind.provider.acp.apiKey` — a key that does not exist and never will, since the whole point of ACP is to drive an agent you have already signed in to. Every refresh marked ACP unconfigured, which skipped model discovery *and* set provider health to false. The tree then reported that flag as a verdict on the agent. It also explains why only the seeded `acp/claude` ever appeared: a configured `codex-acp` had no model row because discovery never ran.

**Four related faults went with it.** Every configured agent is now probed rather than only the first, so a broken agent no longer condemns a working one and a vendor row no longer reports another vendor's agent. An agent nobody has contacted shows **not checked yet** rather than *not responding* — a verdict requires having asked. The startup budget is no longer smaller than the probe it contains: an ACP probe spawns a process per agent and opens a session, about nine seconds for two agents, against a ten-second timeout whose expiry marked the provider unhealthy for the rest of the session. And the long-lived routed adapter re-reads the agent list instead of snapshotting it at activation, so an agent added later is visible without a window reload.

**A subscription plan can now belong to an agent.** *Configure plan* on the ACP card opened straight onto "Enter monthly cost" with no subject — a question with no correct answer, because `acp` fronts several unrelated subscriptions: your Claude plan pays for `acp/claude` and your ChatGPT plan for `acp/codex`. Whatever figure you typed landed on the provider, so configuring the second plan overwrote the first, and the router then priced every ACP turn against one plan while depleting the other.

The flow now opens on **"Which subscription are you configuring?"**, offers each vendor's real tiers — Claude Pro / Max 5× / Max 20×, ChatGPT Plus / Pro, Google AI Pro / Ultra — and titles every step with the agent it is about. The card lists one row per agent, and each plan is spent only by the model it pays for. Providers that front exactly one plan are unaffected.

---

## v0.215.0 — The header says what version is where

The Project Dashboard header carried two pills: a *guessed* production branch and whatever branch was checked out. That answers "which branch am I on?" — while the project already models the real answer on the Delivery page, as an ordered pipeline of stages each naming the branch whose committed version represents it. The header ignored it, so adding a Staging stage changed nothing there.

The strip is now **one pill per stage, in pipeline order**, derived from the same stage views the Delivery page renders — so a stage added there appears in the header without a second definition of what a stage is, and the two surfaces cannot report different versions. AtlasMind's own pipeline reads **Local · Staging `develop` · Production `main`**.

**The working tree gets a pill of its own.** It is the only reading taken from `package.json` on disk rather than from git, and therefore the only one that can be ahead of every branch — so it says `working tree` rather than borrowing a branch name, and is marked when the tree is dirty, which is exactly when it differs from the rest of the strip.

**A version is never invented.** A stage whose branch does not exist yet says so rather than borrowing a plausible number, because a version shown against an environment nobody deployed to claims a deployment that never happened. Pills are capped with the remainder stated, and a project with no pipeline configured still gets the original git-derived pair — labelled so a guessed production branch is not given the authority of a declared stage.

---

## v0.214.0 — The Overview says what needs a person

A *Needs you* band sits above the stat grid and gathers, from the pages that already know, what is failing, shut or past due: failing tests, a red pipeline, blocked memory writes, overdue follow-ups, release gates not passing, blocked promotion paths, high-severity debt, open risk findings, documents due review, stale issues. Every card routes to the page that owns the fact.

**It is empty when nothing needs you.** The Overview once closed with a grid of twelve equally-weighted shortcut cards, removed for being a second navigation system pretending to be a summary. A navigation grid can never be empty; this band renders one muted line and no card frame when every check comes back clear.

**Unassessed is never reported as clear.** A project with no test report, no readable issue tracker, an unscanned debt register or an unassessed risk register says exactly that, in its own category — ranked below real findings, never omitted. Silence earned by not looking is the one failure mode that would make the band worse than nothing, and the empty state distinguishes *checked and clear* from *too little was assessed to say*.

**Ranked by consequence, not magnitude.** A red pipeline outranks forty stale issues; ties break on declaration order so the list cannot shuffle; the six-card cap always states its remainder; and every card publishes the declared rule that graded it, so a grade can be argued with rather than trusted. *What moved* appears as a compact strip whose chips all route to the Workflow page, which owns the only *Mark as seen* control.

---

## v0.213.2 — What AtlasMind will say when it cannot tell

`docs/game-engine-integration.md` specifies the engine half — Unreal, Unity and Godot identity, the `game.json` schema, asset and build-log reading, the bridge protocol and the security boundary — completing the specification work begun in v0.213.1.

**Detection is by decisive file; version is read, never inferred.** Engines identify themselves by project file rather than dependency manifest, and everything downstream is version-specific, so an unreadable version reports `unknown` and withholds every version-dependent affordance instead of guessing. Every engine CLI fact must sit behind a `*_VERIFIED_AT` constant, and a version outside the verified range degrades rather than extrapolating — the only mechanism preventing this rotting silently as engines ship.

**The bridge is read-only by construction.** The wire format defines no command frame at all — not a disabled one — and a test asserts it. **AtlasMind proposes; the engine writes:** no code path may write binary engine content under any approval, because binary content has no reviewable diff, so a confirmation dialog cannot describe what is about to change. No compiled artifact ships into your engine; the companions are Python, C# and GDScript.

The distinguishing section is §8, a **degradation table** naming what gets reported in every case where AtlasMind cannot tell. No build log yields *no verdict* plus the command to produce one, never "0 errors". No performance capture yields *no verdict*, never a passing budget. A Perforce content component yields *not visible*, never "0 assets". Every row must be covered by a test — that behaviour, rather than the engine support itself, is what separates this from a plugin that confidently reports wrong numbers.

## v0.213.1 — A project can be more than one thing, in more than one place

`docs/project-composition.md` specifies how AtlasMind models a project made of several components — an engine fork, gameplay systems, shared libraries, backend services, tools, content — each with its own role, archetype and version control system. A single-repo project becomes the *simplest* case rather than the assumed one.

**It is general capability, not a game feature.** Games force the issue, but the same model serves a Shopify build (theme + app + extensions), an ML project (training, serving, data, weights), embedded work (firmware + app + cloud) and any product built on a forked upstream.

Three facts made the gap concrete at v0.213.0: the archetype is single-valued per project, so a game with a matchmaking service can never get correct advice for both halves; **123 of 130 `workspaceFolders` reads take `[0]`**, so AtlasMind is single-root by construction; and the bootstrap picker already offers *Shopify Store / Theme* and *Shopify App* as mutually exclusive choices while the vocabulary underneath maps them to two different archetypes.

The load-bearing rules are honesty rules. **Unknown is not zero** — a component whose version control cannot be read reports *not visible*, never a count, because telling a Perforce studio it has "0 pending changes" is worse than telling it nothing. **Topology is derived, never stored**, so it cannot disagree with the components it describes. **One SSOT, in a declared home component.** And **non-git version control is read-only forever** — an agent that can revert an artist's unsubmitted work is not a tool anybody will install, and no dialog makes it safe when the loss is silent and belongs to somebody who never saw the prompt.

Alongside it, `project_memory/roadmap/game-engine-integration.md` plans Unreal, Unity and Godot integration on top of that model: read the project first, then a read-only in-engine bridge, then breadth. The companion plugins are Python, C# and GDScript — **no compiled artifact ever ships into a user's engine**.

## v0.213.0 — The sidebar tells you what is ready to ship

A **Ready to ship?** section in Project State lists every promotion path with whether anything *declared* is standing in its way: `blocked` (red, and the only verdict that counts as needing a person), `gated` with a count of the gates the plan will evaluate, or `clear`. It expands itself only when something is blocked.

**The row opens the plan; it never promotes.** Promotion runs behind a built plan, per-gate attestations and a type-to-confirm on a protected target — a one-click row in a tree would route around all three. A test asserts no row can ever be wired to a promotion command.

**What it may honestly claim is limited by how it is built.** The Project State tree computes synchronously — it reads in-memory state and shells out to nothing, because it recomputes on ten different events. So nothing here has seen the working tree, the version delta or live CI. The vocabulary avoids "safe" and "ready" for exactly that reason, and every tooltip ends by naming what was *not* checked. A green row that had silently skipped those would be a shipping light that never read the code.

The blocker rules are shared with the Delivery dashboard rather than reimplemented — two definitions of "blocked" would drift, and the sidebar would hold the untested one.

## v0.212.2 — A failing dashboard action no longer vanishes

Reported as "the Delivery Promote buttons appear to not do anything". The whole chain behind them turned out to be correct — the button, the click delegate, the payload validator, the handler, all four replies, the modal and its CSS. Every link verified, including running the validator against this repository's real promotion path ids.

**What was missing was the failure path.** `onDidReceiveMessage` discarded the handler's promise with `void`, so a rejection anywhere below produced no error, no log and no reply: the webview posted its message and waited for ever. Every failure looked exactly like a button that had never been wired.

The dispatcher now catches, names the message type, and reports the reason. Both promotion handlers additionally report their own failures into the modal the user is already looking at, carrying the underlying message rather than a generic shrug. In the run handler the guard sits deliberately *before* the delivery lock is acquired, so a throw on the way to the lock cannot leave the single-flight lock held.

Worth knowing: `void this.handleMessage(message)` without a catch appears in six panels. Only the Project Dashboard is fixed here, because that is where the report came from — the same silence is available in chat, MCP, model comparison, model providers and personality profile.

## v0.212.1 — The ideation guide moves above the canvas, and the shortcuts get audited

**"How this workspace works" now sits directly above the Canvas it describes.** It rendered last — below the composer, inspector, feedback and analytics — so the explanation of the staged workflow was the final thing reached by somebody who had already worked the board out unaided.

That reverses a deliberate decision, and the reversal is only safe because of what changed in between. The guide was demoted because the canvas was below the fold: "a hero panel, a four-card process guide and a very tall composer came first". Two of the three are gone — the hero is a compact stat strip, and the guide is a `<details>` collapsed unless the board is empty. Collapsed it costs one line rather than four cards; expanded, only on an empty board where there is nothing to push down.

**Every dashboard's top-right shortcuts were audited, and nothing was broken.** Across Project Dashboard, Ideation, Run Center, Cost Dashboard, Mission Control and Personality Profile: every header button has a listener, every command target exists, every webview-offered command is allowlisted, and Cost's "Budget Settings" lands on the page that actually hosts the budget.

Two false positives from the manual pass are recorded in the test, because the naive checks reproduce them: `workbench.view.scm` is a built-in VS Code command rather than a missing AtlasMind one, and Mission Control wires its button through a `$('id')` helper rather than a literal `getElementById` — so a substring check calls a working button dead.

The checks are kept because each fails silently, and the subtlest is the allowlist one: a command offered in the UI but missing from its panel's allowlist is ignored by the host by design. Correct security behaviour, invisible bug.

## v0.212.0 — The settings gear comes back, and a command stops hiding

**The settings route was invisible on every sidebar view, for two compounding reasons.** v0.202.0 capped each titlebar at five slots — correctly, since VS Code collapses the rest behind `…` — and the settings link was demoted to make room, into a `4_config` group that VS Code renders *only* inside the overflow menu. Separately, four of the five settings commands had **no icon declared at all**, so promoting the group alone would still have drawn nothing. Both fixed: the four gain a gear, and the route is promoted on the ten views with a free slot. Chat keeps its in the overflow, because its five slots are genuinely full.

**The Models title bar gains a refresh**, which existed only as a per-row action and already refreshed every provider regardless of the row it was invoked from.

**"$ Configure plan" never said whose plan.** Three subscription providers can be on screen at once and every button read the same five words — while the dialog it opened had always named the provider. The button was the only step that did not say what it acted on.

**The plan action is now reachable at all.** `atlasmind.models.configureSubscription` had been registered in code since subscription tracking shipped, declared in no manifest entry and attached to no menu: working and unreachable. It sits on the **provider** row, not the per-vendor ACP rows beneath it — a plan is keyed per provider, so a per-row action there would have implied a per-agent plan that does not exist.

**The ACP card's instruction is a link.** It said to turn on "Let subscription agents act" under Settings → Safety and left you to find it. Provider copy now routes any settings page it names, with the link substituted onto the *escaped* string so the copy stays injection-safe, and the webview sending a page id the host resolves through a fixed map rather than a command name it could choose.

## v0.211.0 — Atlas tells you the workflow exists, when it applies

The chat path never read the declared workflow. Only the Workflow dashboard page and (from 0.210.0) *other* tools' instruction files did — `src/chat/`, the orchestrator, the planner and the mission runner had no reference to it. So typing *"commit this and push it"* into Atlas got zero workflow awareness: the rules lived on a page you may never have opened and in a file written for a different tool.

Now, when a prompt implies a commit, push, branch, pull request or release, AtlasMind states what the workflow expects — naming your integration branch, and leading with a protected-branch warning where that is where you are — then offers to follow the workflow or carry on as asked.

**The default informs and continues.** The user this is for is a novice, and a novice's failure mode is not breaking a rule but not knowing one existed while it still mattered. Informing teaches at the one relevant moment and costs an expert a line. `atlasmind.workflow.chatGuidance` raises it to `gate` or drops it to `off`; gating is opt-in because a prompt on every commit becomes one people learn to click through, at which point it protects nobody and is still in the way.

**Detection is a published keyword table, not a model** — no model in front of every chat turn, and the same prompt always gives the same notice, so the advice is learnable. The cost is stated: wording-based matching will miss an unanticipated phrasing, which is survivable precisely because the default only adds a sentence. That asymmetry is the deeper reason `gate` is not the default.

Silence is a valid answer where anything else would be untrue: no workflow declared, nothing governed in the prompt, or the owning stage disabled. A stage nobody enabled has no expectations to assert.

**The sidebar now ships in the order reached by using it**, and Project State stays expanded — collapsing it would have reversed v0.187.1's "a collapsed summary shows nothing" and worked against the very newcomer this release is aimed at.

Two robustness notes: the guard's first version awaited imports and a git call in front of every prompt, delaying the busy indicator — the same mistake the slash router made one release earlier, caught by the same microtask-counting test. And the branch read is now bounded at 750 ms, so a slow Git extension costs the notice its detail rather than costing you your request.

## v0.210.0 — The workflow rules reach the agents that are not AtlasMind

AtlasMind's workflow gates are **self-restraints**. The effective level of a stage is `min(master, ceiling, capability, stage)`, and that arithmetic governs what *AtlasMind* may do — it cannot bind the human, and it cannot bind Claude Code, Copilot or Cursor, none of which can read a VS Code setting or a file in `project_memory/`.

So the rules were enforced against the one participant that had already agreed to them, and invisible to every other. **An external agent committing straight to the integration branch was not violating the workflow; it had no way to know one existed.** There is no stronger gate to be had over a process AtlasMind does not run, so the fix is the mechanism that does work: put the rules in the file the agent already reads.

The committed `workflow.json` is now rendered as instructions into `CLAUDE.md`, `.github/copilot-instructions.md`, `AGENTS.md`, Cursor, Cline, Gemini, Windsurf and Aider — a **third** managed block beside testing protocols and debt markers. Branch rules and which branches are never pushed to, how far the reader may go at each stage, the evidence each stage wants, the label taxonomy.

Four things it does deliberately: every line is **derived** from the file rather than model-generated (a hallucinated rule an agent then follows is worse than no block); it prints the level your **ceiling** permits rather than the level a stage asked for (printing `auto` under an `observe` ceiling would invite an agent to act on authority nobody granted); levels render as instructions rather than labels, since `propose` means nothing to a reader who has not seen the ladder; and where no stage is enabled — the default — it **says so** instead of omitting the section, because a missing table reads as "no rules apply".

**A pre-commit check keeps the blocks honest, and never writes.** `atlasmind.instructions.verifyOnCommit` (on by default) refuses a commit when a block no longer matches its source, naming the command that fixes it — how this project already treats a missing version bump.

Verify-only was chosen over auto-sync on purpose. The existing hook only ever reads and refuses; making it mutate would mean the commit you staged is not the commit that lands. And a *bi-directional* sync at commit time would pull other agents' edits in and broadcast them to all eight instruction files unreviewed — one tool's change silently becoming every tool's instruction, on exactly the files other agents write to.

Detecting staleness from a shell is the interesting part: re-rendering is impossible without a VS Code host, and a second copy of the rendering would drift and cry wolf until somebody switched the check off. So the sync records a **digest of the source document inside the block**, and staleness is a digest comparison. What that detects is stated rather than overclaimed — the source changed since the block was written, not a hand-edit that leaves the digest alone. The debt-marker block is deliberately unchecked, because it comes from a setting a hook cannot read.

## v0.209.3 — The dashboard tabs get their styling back

Every unselected tab on the Project Dashboard nav rendered as a light grey pill with grey text on a dark panel — the browser's default button look, with no theme colour in it.

**A selector changed which rule block it belonged to.** `.page-nav button` was the first entry of the pill rule it shared with `.action-link`. The commit that added the GitHub link row (v0.206.0) inserted its rule directly beneath that line, so the nav buttons became part of a *container layout* — `display: flex`, `flex-wrap: wrap`, a 14px bottom margin — and were orphaned from background, border, colour, padding and radius. Nothing was deleted or renamed; in a diff it reads as one added rule.

**It survived review because the selected tab still looked right.** `[aria-selected="true"]` declares its own colours, so exactly one tab was correct and the row read as a deliberate style rather than a fault.

A test now asserts the tabs own their appearance from theme variables (never a literal colour), that the selected-tab rule still exists, that the GitHub link row is still a row, and that the pill stays one shared block rather than two that can drift. Reverting the fix fails 8 of its 11 assertions.

## v0.209.2 — The README was measuring "what's new" from the wrong release

It claimed *"Since the last Marketplace publication, **v0.145.3**"* while the Marketplace has had **v0.208.0** since that morning — sixty-three releases stale. The section therefore listed **81 bullets** of work that is already in the published extension, so anyone using it to decide whether a source build was worth installing saw a two-hundred-line delta where the real one is four.

Trimmed to what a v0.208.0 user is actually missing. The full history stays in `CHANGELOG.md` and on this page — the README's job there is the upgrade decision, not the record.

**Nothing local could contradict the claim, which is why it rotted.** Every other version check compares two files in this repository; this one asserts something about the outside world. It is now pinned against the newest git tag, which stands in for "what is published" because `npm run tag:release` is what triggers the publish — the tag and the publish are one event. A baseline *ahead* of the source version is refused too, since that would describe a rollback as a feature. The guard is skipped where tags are absent (CI checks out shallow) and runs in the pre-commit hook, which is exactly where the README gets edited.

**Trimming the list exposed what it had been hiding.** Fifteen shipped capabilities appeared *only* in that accumulated "What's new" — so the pitch a Marketplace visitor actually reads had never been updated to include them, and cutting the list would have removed them from the README altogether. The guided GitHub workflow and its automation ladder, ideation reaching the backlog, roadmap items becoming issue drafts, the tech-debt register, the four delivery keys, agent handoff, schema migration, GitHub deep links, the keep-awake lock and locale-aware cost display are now in **What is included**, with a new pillar for working the way your repository already works.

Each claim was verified against the code implementing it rather than the changelog prose describing it, which caught one overstatement going in: the dashboard does *not* link every page to GitHub, since four pages are about the local machine rather than the repository.

## v0.209.1 — Slash commands work in the chat panel

They never had. `runPrompt` never looked for a leading `/`, so all nineteen commands the manifest declares reached the orchestrator as ordinary prose — and on a machine with no provider configured, `/acp` was answered by the built-in echo adapter with *"Answered from context."* Declared, documented, autocompleted by the composer, and inert.

**Silence was the harm.** A command that visibly fails gets reported; one that returns a plausible model answer teaches the user the feature works and they are holding it wrong. And the specific fall-through was worse than generic: `/acp` and `/buzz` are *setup* commands, run precisely because nothing is set up yet, and they were being handed to an agent holding every connected tool. `participant.ts` closed exactly this hole for the VS Code chat surface in v0.164.0 and documents why; nothing tied the panel to that lesson.

**One dispatch, two surfaces.** `runDeterministicSlashCommand` is factored out of `handleChatRequest`, and the panel replays those same handlers through a `ChatResponseStream` that writes into memory. Seventeen commands, one implementation. The rejected alternative was a table pairing each command with an equivalent VS Code command — nineteen chances for the panel to answer `/agents` differently from `@atlas`, kept correct by hand forever. Handler buttons become the panel's existing guide chips, so only ids cross into the webview. A stream feature the panel cannot draw degrades to a note naming it rather than throwing: losing an anchor beats losing the command.

**A path is not a command.** `/usr/local/bin/claude-agent-acp is missing`, `/etc/hosts` and `/README.md` stay prose, because asking about a file by absolute path is constant in a coding assistant. Only a single lowercase, optionally-hyphenated word qualifies. A near-miss like `/agent` is corrected rather than forwarded — the same bug in miniature.

**`/project` forces its goal but not its approval.** A goal typed after `/project` often will not match the prose intent router's patterns, so the command would otherwise become an ordinary chat turn. Forcing it is the fix; pre-approving it would have removed the file-count proposal gate as a side effect of routing, and that gate is the only thing between `/project` and an unattended run. `/project` with no goal is refused rather than run against the empty string.

Two things the work turned up about its own tests: the first version awaited two dynamic imports before concluding a prompt was prose, delaying the busy indicator on **every** message — an existing test counting microtasks caught it, and the router is now synchronous and statically imported. And `slashCommandRouting.test.ts` sliced source between `handleChatRequest` and `case 'voice':`; moving that label above the function left the slice empty and the assertion passing vacuously. It is anchored on function boundaries now.

## v0.209.0 — The ACP connection actually works

ACP has shipped since v0.170.0 as "use the subscription you already pay for". On Windows nobody could have used it. **Four faults, each fatal on its own**, all found by running the thing against live agents rather than reasoning about it.

**AtlasMind told you to install the wrong package.** The adapter spawned `claude-agent-acp`; the install command it displayed was `npm install -g @zed-industries/claude-code-acp`, whose `bin` is `claude-code-acp`. Following AtlasMind's own instructions produced a binary AtlasMind then failed to find. That package has since been renamed to `@agentclientprotocol/claude-agent-acp`, which does provide the right command. The adapter, the installer and the `/acp` guide each carried a separate copy of the pairing, so nothing in the code could notice they disagreed — there is one list now, every install command is derived from it, and a test checks each against the package that really provides it.

**`cargo install codex-acp` installed nothing, because no such crate exists.** The Codex path asked you to install Rust in order to install a package that was never published there. It ships on npm like every other adapter, so the Rust prerequisite and the rustup dead end are gone.

**Windows could not spawn an ACP agent at all.** Every published adapter is an npm `bin`, and npm writes a `bin` on Windows as three shims — extensionless shell script, `.cmd`, `.ps1` — none of them an executable image. `spawn(…, { shell: false })` therefore failed with `ENOENT` for a perfectly correct global install, and `ENOENT` reads as "you have not installed it" to somebody who has. The `.cmd` is no help either: Node has refused those without a shell since CVE-2024-27980, and a shell is exactly what `shell: false` exists to avoid. New `acpLaunch.ts` reads the JavaScript entry point the owning package *declares* in its `package.json` `bin` field and spawns Node against it — a contract the author wrote, rather than npm's generated scripts parsed — which also handles `gemini` living inside `@google/gemini-cli`. Real executables still spawn directly; POSIX is untouched.

**An agent that listed its logins was declared signed out, and refused.** `authMethods` advertises which logins *exist*; it says nothing about whether you owe one. `codex-acp` lists `api-key` and `chat-gpt` unconditionally, then works perfectly for somebody already signed in — so reading that list as "not authenticated" refused every working ChatGPT subscription with a message you could not clear. The spec's actual signal is the reserved error `-32000`, and the probe now opens a real session to find out, so it reports that the agent *can be used* rather than that it started.

**Every ACP completion was recorded as free.** Token counts were read from `inputTokens`/`outputTokens` on the `usage_update` notification, which no agent sends: that notification carries `{ used, size, cost? }` — cumulative *context occupancy* — and the per-turn counts arrive on the prompt result. Both are read for what they are, and context is deliberately never billed as input tokens, which would re-charge the whole conversation on every message.

**Three more subscriptions became capacity: Gemini CLI, GitHub Copilot CLI, and Qwen Code.** Gemini was previously excluded on the correct grounds that its invocation was unpublished; the ACP registry declares it now. All three are interactive CLIs with an ACP mode, so `args` is part of the launch command and is carried everywhere an agent is registered. goose, OpenCode, Cursor and Kimi are named with their commands but have no install button, because AtlasMind will not download and unpack an archive.

**Verified against live agents:** `claude-agent-acp` 0.63.0 streamed a reply with `inputTokens: 2, outputTokens: 5`; `codex-acp` 1.1.7 streamed one with `inputTokens: 28693, outputTokens: 6` **while advertising two auth methods**, which the previous build would have refused; `gemini --acp` resolved through the shim bypass with its flag intact and was correctly reported as not signed in via a real `-32000`. The same build accepting Codex refuses Gemini — the distinction the old code could not draw.

**The comparison matrix is out of the wiki.** `Home.md` rated six competitors across nineteen capabilities and was already contradicting itself on the same page — "31 built-in skills" in the matrix, 43 in the table above it. That is the predictable end state of a document asserting facts about software we neither ship nor watch, and a stale claim about a competitor is worse than no claim. v0.147.0 removed the standalone comparison page for the same reason; this table survived that cleanup.

## v0.208.3 — Publishing without a secret

The Marketplace publish now authenticates through **Microsoft Entra ID** with GitHub OIDC workload identity federation, as the user-assigned managed identity `vscode-marketplace-publisher`. There is no Marketplace credential in the repository to expire, rotate or leak. PAT authentication for the Marketplace is retired on **1 December 2026**.

**The publish job checks its rights before it packages.** The 0.208.0 release discovered its credential was dead *during* the upload, after building the extension. `vsce verify-pat --azure-credential` asks first and consumes no version number — which matters because a published version can never be replaced.

**Two publish scripts, on purpose.** `publish:release` uses the credential `vsce login` stored in the OS keychain and stays the emergency path from a developer machine. `publish:release:ci` uses the Entra identity. Adding `--azure-credential` to the first would have broken local publishing.

The security rests on the federated credential's subject — `repo:JoelBondoux/AtlasMind:environment:marketplace` — not on secrecy, which is why the Azure identity values are stored as repository *variables* and why both jobs must declare that environment.
## v0.208.2 — The release promotion no longer conflicts with itself

`release.yml` merged the `develop` → `main` pull request with `--squash`. Squashing rewrites develop's commits into one new commit on `main`, so `main` immediately holds a commit that is not an ancestor of `develop`. Every promotion after the first then has a merge base two releases back, and every file both branches touched conflicts — which is exactly `CHANGELOG.md`, `package.json`, `README.md` and `wiki/Changelog.md`, the four that every release touches.

It works once and conflicts forever after. Promotion now uses `--merge`, keeping `main` an ancestor of `develop`.
## v0.208.1 — Proving the publishing identity without publishing

PAT authentication for the Marketplace is retired on **1 December 2026**, so AtlasMind's release path is moving to Microsoft Entra ID with workload identity federation — no secret in the repository, nothing to rotate, nothing to expire.

This release adds the step that makes that migration testable. `Marketplace — verify publishing identity` authenticates as the managed identity and reports its Azure DevOps profile id plus whether it has publish rights. The profile id is what the publisher's Members list calls a "User Id", and it **does not exist until the identity authenticates once** — so the workflow is the only way to obtain it.

The rights check is `vsce verify-pat --azure-credential`, which consumes no version number. That is the whole point: a published version can never be replaced, so a publishing credential has to be testable without publishing.

Azure identity values are stored as repo **variables** rather than secrets — a client id and tenant id are discoverable, and treating them as secrets would misrepresent where the security lives. It lives in the federated credential's subject, which names one repository and one environment.
## v0.208.0 — Ideation becomes stage 0 of the workflow

The board had nine card kinds — including `problem`, `requirement`, `risk` and `evidence` — and exactly two outbound paths: launch an autonomous run, or append prose to a memory file. Neither reached the backlog, so the eight-stage workflow started at *Planning & Issue Intake* with nothing feeding it, and a card called `requirement` could not become a requirement.

**Raise as work** turns a card into a roadmap item. Nothing is generated — a rule table over the card and its edges, so the same card yields the same line and the roadmap stays reviewable. A `problem` becomes `Fix: …`, a `risk` becomes `Mitigate: …`; the work is the fix, not the problem. A `requirement` or an `idea` needs no prefix, because putting an idea on the roadmap *is* the commitment.

**Focus is deliberately not decided in the new module.** The roadmap already derives focus from item text with one keyword table, and a second classifier keyed on card kind would eventually disagree with it.

**The board's connections become the issue's reasoning** — what the work depends on, what supports it, what argues against it. Direction is load-bearing (“this depends on X” and “X depends on this” are opposite plans), and a contradiction is stated as a **caution** rather than listed among the supporting points.

**Provenance both ways, keyed on text not ids.** Roadmap ids are positional and renumber on insert, so a stored id would mean something different a week later. A renamed item is reported as no longer linked — never shown against whatever now occupies that position.

### Fixed

**The dashboard had been reading the board through a stale vocabulary.** Its card-kind list was the older set and its sanitizer coerced anything else to `concept`, so five of the nine current kinds were relabelled on every read. `summarizeIdeationBoard` renders the kind **into a model prompt**, so a `problem` and an `idea` reached the model indistinguishable. Both vocabularies are recognised now, since older boards really contain the legacy names.

**It could not see the board's typed relations at all** — no `relation` or `direction` on its copy of the connection record. Neither is required when reading, because older boards have neither; an untyped edge reads as `supports`, the weakest of the five, so nothing is promoted into a dependency or contradiction nobody drew.

**Two NUL bytes committed in v0.207.0**, in a hostile-input test, from a heredoc mangling a double space — and one replaced the exact double space the assertion checks for, so that test had been passing without testing what it reads as.

**The v0.207.0 issue-provenance line quoted a positional id**, which would have pointed at a different item within a week. It names the roadmap file instead.

**Four more Windows temp-cleanup flakes**, the same class as v0.201.1.
## v0.207.1 — Bootstrap no longer eats your ideation board

`seedBootstrapIdeation` wrote `ideas/atlas-ideation-board.json` unconditionally, so a second bootstrap on an existing project replaced every card, connection and piece of evidence with defaults derived from the intake answers — and returned `true` either way, so the report said "Seeded ideation defaults" for what was an erasure.

The board is a **document the user authors**, not a scaffold AtlasMind maintains. Same rule as `documentsManager` and `workflowConfig` now: seeding never overwrites, only an explicit save replaces content. The existence check runs before the directory is created, so a re-run touches nothing, and the report distinguishes "seeded a board" from "left yours alone".

A board that is silently discarded on re-run is a board nobody invests in — which is the honest explanation for why the Ideation surface felt abandoned.
## v0.207.0 — From roadmap to issue, and milestones that attach

The roadmap held the work in a structured, prioritised, gate-tagged list. Issues could only be created by hand-typing a title, a body and a comma-separated label list. Nothing connected them, so anybody planning in AtlasMind and tracking on GitHub retyped every item.

**The draft is derived, not generated.** No model is in this path, so the same item produces a byte-identical issue every time — which is what makes it reviewable: you can see the rule that chose a label and predict what the next item will produce. A generated issue title is a claim nobody checked, posted publicly in your name.

**It drafts; it does not file.** The text lands in the composer for you to read and edit, and posting goes through the same confirmation as every other issue write.

**Labels come only from the declared taxonomy.** An invented label is *created* on the repository as a side effect of filing — a write nobody asked for, in a vocabulary the team agreed. Several candidates per focus are tried in order; the repository's own spelling wins (`Documentation` and `documentation` are one label to a human and two to `gh`); an intent matching nothing is **reported in the draft** rather than dropped silently. A gate becomes a label only where the repository already uses that word.

**Milestones now attach.** `gh issue create` was called with `--title`, `--body` and `--label` only, so a milestone could be declared in the taxonomy, managed on the Issues tab, and attached to nothing. The composer offers the repository's open milestones, and a name that is not one of them is refused with an explanation rather than passed to `gh` to fail on.
## v0.206.0 — Every page links to the GitHub page it is about

The dashboard read GitHub, reasoned about it, and left you to navigate from the repository root yourself. Issues now links to the tracker, to unassigned issues and to the label list; Pipeline to Actions; Release to releases and tags; Workflow to branch protection; SSOT to `project_memory/` as your team sees it committed.

**The webview never names a URL.** It sends a page and a link id, and the host maps that to a URL it built itself. A surface that could name the URL to open could name any URL, and `openExternal` hands it to the browser without asking whose it is.

**The slug is untrusted input** — it arrives from a git remote and is interpolated into a URL. Validated against GitHub's real naming rules rather than checked for a slash, so nothing carrying a path segment or a query can redirect a link. A slug that does not parse produces **no links at all**: pointing somebody at somebody else's issue tracker is worse than no button.

**Derived from the git remote, not `gh`** — no network, no authenticated CLI. A route *to* GitHub is most useful on exactly the setups where `gh` is not working.

**Only surfaces every repository has.** `/wiki`, `/discussions` and `/projects` can each be switched off, and a 404 behind a button we drew reads as our bug rather than as a repository setting. Privacy, Runtime, Risk and Ideation get no links: they are about this machine, this extension and this project's own judgement.
## v0.205.0 — Two guards, and what they found

Documentation drift was the most-repeated defect in this project's history and the only one with no test. Tree row commands were attached in twelve places with no guard at all. Both now have one, and both found real things on the first run.

`docsIntegrity` resolves what the documentation *points at* rather than judging what it says: wikilinks, relative links, cited source files, cited CI workflows, cited settings, the version in four places, and the `CLAUDE.md`/`AGENTS.md` byte-identity. `treeCommandIntegrity` checks every command a tree row or titlebar button names against what is registered, and every dashboard page a row opens against the panel's page list.

**What they found:**

- `atlasmind.specialistRoutingOverrides` shipped once and was removed from the manifest and the code on 18 April 2026 — and **four documents kept describing it as current**, one with a worked JSON example. Following the docs meant writing that JSON and getting silence: worse than the feature being absent, worse than being told it is gone.
- **Four rows in `CLAUDE.md`'s UI table named files that do not exist.** The instruction file every agent reads before touching this codebase had four surfaces at the wrong path.
- `docs/development.md` linked to `SECURITY.md` from inside `docs/`, which resolves to `docs/SECURITY.md`.
- Two settings — `atlasmind.testingPolicyOverride` and `atlasmind.ideation.crossProjectPaths` — were **read by real code and absent from the manifest**, so they worked only if you hand-edited `settings.json`. Now declared.
## v0.204.0 — What moved since you last looked

Every band on the Workflow page answered *what is the state?* — the score, the gates, the counts, the gaps. None answered *what changed?*, and when the state is nearly the same every day, a surface that only reports state is one you learn to skim.

The delta is the **first card on the page**, because the ladder is a setting you change once and this is the part that differs daily. The window is *since you last opened this project*, and the card names it rather than leaving "since you last looked" to do the work — a quarter's drift read as this morning's news is the failure being avoided.

**Five ways a delta can lie, closed in the module:**

- No baseline is a **first look**, not eighteen changes.
- **Unknown → known is not zero → n.** If `gh` was missing last time, "0 → 12 issues" invents a spike that never happened.
- **Known → unknown is news**, and ranks above the movement it hides — it explains the silence.
- **A different repository is not a comparison.**
- **It never reports your own actions back to you.** Your branch and dirty tree are excluded on purpose.

Direction is kept, and which direction is *good* belongs to the field: more CI workflows better, more stale issues worse, a version change neither. Ranking is by consequence — a red pipeline outranks forty new issues. Lists compare as sets, since `gh` promises no ordering.

The baseline lives in `workspaceState`, **never in `project_memory/`**: the SSOT is git-tracked, so a baseline there would mean "when did anybody last look", would show as an uncommitted change on every dashboard open, and would conflict between two people looking on the same day.
## v0.203.0 — Turning the workflow on, from the dashboard

The four automation gates were a read-out with one link to a settings page. They are now controls, and the card opens by saying exactly what would have to change to reach `propose` — the rung where AtlasMind starts changing things other people can see.

**Turning a gate off is immediate; turning one on asks first** and names what it permits. A dialog in front of somebody reaching for the brake teaches them to dismiss dialogs. The ceiling gets a picker, because it is a level rather than a switch.

Written to the **workspace** scope — a per-project decision. And where another scope is holding a gate closed, the row **says so and writes nothing**: flipping a control that changes no behaviour is the same silent no-op as a dead button, arriving through the settings system instead of the command allowlist.
## v0.202.0 — The sidebar, reordered and relinked

**The order reads as a sentence:** where you work (Chat), what needs you (Project State, Project Director), what has happened (Runs, Sessions), what the project knows (Memory), what does the work (Agents, Skills), what it runs on (Models), what it can reach (MCP Servers, Resource Discovery).

**Project Director moved from last to third.** It carries an overdue-follow-up badge and sat below three configuration views — a badge nobody scrolls to is a badge that does nothing.

**Every titlebar now carries actions about its own view.** Sessions had ten navigation actions, seven about something other than sessions, and VS Code collapses anything past five into a `…` menu — both irrelevant and hidden. The global routes stay on Chat, which acts as the app's home. A test caps every view at five slots.

This reverses a deliberate decision: a test asserted Sessions and Memory should carry the *same* quick actions as Chat. The duplication was intended; it did not survive a titlebar that only fits five.

**Project State had no titlebar at all** — no route to the detail behind the glance, no way to update it. It now opens the dashboard, refreshes on demand, and opens the safety settings.

**Fixed: four links in the Project State tree.** Two rows had none. The automation row opened a Settings panel that does not render those settings. And the CI-failure row — the most actionable row there — pointed at the Workflow page after the classified failure moved to Pipeline in v0.188.0: a link to where the content used to be, which is worse than a missing one because it looks like it worked.

**Fixed: a setting that hid the wrong action.** `showImportProjectAction` is documented as governing the Import action, and was also gating "Update memory" on the Memory view — so turning the import off hid both.
## v0.201.1 — A flake fixed at the third sighting

Temporary-directory cleanup in nine test files threw `EBUSY`, `EPERM` or `ENOTEMPTY` on Windows, after the test had already passed every assertion. It finally failed CI.

Cleanup is now best-effort in one shared helper. A test that passes its assertions and then fails on housekeeping reports a **false negative**, and a false negative in CI is worse than a leaked temp directory — once a red build might mean nothing, people stop reading red builds. That is the failure mode `ciFailureAnalysis` exists to keep out of this project, so it should not arrive from the tests.
## v0.201.0 — Labels and milestones

When AtlasMind drafts an issue it takes labels only from the declared taxonomy and drops anything unmatched rather than inventing it — a rule only as good as the set behind it. The Issues tab now shows that set, with create, delete and close.

**A deletion names every issue that will lose the label.** GitHub removes it from the repository *and* from every issue carrying it, in one step it cannot undo, and says nothing about how many. AtlasMind names them from the issue list already on screen, so it costs no request. Closed issues count — a label stripped from a closed issue takes its categorisation with it, and closed issues are what people search.

Where the issue list was never loaded it **says so rather than reporting zero**: "nothing uses this" and "we did not look" lead to opposite decisions.

**Taxonomy drift, both directions.** A declared label that does not exist is silently dropped from every draft; an undeclared one in use will never be suggested. Reported as a comparison, not an error.

**A milestone is closed, never deleted** — deleting one detaches every issue from it silently. **A colour is validated to six hex digits or dropped**, because the value reaches a style attribute.

This completes every item in the guided-workflow roadmap.
## v0.200.0 — Review comments, one at a time

The line-level review comments — somebody pointing at a line and saying what is wrong with it — are the actionable half of a review, and nothing read them until now. "Address the review" meant handing a model every comment at once and hoping it found the place.

Each comment now renders with the file and line it points at, a button that opens exactly there, and **"Address this one"**: a chat scoped to that comment alone. The prompt keeps the REPORTED CONTENT fence — this is where an arbitrary third party's text reaches a model that can call tools — and forbids addressing the rest of the review or replying on the pull request.

The path is traversal-checked, because it arrives from a third party and becomes something you click. One that cannot be trusted is **emptied rather than rewritten**, and the comment is still shown: the text is worth reading even when the button is withheld.

**Fixed:** a new file button shipped with an action name the handler did not recognise, so it silently did nothing — the same failure as 0.199.0's two Workflow buttons, one table down. A test now checks every `data-action` has a listener.
## v0.199.0 — Agents learn the markers, and two dead buttons

**Agents are told which debt markers to use.** One that leaves temporary code marked `@todo` or nothing at all produces debt the register cannot see — and invisible debt is worse than no register, because emptiness then reads as "no debt" rather than "not detected".

AtlasMind's own agents get the vocabulary appended to every role prompt, read from settings when the prompt is built. External agents (Claude Code, Copilot, Cursor, Cline, Codex, Gemini, Windsurf, Aider) get it as a **second managed block** beside the testing protocols — separate because the two answer different questions and change at different times.

**Fixed: two buttons on the Workflow page did nothing.** "Change the project shape" and "Open settings" pointed at a command that was never allowlisted, so the host dropped the message. Silently — which is what let them ship, because from the outside a dropped command looks exactly like a broken feature and exactly like one that quietly worked. A blocked command now says so, and says it is AtlasMind's bug.

"Change the project shape" now opens the setting it actually changes, rather than a Settings panel that does not render the archetype at all.
## v0.198.0 — Your own debt markers, and a way to search them

**`atlasmind.debt.markers`** takes entries like `["DEBT", "REVISIT:high", "NOTE:low"]`. The scan looks for those alongside the built-in four. An unqualified marker is **medium** — somebody who declared a marker is asserting that something is wrong, the same reason `FIXME` outranks `TODO`.

Each becomes a **declared rule**, named on every entry it grades and published in the rule table. That is what keeps the register comparable rather than merely populated.

**Two things a project cannot do:** redefine a built-in (grading your own `TODO` as high would make two registers incomparable) or escape the security grade (a credential mention is high whatever you called it).

**Search and filter.** The search covers what it says, where it is, and which marker found it. Filter chips appear only for markers that actually graded something. A filtered view says how many it is hiding — in a register that never deletes anything, a shorter list must not look like work disappearing.
## v0.197.0 — Project shape reaches the scaffolder

**The testing playbook says what your shape asks for:** which methodologies suit it, which recommended ones are not enabled, and which enabled ones the shape discourages. That last matters most — a methodology a shape cannot produce evidence for becomes a permanent gap, and permanent gaps teach people to ignore gaps. Read from the archetype packs rather than restated, so there is one copy.

**Scaffolded CI is specialised.** Generic Node steps stay real commands, because the manifest says those scripts exist. Archetype steps are commented suggestions carrying their rationale, because AtlasMind knows a game wants a determinism gate without knowing your command for one — and a guess that fails on your first commit teaches you to delete the file.

**Fixed: `game` finally does something.** Detected since the archetype work shipped and acted on nowhere, so a game project got a Playwright test for a page it does not serve and a k6 load script for requests it does not take. Now a determinism test and a frame budget.

**Also fixed:** a function described in a comment that did not exist; every shape chosen at bootstrap resolving to `generic` because the picker shows prose and the normaliser takes ids; a starter file that emitted TypeScript into a `.js` project; and CI triggering on `master`, which is not the default branch of any repository created since 2020.
## v0.196.0 — Agents can ask each other questions

`agent-handoff` is the tenth built-in workspace tool and the first that gains an agent a *capability* rather than a fact. An agent puts a question to a named specialist and gets their answer back, while keeping ownership of the task.

**A handoff transfers the question, not the permissions.** The delegate runs with the intersection of the caller's skills and its own, never the union. A tool the caller does not have, the delegate does not get either.

That is the point rather than a limitation. If a handoff granted the union, any restricted agent could obtain any capability by asking a permissive one, and every restriction in AtlasMind would become a suggestion. What it *does* buy is the specialist's expertise applied within the caller's authority.

**Bounded and honest.** Three deep, no loops back to an agent already in the chain, and a delegate that would have no tools at all is refused rather than run — a model that cannot check anything produces confident prose. The answer returns fenced and labelled as another agent's opinion, not a verified result.

A disabled agent cannot be reached through delegation, and the caller's budget is not inherited.
## v0.195.0 — Debt entries can be handed to an agent

“Look at it with Atlas” opens a scoped chat with the entry, its evidence, and the rule that graded it. The `refactorer` agent has existed since v0.184.0 and until now had nothing to reason over.

**The framing matters more than the wiring.** A debt entry is not untrusted third-party text — AtlasMind wrote it, from your own repository, through a sanitizer — so the risk is the inverse of an issue body's: not that the text is hostile, but that an agent reads a recorded shortcut as a mandate. Plenty of debt is worth keeping.

So “worth keeping, with the reason it was the right call” is a first-class answer, the button says *look at it* rather than *fix it*, and the prompt ends: propose, do not apply.
## v0.194.0 — Debt nobody wrote down, and a bug class closed

**The register now finds unrecorded debt.** A dependency update unmerged past two weeks, a testing methodology declared with no evidence it runs, a document past its review baseline, an absent pipeline. Those four rot quietly and none leaves a `TODO`. All graded by the same rule table as a scanned marker — a register holding two scales would be worse than one holding half the entries.

Dependency bots are matched on author, label or branch prefix and **never on title**: they rename their own templates between versions, and a title match would silently stop working on an upgrade nobody connected to the change.

**Four more guide steps that could not change state.** `ciStatus` was hardcoded to `'none'`, so a project with a green build was told it had no check runs. `openDependencyPrCount`, `staleDocumentCount` and `requiredApprovers` were read by steps and never assigned. Three further fields were declared and read by nothing, and were removed.

**The bug class is now enforced by a test.** Four versions running, a field the guide reads turned out never to have been supplied, and each time the symptom was the same: the guide asks you to do something and then refuses to notice you did.
## v0.193.0 — A tech-debt register

Borrowing to ship sooner is legitimate; the danger is the interest paid by forgetting. A scan records each `TODO`, `FIXME`, `HACK` and `XXX` with its file, its line, and the rule that graded it.

**Severity comes from a declared rule, never a judgement call.** A grade assigned last Tuesday cannot be compared with one assigned today, and comparability is the only reason the register is worth keeping. The whole rule table is published in the mirror beside the entries.

**Severity does not drift with age.** An entry whose grade changed while nothing about the code changed could not be compared with last month's. Age is shown separately.

**Entries transition; nothing is deleted.** `resolved` means somebody did the work; `obsolete` means the evidence vanished and nobody said they fixed it. Different facts, and only one is an accomplishment.

**The scanner's rule was rewritten after it failed on its own repository** — 29 flagged items, all false, including its own rule table and tests. A marker now only counts when it *opens a comment*: one inside a string or discussed in prose is data or documentation, not a deferred decision.
## v0.192.0 — The workflow records what it did

Every part of this workflow makes a determinism claim, and a determinism claim is either verifiable or it is marketing. `project_memory/operations/workflow-history.json` makes them verifiable: two runs with the same inputs must produce the same outputs, and where they did not, **both runs are named**.

**Fingerprints, not values.** The ledger is committed, so storing what was processed would put issue bodies, review comments and CI logs into your repository. A fingerprint proves the same input produced the same output without publishing either.

**Record first, then act.** A record written afterwards is missing exactly when it matters most — the run that crashed is the run somebody needs to read about. An action whose record cannot be written does not happen.

**Fixed: a safety switch that did nothing.** `atlasmind.workflow.allowIssueWrites` had shipped as a documented setting since v0.181.0 with nothing consulting it. Issue writes now take the same ladder gate pull-request writes have had since v0.183.0 — a behaviour change, and a deliberate one: a false assurance is worse than no switch.
## v0.191.0 — The rest of the workflow schema

v0.190.0 implemented most of the specification's workflow schema and not all of it. Four things were described there and absent from the code, including `command` — whose rule the module header *cited* while the field did not exist.

**An empty command is the blocker, not an oversight.** Absent means the stage needs no command; empty means it needs one and has none. They never collapse, because conflating them either turns a deliberate blocker into an oversight or opens a gate. The generated mirror shows all three states distinctly.

**Labels are categorised** — type, priority, status, area. A flat list makes "drawn only from the declared taxonomy" satisfiable by three conflicting priorities. Observed repository labels seed `type` only; sorting somebody else's labels would be guessing at what they mean.

**Testing requirements are declared as inherited**, so a reader finding none in this file knows that is the design rather than an omission.

**The file is checked against what it names.** A stage owned by an agent this workspace does not have is reported, never dropped — a silently ownerless stage reads as one nobody was assigned.
## v0.190.0 — The workflow becomes a file you own

**`project_memory/operations/workflow.json`.** Branches, naming convention, label taxonomy, and each stage's requested automation level with its attestations and blockers — a committed file rather than a setting, so a change to how a team works arrives as a diff with a reviewer rather than a habit nobody wrote down. A readable markdown mirror is generated beside it for whoever reviews that diff.

**A stage may be disabled but never deleted.** Disabling leaves the decision in the record; deleting erases the evidence it was made. Deleting one by hand is not an error — it is restored, disabled, which is the safe direction.

**The file sets intent; your settings set the ceiling.** A stage can request `auto` and still do nothing, because what happens is the lowest of four independent gates. Every level change says so in the same sentence.

**Never created implicitly.** Every other persisted document seeds itself on first read. This one gets committed, so writing one because somebody opened a tab would be putting words in their mouth in a file other people review.

**Fixed:** "Declare your workflow" had been in the guide since the curriculum shipped with the flag behind it hardcoded `false` — a step nobody could ever complete, on any project. And the guide named `develop` and `main` at everybody, so a project using different branch names was taught a workflow referring to branches it does not have.
## v0.189.0 — Release preparation, and the four delivery keys

**A Release page.** Stage 6 was the best-served stage in the specification and the least reachable — the version-bump, changelog and semver functions had been pure and tested for a long time with nothing putting them in order. Seven gates now run root-cause-first (changelog entry → notes → secrets → version → tag → working tree → CI), because being told CI is red is unhelpful when the real problem is that no changelog entry exists.

**"Unknown" is not a pass.** A repository whose tags could not be listed genuinely does not know whether its tag is free. Shipping on an unknown is the habit this stage exists to break.

**Release notes are the changelog section, verbatim** — never summarised, never model-generated. A generated release note is a claim nobody checked attached to a version nobody can change. If the text contains anything shaped like a credential, the release is **refused rather than redacted**: these notes are outbound and permanent, so publishing a quietly edited version of what you reviewed is the worse of the two failures.

**The four delivery keys** — deployment frequency, lead time, change failure rate, time to restore — paired so a team cannot improve speed by wrecking stability. Lead time is measured merge → release, with unshipped merges excluded rather than counted as infinitely slow. A change failure is a patch release within 48 hours, applied literally, with every counted release named so the number can be argued with.

**Fixed:** a changelog check that could not fail — `changelogHasCurrentVersion` was derived from the file existing, so the most commonly missing thing at release time was reported present on any repository that had ever written a changelog. Also `commitsSinceTag`, which was hardcoded to zero and rendered as a fact.
## v0.188.0 — Pull Requests and Pipeline get their own pages

- **Pull Requests** is now a page rather than a card. Issues had a whole page while stage 4 — where a change stops being private — had one. It lists what is in flight with review state, size and issue linkage, plus review-latency and throughput.
- **Pipeline** is now a page, carrying the classified failure with its evidence and a **?** explaining how the classification is decided: first-match-wins over the log, no model in the path.
- **Tabs regrouped**: Where we stand · The work · The code · Is it safe · Ship & record · **The engine**. Runtime moved out of "The work", where it was the only tab not about the work.
- **The Workflow page stopped being a dumping ground** — ten cards plus the curriculum. It keeps what is about the workflow itself; per-stage detail lives on the pages named after those stages.

## v0.187.1 — the Project State view could never appear

- **Fixed a closed loop.** The view's `when` clause read a key computed from the provider's cache, but that cache was only filled by `getChildren` — which VS Code calls only for a *visible* view. Hidden because it had no data; no data because it was hidden. Shipped in 0.187.0 and visible to nobody.
- The model is now rebuilt independently of rendering, and a test pins the property: settings are always readable, so a real workspace always produces a section and the view is always reachable.
- **It now opens expanded.** The original reasoning (that it would steal height from Chat) was wrong — Chat is a webview many people hide, and every other row is collapsed. A summary you have to expand shows nothing.
- Gathering state can no longer break activation and take the other nine views with it.

> **Existing installs:** VS Code remembers your sidebar order and visibility. A new view will not jump into a sidebar you have rearranged — use the **⋯** menu to show it, or drag it where you want.

## v0.187.0 — a Project State view in the sidebar

- The sidebar had **ten views of inventory** and none of state. Nothing said where you are in the workflow, or what AtlasMind is currently permitted to do — the second being safety-critical and previously visible only by opening the dashboard or reading four settings across two scopes.
- Four collapsible sections: **what AtlasMind may do**, **where you are**, **waiting on you**, **deferred and ageing**.
- Nothing duplicates Source Control or a GitHub extension — no commits, branches, diffs or issue lists. Only facts that exist because AtlasMind exists.
- A section whose data could not be gathered is **omitted**, never shown empty. The **badge counts only what needs a person**, so it does not become permanently lit and therefore ignored. A *classified* CI failure deliberately does not raise it — it already has an owner and a fix.
- **Empty views now hide**: Project Runs, Sessions, MCP Servers. Feature entry points (Discovery, Director, Agents, Skills, Models) stay visible even when empty — hiding the only route to a feature is worse than a quiet row.

## v0.186.0 — roles a Director can assign

- **Five roles** — Director, Maintainer, Contributor, Reviewer, Observer — each with an automation ceiling and capabilities. Applying one writes the settings to the workspace, so they apply to everyone who opens the repository, after a confirmation listing every key and value.
- **A role is a configuration template and a declared expectation, not a permission boundary.** AtlasMind runs in each person's editor and cannot enforce one; saying otherwise would be security theatre.
- **A role never turns the workflow on**, and no shipped role grants `auto` — unattended action is something an individual opts into.
- **CODEOWNERS generation is where restriction actually bites**, because GitHub enforces it. Responsibilities gain path patterns; only AtlasMind's managed block is written, so hand-written rules survive. An owner GitHub could not resolve is dropped *and reported* — GitHub silently ignores one, so the path would have had no reviewer.
- The Maintainer/Director split is the useful one: a Maintainer prepares a release but cannot write to a protected branch, and a Contributor opens pull requests but cannot merge them.

## v0.185.1 — a person can always be more cautious than their team

- **Fixed:** the automation ladder read the *resolved* setting value, and VS Code resolves workspace above user — so a repository committing `maxAutomationLevel: auto` raised everyone's ceiling, and setting `observe` for yourself was overridden. The specification promised the reverse.
- Gating settings are now read **per scope**, with the most restrictive defined value winning. Unset still inherits the team's value, so a team setting is not made inert.
- `profile` and `archetype` keep normal precedence on purpose: they declare what the project *is*, rather than granting permission.

## v0.185.0 — the workflow now knows what kind of project this is

- **A game, a website, a library and a CLI do not share a workflow.** Different CI steps, release model, testing strategy, documentation, refactor advice and notion of a hotspot. Until now the guided workflow treated them identically, which meant it was tuned for none of them.
- **Archetype packs** declare all six axes per shape, as data in source — reviewable in a diff and overridable per item. Games get asset validation and a frame budget; libraries get an API-surface check and mutation testing; APIs get contract tests; CLIs get a cross-platform matrix.
- **Traits compose rather than multiplying the list.** A Shopify theme is a website that is *platform-hosted*; a VS Code extension is a library that is *platform-hosted* and *published*.
- **Detection suggests, declaration decides.** Both are shown when they disagree — declaring one thing while your dependencies look like another is a decision, not a mistake. Undeclared is honest: the page says so rather than pretending to know.
- **Games are declarable at last.** Previously detected from `phaser`/`bevy`/`pygame` and then ignored — the detection changed nothing, and bootstrap had no Game option at all.
- **Three disagreeing answers to "what kind of project is this?" became one.** No schema migration needed: the old delivery archetype was never persisted.

## v0.184.0 — a red build that explains itself

- **AtlasMind now reads CI logs, not just check states.** That is the difference between knowing a build failed and knowing why. It fetches recent runs and the failed log, then classifies the cause with an **ordered rule table — no model in the path**: dependency-install → compile → lint → test-failure → timeout → flake-suspect → infra → unknown.
- **Why a rule table and not a prompt.** A taxonomy that varies run to run cannot be charted, and a chart of CI failures over time is one of the most useful things a team can look at. Agents *explain* a classification; they never choose it.
- **Order is part of the contract.** Infrastructure is checked first, because an unreachable registry looks exactly like a dependency failure — and telling somebody to fix their lockfile when npm was down wastes an afternoon.
- **`unknown` is a real answer.** When nothing matches, AtlasMind says so and escalates rather than guessing. Flakiness comes from *history*, not one log: a job that both passed and failed on the same commit is flaky whatever its latest log says.
- **Logs are untrusted input** — ANSI-stripped, secret-redacted, size-capped and tail-preserved (the failure is at the *end* of a log), with truncation and redaction both reported rather than silent.
- **Three new agents**: `ci-analyst`, `release-manager`, `refactorer` — routing-neutral by design, so they cannot displace the agents that already own routed work.
- **Fixed:** the double-publish chain. `publish:release` published *and* tagged, and the tag push made CI publish again. Publishing and tagging are now separate commands.

## v0.183.0 — the automation ladder, and pull requests you can act on

- **The ladder is now real.** 0.181.0 shipped the settings and displayed them; nothing evaluated them. The effective level for a stage is now genuinely `min(master, ceiling, capability, stage)`, every gate closed by default — which is what makes *"full automation is possible, never default"* true by construction rather than by policy. Your own settings can only ever **lower** it.
- **Every refusal names the gate that caused it**, because "you cannot do that" with no reason sends you to toggle four settings at random. A disabled capability caps at `draft` rather than silencing the stage: turning off "may write" should stop the writing, not stop the explaining.
- **Pull requests can be opened, reviewed, merged and closed** from the dashboard — the first thing AtlasMind does that other people can see. Three gates in order: the ladder must reach `propose`, a protected base is a **veto** rather than a level to raise, and a modal names the repository and the exact action.
- **Drafts are synthesised, not generated.** Title from the conventional-commit classification of the range — reusing the same function that decides the version bump, so the two can never disagree. Body fills your own template, preserving every heading including ones AtlasMind has never seen. Same range plus same template ⇒ byte-identical draft, no model in the path.
- **Fixed:** a `BREAKING CHANGE:` footer in a commit *body* was being read as a patch, because the title logic split commits to their first line before classifying them.

## v0.182.0 — pull requests, branch naming, and one door to `gh`

- **Pull requests are read and measured** on the Workflow page: open and awaiting-review counts, median time to first review and to merge, size distribution, merge throughput. As everywhere on that page, *not loaded* is its own state — never a row of zeroes.
- **Review text is fenced before any agent sees it.** A pull-request body and a review comment are written by whoever can comment, and "address this feedback" is exactly the path that hands that text to a model with tools. Nothing sanitized it before because nothing read it.
- **Branch names derive from the issue** — `feat/142-guided-github-workflow`, pure and predictable, collisions resolved by `-2`/`-3` rather than a hash. It cannot produce a protected branch name, and refuses with a reason rather than inventing one.
- **Fixed a shell-injection hole in repository creation** — `gh repo create` interpolated an *unvalidated* GitHub owner into a shell string. Self-inflicted rather than remote, but exactly what argv arrays exist to prevent.
- **`gh` now has exactly one exec boundary**, pinned by a test that reads the real source. `probe()` also stopped claiming the CLI was installed when it had no evidence either way.
- **Issue and pull-request bodies stopped being flattened to one line** — the control-character strip included `\n`, so bodies lost their structure and the blank-run collapse below it was dead code. Present since the issue tracker first shipped.

## v0.181.0 — one guided GitHub workflow, and a dashboard that teaches it

- **Project Dashboard → [[GitHub Workflow|Workflow]]** lays out eight stages — issue intake, branch naming, development, pull requests, CI, release, maintenance, automation — and shows where your repository stands in each. Every step carries a **?** opening *why it exists*, *how to do it*, and *what people get wrong*, written for somebody meeting a professional workflow for the first time. Plus a glossary for the terms that usually get assumed.
- **It charts delivery health** — issue ageing, branch naming conformance, CI state, commit conventions, changelog drift, and a weighted score — with no network call on the render path, so opening it costs nothing.
- **Two honesty rules throughout.** A component that could not be measured is *omitted and named*, never scored zero. And no test report means *no verdict*, never "0 failing" — a suite that did not run is not a suite that passed.
- **Deny-by-default automation.** Six `atlasmind.workflow.*` settings; the effective level for a stage is the *minimum* of four independent gates, all closed by default. Your settings can only lower it. Force-pushing, deleting tags, re-running CI jobs, editing workflow files, and merging dependency updates never automate at any level.
- **Nine contradictions fixed** in AtlasMind's own documented workflow, including a **live double-publish hazard** — the documented release step ran `publish:release`, which publishes *and* tags, and the tag push then made CI publish again. Also six files claiming `project_memory/` is excluded from `main` (it is tracked there; `.vscodeignore` is what keeps it out of the extension), and two wiki links to a [[Delivery]] page that never existed.
- Specification: [`docs/guided-github-workflow.md`](https://github.com/JoelBondoux/AtlasMind/blob/main/docs/guided-github-workflow.md).

## v0.180.0 — the installer declines what it cannot actually do

- **On Linux it would have failed for almost everyone.** Elevation uses `sudo -n` — fail rather than prompt — because an extension host has no terminal to ask for a password in. That works for root and passwordless sudo and fails instantly for everyone else.
- A step needing rights AtlasMind cannot obtain is now **marked and not offered**: you get both commands to run in a terminal, and the reason says why. `brew` and `winget` are exempt — Homebrew needs no elevation, and Windows asks through a UAC dialog you can answer.

## v0.179.2 — the installer really does run on Windows now

- **`spawn C:\Program Files\nodejs\npm ENOENT`** — the same failure one layer deeper. Node ships three files called npm (`npm`, `npm.cmd`, `npm.ps1`) and PATH resolution tries the empty suffix first, returning the **extensionless Unix shell script** Windows cannot execute. Testing for `.cmd` never matched it.
- The rule is now stated positively: on Windows only a real `.exe`/`.com` is spawned directly; anything else is a shim to bypass. **Verified by running the exact argv on a real machine** rather than reasoning about it.

## v0.179.1 — the installer actually runs on Windows

- **`spawn npm ENOENT`.** The step passed the bare name `npm`, and `execFile` does not apply PATHEXT, so it missed `npm.cmd`. Resolving alone was not enough either — Node refuses to spawn `.cmd` without a shell (CVE-2024-27980), and a shell is not on the table. npm's shim is now bypassed in favour of the `npm-cli.js` it wraps, run with the `node.exe` beside it. Verified against a real `npm.cmd`.
- **The shown command is now derived from the argv** rather than written beside it: the hand-written version hid `--accept-package-agreements` and printed `sudo` where none was used. It is the consent list, so it cannot be a summary.

## v0.179.0 — AtlasMind can do the install, and the guide works with nothing configured

- **Setup guides did nothing in the AtlasMind chat panel.** Slash commands are dispatched only by the VS Code chat participant, so `/acp` went to the orchestrator as an ordinary prompt — and on a machine with no provider configured, to the built-in echo model, which replied "Answered from context." Setup plans are derived, not generated, so the guide now renders directly with **no model involved** and works on a fresh install with nothing set up.
- **AtlasMind can install the ACP adapter for you** — including the runtime you may not have. The modal lists every command with its purpose before anything runs.
- **The safety line:** every command is a constant in AtlasMind's source (never scraped, never model-generated), nothing goes through a shell, planning performs nothing, and Rust's `curl … | sh` installer is deliberately not used — where no distribution packages cargo, the plan says so and shows the manual instructions instead.

## v0.178.1 — the ACP card's buttons say and do what they mean

- **Choosing an agent looked like it only opened a website.** Not-installed is the expected first answer — AtlasMind never installs an agent — but it was reported as a dismissable toast whose one button opened a docs index. Both ACP entry points now share a modal handler that leads with the install command and offers the `/acp` walkthrough.
- **"Set API Key" → "Choose Agent."** ACP stores no key; it reuses the agent's own vendor login. A test now pins that no keyless provider advertises a key prompt, and that every key-based one still does.
- **Card copy no longer claims agents run with "no tools"** — true only until `atlasmind.acp.toolsEnabled` shipped.

## v0.178.0 — setting ACP up from the sidebar, with buttons that hit the right target

- **The action icons on an ACP row acted on the wrong provider.** The row carried the vendor it sits under in a property called `providerId`, and the tree identifies its command argument by shape — so the visibility toggle on "Anthropic — Claude subscription" flipped *Anthropic's API provider*, and configure prompted for an Anthropic API key. Renamed to `vendorId`, given its own context value, and both shape guards now also require a `model-` context value.
- **There is now a way to set ACP up from the sidebar.** Unfinished rows show a plug icon and act on click, taking whichever step is next: check the adapter, enable the provider, or refresh to discover the model.
- **"model disabled" no longer appears when no model exists.** A freshly configured Codex agent has no model row until discovery runs; that now reads "refresh to finish".

## v0.177.1 — dependency updates

- **`@modelcontextprotocol/sdk` 1.29.0 → 1.30.0** (security), plus `eslint` 10.8.0 and `@types/node` 26.1.2.
- **TypeScript stays on 6.x.** The same update group proposed 7.0.2; `@typescript-eslint/parser@8.65.0` peers on `typescript >=4.8.4 <6.1.0`, so 7.x breaks linting. Revisit when typescript-eslint supports it.

## v0.177.0 — an ACP row can no longer claim a route the router will not take

- **The Models sidebar was ticking a Claude subscription green on installs where no agent was configured.** It read a seeded placeholder model rather than your settings, and ignored whether the provider was switched on. It now reflects all four conditions routing actually requires, and names whichever one is missing.
- **Enabling ACP from "Use my Claude subscription" did not stick** — it was written to memory only, and the next refresh undid it.
- **Setup guides open in a new chat session**, auto-submitted, via a single `atlasmind.openSetupGuide` command, instead of dropping an unsent `/acp` into whatever conversation happened to be open.

## v0.176.0 — the subscription can act, one approval at a time

- **ACP agents can now run their own tools** (`atlasmind.acp.toolsEnabled`, off by default). The agent does the work in its own process; AtlasMind decides whether each operation may proceed. Delegated execution is never delegated authorization.
- **AtlasMind never accepts "always allow."** That grant would live inside the agent, where you could not find or revoke it — so AtlasMind answers "allow once" every time, and declines outright if permanent is the only option offered.
- **MCP servers holding your secrets are never forwarded.** Sharing a server launches it inside the agent's process; resolving SecretStorage credentials would copy a key you gave AtlasMind into another vendor's process as a side effect of ticking a box.
- **Fixed: ACP models could never be routed for vision** despite being able to receive images — the adapter sent image blocks but declared no `vision` capability, and the router excludes models missing a required one.
- **Each vendor's ACP route is its own row in the Models sidebar**, under that vendor's API entry, so it reads as "the other way to reach Claude" rather than an acronym.
- Permission and MCP wire shapes were read from the ACP **schema crate**, not the rendered docs, which truncate before those definitions — catching a double-nested `outcome` field and an untagged stdio variant that guessing would have got wrong.

## v0.175.0 — "use the subscription you already pay for"

- **The ACP offer moved to where people look for it**: a plain-language button on the Anthropic and OpenAI cards, not a separate entry named after a protocol.
- **Never heard of ACP? That is the point.** Not installed gets you the install command and the guide; signed out tells you which login; ready configures and enables it in one click.
- **Google is absent on purpose** — Gemini implements ACP but publishes no launch command, so that button could not work.

## v0.174.0 — settings that mean what they say

- **Three settings did nothing.** `atlasmind.remote.enabled` and the two Buzz autonomous-reply settings were declared, documented, and read by no code. Their descriptions now say so, and say what the real control is.
- **`remote.enabled` was the worrying one**: setting it `false` looked like switching remote control off, when the real gate is the command plus a workspace approval.
- **A new guard fails the build** if a setting is ever declared that nothing reads, or if a config key is read with a doubled prefix.

## v0.173.0 — ACP is something you can click

- **ACP appears in Model Providers.** Configure picks an agent, saves it, probes it, and tells you whether it is installed and signed in — rather than saving and hoping.
- **Allowed models is no longer a bare text box.** The models your enabled providers offer are one click away, with subscription-backed ones marked.
- **Claude CLI is documented as superseded by ACP** — not yet removed, because ACP still has to be proven against a real agent binary. The retirement sequence is written down.

## v0.172.0 — your project memory survives a version downgrade

- **Fixed silent data loss.** An older AtlasMind treated a newer file's format as "no file", seeded a default, and wrote it over your documents registry, risk register, security register, or people roster. It now tells corrupt apart from newer, leaves the newer one alone, and says why.
- **Added the migration mechanism** that lets a format change at all — the thing a 1.0 compatibility promise needs behind it.

## v0.171.1 — the dashboard renders again

- **Fixed "Dashboard refresh failed — directorBoundAgentId is not defined"**, which blanked the whole Project Dashboard for any project with a Buzz contact. A rename in v0.163.0 left one call site behind.
- **Added a guard** that parses every webview script and fails the build if it references an identifier that does not exist — the failure mode is a blank panel, and neither the compiler nor the unit tests could see it.

## v0.171.0 — every setup process works the same way

- **`/acp`** walks you through ACP setup a step at a time, ending with *prove a completion comes back* — configured and working are different things.
- **`/setup`** lists every guide and how far along it is, so a feature that needs configuring is discoverable before it fails on you.
- **The guides share their mechanics**, not just their look, so they cannot drift — and an allowlist now enforces that no guide can flip a switch for you.

## v0.170.0 — your subscription as routable capacity (ACP)

- **AtlasMind speaks the Agent Client Protocol.** Point it at an ACP agent you have installed (`claude-agent-acp`, `codex-acp`) and that vendor's subscription becomes another model the router can choose.
- **Everything the old Claude CLI bridge could not do**: replies stream, the ~26,000-character prompt ceiling is gone, and images are sent when the agent accepts them.
- **They answer, they do not act.** No filesystem, no terminal, no tools — and a permission request is refused rather than granted. Nothing is installed for you; nothing runs until you name a command.

## v0.169.0 — your issue tracker, inside the dashboard

- **A new Issues tab** reads the repository's GitHub issues: open, unassigned, and gone-quiet counts, charts by label and assignee, and a searchable list.
- **Deal with them in place**: comment, close, reopen, or open a new issue — each shown in full and confirmed before it is sent, because a tracker is public.
- **"Work on it with Atlas"** hands the issue to chat as a report to check, explicitly not as instructions.

## v0.168.0 — who did the work, and how far the release has to go

- **Three charts on the Overview**: commits by contributor, route to the selected release gate, and outstanding objectives by gate — from git history and the roadmap you already keep.
- **Click a contributor to filter the commit timeline** to that person; click again to clear. The filter only appears when there is more than one author.
- **Author names only**, never addresses, and the long tail of one-commit authors is merged into "Others (n)" rather than dropped.

## v0.167.0 — answer with one tap, everywhere

- **Quick-reply pills reach the Ideation and Vision panels.** They were a Chat-panel-only affordance, which made them look like a property of that panel instead of of Atlas asking a question.
- **Still pills only.** A question with no clean options gets the text box, not invented buttons — the same behaviour chat has always had.

## v0.166.0 — the roadmap plans more than one release

- **Release gates beyond MVP.** Declare a public beta, a v1.0, a v2 — and switch the "Road to…" card between them. Each gate gets its own progress, milestone track, best route, and plan-with-Atlas prompt, and an item can sit on more than one.
- **Stored where the backlog is.** Gates are readable markdown in `improvement-plan.md`, so they diff and review like everything else in project memory.
- **Removing a gate removes a label.** The tag comes off every item; no backlog item is deleted, and MVP cannot be removed.

## v0.165.0 — what each testing policy has to show for itself

- **A card per enabled policy** on the Testing tab: tested, tooling-only, or nothing found — plus case counts, skipped counts, failing tests, and a per-policy action to write or fix them.
- **Practices are labelled, not flagged.** Exploratory, black-box, V-model and friends leave no files behind, so they are never counted as missing tests.
- **No report means no verdict.** Failures are read only from a report your project wrote; with none, the page says so and shows the command to produce one instead of a "0 failing" nothing measured. It never runs your tests for you.

## v0.164.0 — a shelf creates its folder

- **Documents → add a shelf, get the folder.** Saving a shelf now creates the folder it names, so a filing system can be designed before the files exist. Shelves still pointing at a missing folder get a **Create folder** button.
- **Create-only.** An existing folder is left alone, a file sitting at the shelf path is reported rather than touched, an unsafe path is refused, and every folder created is named in a notification.

## v0.160.1 — the buttons the guide kept promising

- **"Press the button below" — there was no button.** The walkthrough's wording was written for VS Code chat, where buttons render, and shown in the AtlasMind panel, where nothing did. Each step's actions now appear as buttons there: open the relevant screen, set the agent key, or load a command into a terminal.
- **The opening line no longer reads as though the guide lost its place.** Starting at "step 2 of 4" looks like something was skipped, when in fact step 1 was already finished. It now leads with progress — "1 of 4 done. Next: …" — and only says "step 1 of 4" when nothing is done yet.
- **A key already given to the Buzz MCP bridge is now recognised.** The bridge stores it under its own secret and inbound reads a different one, so the guide could correctly report "no key" to someone who had already supplied it. It now spots that and offers **Reuse the key from the Buzz bridge**.
- **A guide button names an option id, never a command.** The mapping from option to command is held extension-side and looked up, so a webview message cannot choose what runs.
- **Reusing the bridge key is checked, not trusted.** The secret id must match the Buzz bridge's exact naming, the key is validated by constructing a signer before it is stored, and neither the key nor any part of it is ever displayed or logged.

## v0.160.0 — Settings → MCP Servers

- **Every registered server in one list** with its transport, live connection status, tool count, and any error — plus Enable, Connect and Disconnect for each. Previously the only way to see whether a server was actually connected was to open a separate panel.
- **Disabling a server now disconnects it**, rather than only relabelling it. A gate that reports itself closed while its tools remain reachable is worse than no gate.
- **The page shows what is running, not what was configured** — status and tool counts are read live from the registry each time it renders.
- **Adding and editing a server stays in the dedicated MCP manager.** Browse-by-category, transport setup, and secret entry are deliberately not duplicated here; two implementations of one flow drift, and the one that drifts is the one nobody is looking at.
- **Each new message is validated at the runtime allowlist**, not only in the type union — these messages start and stop processes that contribute callable tools. This is the same guard a previous page skipped, which left every control on it silently inert.

## v0.159.1 — the guide stops skipping the question it cannot answer

- **The setup guide opened in whatever thread happened to be in front of you.** It now gets its own **Buzz setup** session, so a walkthrough no longer lands in the middle of unrelated work under a title about something else.
- **The guide skipped straight to step 3.** Steps 1 and 2 read as finished because Buzz was enabled and the default `ws://localhost:3000` parses — but nothing had ever connected, so whether a relay existed was unknown and the guide walked past the question entirely. Until you say how you run Buzz (or a subscription actually connects), the relay step is unfinished and the guide stops there to ask.
- **Real chips in AtlasMind's own panel.** "How do you want to run Buzz?" is answered by clicking **I will run Buzz on this machine** or **I have a relay URL from someone else**, and the guide reprints with only that path.
- **Each step shows the whole sequence with its position marked**, so arriving at step 3 says why.
- **Chips appear only where there is a genuine question.** The relay path is the one thing AtlasMind cannot work out for itself; everywhere else a chip would be a button meaning "I have read this".

## v0.159.0 — `/buzz` walks you through it one step at a time

- **One step, not a wall.** `/buzz` shows only the step you are on — numbered, with the exact commands written out — instead of the whole checklist. `/buzz all` still shows everything.
- **Commands can be put straight into a terminal for you.** A button loads the command into a "Buzz setup" terminal, typed but **not run** — pressing Enter stays yours, since these clone repositories and start containers.
- **The guide asks how you run Buzz and then shows only that path.** `/buzz local` gives the Docker route with real commands; `/buzz hosted` says there is nothing to install and what to paste where. Stored as `atlasmind.buzz.relayMode`, which changes guidance only.
- **The Buzz desktop app is now part of the guide.** It was missing entirely, which left the walkthrough describing a workspace with no way in — and the channel ids the later steps ask for come from the app.
- **"Guide me through Buzz setup" now opens AtlasMind's own chat panel**, not VS Code's. Routing through `workbench.action.chat.open` put a Buzz question in front of Copilot's participant picker, and — because a slash command in a pre-filled query arrives as text — straight into the general agent.
- **The local-relay path is spoon-fed:** check Docker, clone the repo, build and start, then confirm something is listening with `docker ps`. Previously it said "normally means Docker", which is not something a first-timer can act on.
- **Only commands AtlasMind wrote can be loaded into a terminal.** `BUZZ_SETUP_COMMANDS` is an allowlist checked at the command handler, because a command id is reachable from a webview and its payload cannot be assumed to be ours. Commands quoted from Buzz's documentation are shown for copying and are never wired to a button — they are somebody else's text.

## v0.158.1 — every green build is installable

- **CI uploads a packaged `.vsix` for the exact commit it built** (14-day retention), so a branch can be installed into a real editor by downloading it from the run rather than being handed a file.
- **CI can be triggered by hand** (`workflow_dispatch`), so a feature branch gets a build without opening a pull request to provoke one.
- **`docs/development.md` now says what running a branch actually needs.** F5 builds from source and needs no packaged build at all — but it does need `npm install` after pulling a branch that changed dependencies, which is the step that silently breaks a launch when skipped.

## v0.158.0 — a waiting approval says so

- **A blocked run no longer looks like a hung one.** When a tool approval needs an answer and the AtlasMind chat panel is off screen, the panel is brought forward and a notification names the action that is waiting. Previously the only reaction was repainting a webview you may not have been looking at.
- **`atlasmind.chat.revealOnApprovalRequest`** (default on) controls whether the panel takes focus. The notification is shown either way, so turning it off stops the interruption without leaving you unaware.
- **Nothing is announced while the panel is already visible.** Interrupting someone toward something already in front of them is how prompts get trained into reflex dismissal.
- **Only newly-arrived requests announce.** The pending list also changes when a request is *answered*, so announcing on every change would have fired a notification each time you approved something.
- **The notification names the action** ("Run `npm test` in the workspace"), since a message that does not say what it is about gives no reason to switch to it.

## v0.157.1 — a slash command that arrives as text

- **"Guide me through Buzz setup" sent your question to the general agent instead of showing the checklist.** The button opens chat with a pre-filled `@atlas /buzz` query, and VS Code hands that to the participant as prompt *text* rather than as a command. The chip renders identically either way, so nothing looked wrong.
- **A deterministic command can no longer widen its own tool surface by falling through.** The point of `/buzz` being model-free is that a Buzz question never needs an agent, let alone one holding every connected MCP tool — and the silent fall-through granted exactly that, which is how an unrelated third-party tool got reached for. A slash command arriving as text is now recovered and routed to its own handler.
- **Tests pin the shape**: every command the manifest declares has a handler, the known-command list matches the manifest, and dispatch reads the recovered prompt rather than the raw one.

## v0.157.0 — DM a contact, and let two agents talk

- **`/buzz dm <name> <message>`** resolves the person from your Director roster and sends to the Buzz key on their card — the person you added once is the person you can message.
- **Autonomous agent-to-agent replies** (`atlasmind.buzz.autonomousReplies`, off by default). With it armed, an AtlasMind agent can hold a back-and-forth with a Buzz agent without a dialog per message, which is the point of putting them in the same workspace.
- **"AtlasMind drafted it" no longer means "always ask".** It means "ask, unless you have explicitly armed autonomy *and* the recipient is one you declared to be an agent *and* the rate cap has not been reached." Requiring a human click per message made an agent loop impossible; removing the gate entirely would have removed something real.
- **Autonomy is scoped to agents you declared**, never to agents AtlasMind inferred — only to recipients in `atlasmind.buzz.agentBindings`, and creating that binding is already a deliberate act naming both the identity and the agent. An unbound recipient is treated as a person and still gets a confirmation.
- **It is rate-bounded per recipient** (`atlasmind.buzz.autonomousReplyLimitPerHour`, default 10), and at the cap the next message **falls back to a dialog rather than being dropped** — a silently-discarded reply looks identical to a working loop. An autonomous send never becomes a standing grant.
- **The residual risk is stated rather than hidden:** inbound Buzz messages are untrusted input, so an agent that reads one and replies autonomously gives its author partial influence over what AtlasMind then says to others.
- **An ambiguous name is refused, not guessed**, and a contact whose handle is a channel UUID rather than a public key cannot be DM'd — picking the wrong colleague is not recoverable.

## v0.156.0 — read and reply to Buzz from chat

- **`/buzz read`** shows the recent conversation with authors resolved to their published names; **`/buzz send <message>`** posts back through the guarded bridge.
- **Emoji work in both directions.** Reactions arriving from Buzz attach to the message they target and aggregate with counts, and emoji you type are sent exactly as written.
- **Confirmation now fires where it adds something, instead of on every send.** A message *you* wrote, aimed at a channel *you* chose, to a recipient you have already messaged this session, sends without a dialog — you confirmed it by typing it and pressing send. Everything else still confirms: anything AtlasMind drafted, any recipient AtlasMind picked, and the first message to any recipient in a session. Dialogs that add nothing train people to dismiss the ones that matter.
- **AtlasMind refuses to guess which channel to post to.** With more than one configured, `/buzz send` stops rather than choosing — sending to the wrong channel cannot be undone.
- **Conversations are held in memory for the session and never written to disk.** "Derive, don't mirror" governs what is *stored* in git-tracked `project_memory/`; it was never a rule against looking at a message.
- **A secret in an outgoing message is a refusal, not a redaction** — quietly sending a redacted version would leave you believing you had sent one thing while your colleagues read another.
- **Emoji are handled as a correctness problem.** Truncation walks whole code points and backs off trailing joiners, variation selectors, and skin-tone modifiers, so a trimmed message never ends in a broken glyph. Reactions compare on the full published sequence, so 👍 and 👍🏽 stay distinct — different reactions by different people.

## v0.155.0 — the setup guide reads Buzz's own docs

- **Live documentation instead of stale prose.** `/buzz` quotes the current Buzz README for the steps outside AtlasMind — relay, CLI, agent key — with a source link and how recently it was read.
- **Split by consequence.** Your configuration is still *checked* deterministically; only claims about Buzz are fetched. A model guessing at your setup is strictly worse than a check.
- **Quoted, never executed.** Fetched docs are untrusted text: commands are attributed suggestions AtlasMind will not run, prose is redacted and control-stripped, and markdown links are flattened so a label cannot misrepresent where it points. The origin is pinned to the Buzz repo.
- **Offline still works** — it falls back to built-in guidance rather than breaking.

## v0.163.0 — one person, several channels; one identity, several agents

- **Several communication channels per person.** Email *and* Slack *and* Buzz, rather than the one the editor used to allow. The first is preferred; the rest are added and removed without losing the rest of the form.
- **Several AtlasMind agents per Buzz identity.** A checklist, not a single choice — the first ticked owns the work, the rest are recorded as also-relevant.
- **Identities you can recognise.** Each option shows what that identity last said, how much it has said, and when. Most Buzz identities publish no name, and a truncated key identifies nobody.
- **The desktop app has a home in the walkthrough** — the "prove a message arrives" step, the one that actually needs it, with the download link and the shared-relay warning.

## v0.162.0 — fetch your Buzz channels instead of copying ids

- **A "Fetch my channels" button** on Settings → Buzz asks the Buzz CLI which channels your key can see and offers them as a ticklist, pre-ticked with what you already watch.
- **Why it matters:** a channel id that does not match the channel you posted in is the usual reason a working subscription receives nothing, and it is indistinguishable from a wrong relay or a quiet day.
- **Nothing is written unless you tick and confirm.** It touches the channel list only — never a gate, never a key — and runs under the same validated relay/key configuration as the MCP bridge.
- **The CLI's output is untrusted:** ids are constrained to an identifier charset, names are redacted and clamped, the list is capped, and unreadable entries are counted rather than hidden.
- **A watched channel the relay did not list is kept**, since an invisible channel is far more likely a permissions gap than a deliberate removal.

## v0.161.0 — the Buzz walkthrough finishes the job

- **Prove it works.** A new step asks for one real message and checks it arrived, because "subscribed" is where a wrong channel id, a wrong relay, and a quiet day all look identical. It names both usual causes.
- **Get your first agent** turned out to need no getting: the key stored two steps earlier already *is* a Buzz identity. The guide now says so instead of implying there is something to obtain.
- **Put the Buzz people in the Director roster.** Walks the real form so inbound work reaches a specialist rather than arriving unassigned. Offers identities actually observed on the relay; asks for an `npub…` when there are none.
- **Neither is treated as a fault.** Reading Buzz is still tracked separately and never reported as a gap, and while only these two remain the guide says the connection itself is already working.

## v0.154.0 — a Buzz handle is not always a public key

- **Saving a Buzz contact with a channel-UUID handle no longer warns that something failed**, and a refused binding now says the person *was* saved.
- **"Guide me through Buzz setup"** button added to Settings → Buzz.
- **A valid relay URL is no longer proof a relay exists** — the default `localhost` reads as settled while nothing may be listening.

## v0.153.0 — `/buzz` sets Buzz up with you

- **A guided walkthrough in chat.** `@atlas /buzz` reports each setup step as done / to do / blocked / optional from your real configuration, names the next thing to click, and offers a button for it.
- **The Buzz CLI is now detected**, so a missing binary surfaces during setup rather than as a failed send later.
- **A plan, never an installer.** Every button opens a surface; nothing enables a gate, writes a setting, or stores a secret. Each Buzz gate is off by default so that turning it on stays your decision — an assistant that flipped them to be helpful would remove the point of them.
- **Derived, not generated** — a hallucinated setup step sends you to configure something that does not exist.
- **Required vs. extra is respected.** Reading Buzz needs four things; the CLI, the bridge, and follow-up persistence are extras, and a step blocked only by an optional one is never nominated as your next action.

## v0.152.0 — Pick a Buzz handle instead of pasting one

- **The person form offers identities AtlasMind has seen**, by the name each published for itself; picking one fills Handle. Typing a key by hand still works.
- **Your own identity is derived** from the agent key already in secure storage — the one handle that never needed a lookup.
- **Names come from the relay** (NIP-01 kind 0), **verified against a live relay before anything depended on it** — it is absent from Buzz's own registry, the same shape of question that produced the kind-9 mistake.
- **No key is ever derived from a person.** A fabricated key would belong to somebody else, so every option is evidence: a key seen on the wire, a name its owner published. Unnamed identities say so.
- **The roster is never persisted** — who spoke and when is not something git-tracked memory should accumulate.

## v0.151.0 — Buzz becomes clickable

- **Settings → Buzz.** A new page surfaces every `atlasmind.buzz.*` switch — Connection (enable, relay URL, allow remote), Inbound (subscribe, channels), Persistence (record follow-ups), Routing (bindings) — previously reachable only by hand-editing settings JSON.
- **Bind an agent while adding the person.** On **Dashboard → Director**, give a contact the `buzz` channel and the Add / Edit person form reveals an **AtlasMind agent** picker. Bound people show a `buzz → <agent>` badge on their card.
- **The nested gates look nested.** A switch whose parent is off renders dimmed and disabled, while still showing the value that is stored — hiding a stored `true` would misreport the configuration.
- **One set of rules for clicks and hand-edits.** Both surfaces write through the same pure helper, so a mistyped `npub` is refused with a reason rather than bound to a different identity, an `nsec` is refused by name, a binding to a non-existent agent is rejected, other bindings are left untouched, and the setting keeps whichever shape you already wrote.
- **`atlasmind.buzz.agentBindings` stays the single source of truth** — the roster is a convenience editor for it, not a second store, so the two can never disagree.

## v0.150.0 — Buzz inbound switched on + agent bindings (Tier 3)

- **Inbound is wired and usable.** `atlasmind.buzz.inboundEnabled` (plus `buzz.enabled`) holds a live read-only subscription that authenticates, survives drops, and turns channel activity into work items. `inboundChannels` scopes it.
- **Assign AtlasMind agents to Buzz agents.** `atlasmind.buzz.agentBindings` maps a Buzz identity (`npub…` or hex) to an AtlasMind agent id, so inbound work lands with the right specialist rather than unattributed.
- **New command:** `AtlasMind: Set Buzz Agent Key`.
- **Three gates, all off by default.** Enabling, subscribing, and *recording* are separate opt-ins — project memory is git-tracked, so writes from a network event are never inherited from an upgrade.
- **A mistyped identity can't misroute work.** Binding keys are checksum-validated; an `nsec` is refused; unusable bindings are reported, not dropped; unbound identities stay unassigned.

## v0.149.2 — Buzz inbound listened on the wrong kind

- **A live relay corrected a wrong assumption.** Buzz's registry defines two channel-message kinds and reads as though the newer supersedes the older; the relay stores only the older one. Subscribing to the newer alone authenticates, subscribes, and receives nothing forever — a failure that looks perfectly healthy.
- **Both kinds are now handled**, so either deployment works. The channel-scoping tag and the channel-metadata kind were confirmed correct by the same query.

## v0.149.0 — Buzz NIP-42 signing + hosted-relay TLS (Tier 3)

- **Inbound can authenticate.** BIP-340 Schnorr signing fills the seam `BuzzClient` left open. A real relay refuses to serve a subscription until the client authenticates, so this is what makes inbound possible at all.
- **A small dependency, loaded only when used.** `@noble/secp256k1` — 170 KB, zero dependencies of its own, picked over the 1.87 MB `@noble/curves` suite for the one curve Nostr uses. Imported on first signature, so non-Buzz users pay nothing at activation.
- **Hosted relays must be encrypted.** A Buzz workspace need not be local; an unencrypted socket to a remote relay is now refused, matching the outbound rule. Loopback is exempt.
- **A mistyped key fails loudly.** `nsec` bech32 checksums are verified and an `npub` is rejected by name, so a bad key can never silently sign as a different identity. Secrets never reach a log or error.
- **Verified against the spec.** The bech32 decoder and signing library are cross-validated against the canonical NIP-19 key-pair vectors.

## v0.148.0 — Buzz inbound subscription (Tier 3)

- **AtlasMind can hold a live Buzz relay subscription.** Connect → authenticate → subscribe → receive, and on a drop, back off and resume from where it left off.
- **No new dependency.** `ws` was already bundled. The relay URL is accepted as either the CLI-style `http(s)` base or `ws(s)`, so one setting serves both the outbound bridge and the inbound socket.
- **Read-only by construction.** The subscription sends only subscribe/close/authenticate/keep-alive frames — never an event — so it cannot write to Buzz. Asserted in tests.
- **Tested against a real WebSocket server.** 26 deterministic unit tests plus 9 integration tests covering a genuine handshake, real ping/pong, a real NIP-42 exchange, and a hard TCP drop the client recovers from unaided.
- **Two pieces remain** before inbound is switched on: Schnorr signing for authenticating relays, and validation against a real Buzz instance.

## v0.147.0 — Buzz inbound foundation (Tier 3)

- **Verified Nostr protocol layer.** Buzz's transport is a published open spec (NIP-01 framing, NIP-42 auth), so this was built and fully tested without a live relay. Buzz's own event kinds come from its registry at the same pinned tag as the CLI bridge — including the traps: channel metadata is 39000 (not 41) and a channel message is 40002 (not 9 or 10002), both asserted in tests because the wrong one connects fine and receives nothing.
- **Connection presence, the half a wake lock can't provide.** Keep-alive/liveness detection, capped backoff reconnect with jitter, and a resume plan that re-subscribes filters and re-announces presence — a fresh socket keeps no prior state, so reconnecting alone leaves an agent silently absent.
- **Derive, don't mirror.** Inbound activity becomes a follow-up with a **pointer back to the Buzz thread**, never the message body. Project memory is git-tracked, so mirroring a channel would commit colleagues' chat into your repo.
- **Relay data is untrusted.** Frame parsing never throws; malformed events are dropped rather than coerced; client-side structural validity is explicitly not treated as authenticity. A "restricted" key refusal stops reconnecting instead of hammering the relay.
- **Not yet live.** The WebSocket itself is not connected — that needs validation against a running Buzz relay.

## v0.146.0 — Buzz live communications (Tier 1b)

- **Project Director can post to Buzz.** A bundled communication-only MCP bridge wraps the pinned official Buzz CLI v0.4.26 for channel posts, bounded thread reads, and DMs.
- **Buzz stays in its lane.** The connector exposes no Buzz shell, file-edit, workflow, repository, or administrative tools; AtlasMind keeps reasoning and execution in its own toolchain.
- **Secrets and relay policy fail closed.** Agent keys and optional authorization tags stay in SecretStorage, message bodies go through stdin, remote relays require explicit consent plus TLS, and the bridge refuses a CLI that does not match the pinned v0.4.26 communication contract.
- **Connectors cannot cross wires.** Director routing now matches the contact's channel kind and distinguishes Buzz channels from Buzz DMs, preventing a Buzz recipient from being sent through Slack or Teams.

## v0.145.7 — Workspace-memory package boundary

- **Local memory archives stay local.** Git ignores `project_memory_old/`, and the checked-in package boundary excludes every `project_memory*` directory, including backup variants discovered during release verification.

## v0.145.6 — Tool-capable project handoff and recoverable limits

- **Planning and execution stay separate.** A reasoning-only model may create the plan, but non-synthesis subtasks receive enabled workspace-evidence skills and route to a model that can actually call them.
- **Tool-unavailable refusals trigger handoff.** AtlasMind reroutes an executor that reports disabled tools and records an unrecovered refusal as failed rather than completed.
- **Limit recovery is clickable and correctly scoped.** Chat asks whether to use the suggested limit once, save it permanently, or keep the partial result. A one-run increase restores the previous value after the retry.
- **Project transcripts stay singular.** Custom-panel project runs no longer append a duplicate user/assistant pair after their streamed run bubble.

## v0.145.5 — Reliable model refresh and run handoffs

- **Removed provider models stay removed.** Successful empty discovery prunes stale entries, and provider-confirmed missing/deprecated models retain a session tombstone across refreshes.
- **Project-run proposals are decisions, not dead ends.** Interactive chat offers **Start run**, **Save for later**, and **Cancel**; saving creates a Project Run Center preview, while enabled Autopilot can still start immediately.
- **Local savings are visible in the Efficiency summary.** The headline estimate and detailed per-model comparison share the same local-only usage calculation.

## v0.145.4 — Security review register foundation

- **Security reviews now have durable, consistent records.** A new `SecurityReviewManager` persists findings and runs for secrets, runtime boundaries, dependencies, and permissions to JSON, a readable Markdown mirror, and capped audit history.
- **Review scoring reflects uncertainty.** Severity, exploitability, confidence, coverage, and 45-day freshness contribute to the score, so an unreviewed area cannot count as assurance.
- **The data boundary is defensive.** Malformed model output records no findings, values are bounded, unresolved findings default to open, and cited paths cannot escape the workspace. This is a persistence foundation, not an automated scanner, dashboard feature, or release gate.

## v0.145.3 — Visible model choice and local savings

- **README release highlights are cumulative from the last Marketplace publication (v0.145.0)** rather than presenting only the latest source patch; they also cover the security-review data foundation and guarded-commit timeout fix from v0.145.1–v0.145.2.
- **The composer status names the model serving the active request**, including routing failovers, while progress remains visible above the chat input.
- **Local-model savings are now model-specific and totalled.** The Cost Dashboard compares each locally-hosted model's token usage with an explainable catalog-backed cloud reference and excludes free cloud traffic.
- **The time-period selector is compact and collapsible.** Its menu expands a toolbar above the chart instead of permanently occupying the plot or covering line-chart peaks.

## v0.145.2 — Git commit hook timeout fix

- **Repository pre-commit hooks can finish before AtlasMind decides the commit failed.** The dedicated `git-commit` skill now gives the Git subprocess 120 seconds and its orchestration wrapper 125 seconds instead of inheriting the generic 15-second tool timeout. The five-second grace lets a process-level timeout return cleanly before the outer deadline. Commit messages remain typed argument values, so spaces are never re-parsed as paths.
- **README release verification follows the manifest version** instead of hard-coding one release heading, removing a recurring version-bump failure.

## v0.145.1 — Security review types

- Added the shared security review types used by the security review manager and its audit history.

## v0.145.0 — Agent management that is easy to find and use

- **Settings now has an Agents page.** It appears under Capabilities, reports registered/enabled/built-in/custom counts, and opens the dedicated manager through a validated command bridge. The Settings overview carries the same shortcut.
- **The global immutable guardrails are visible on the Agents page.** The selectable read-only block comes directly from the runtime constant, includes provenance, and makes the policy applied to every routed agent inspectable.
- **Personality Profile is easier to find.** Direct links now appear on both Settings Overview and Models & Integrations, reflecting that profile preferences influence every routed model interaction.
- **Settings uses one canonical page registry for host and webview navigation.** The Agents destination is recognized in debug and packaged builds instead of falling back to Overview.
- **The README is now a product pitch, not an implementation inventory.** It leads with outcomes, workflow, trust, and a plain-language **What's new** section, while detailed architecture, agent, skill, configuration, and service material stays in the docs. Competitor comparison matrices and the wiki comparison page have been removed.
- **Agent Manager is now one master/detail workspace.** Search and enabled/custom/built-in filters stay beside the selected definition, while Identity, Instructions & completion, Skills, Models & budget, Testing, and Maintenance are grouped with progressive disclosure. The old Overview / Directory / empty Editor tabs and duplicated global cadence are gone.
- **Custom agents can define their completion policy in the UI.** Up to 12 observable rubric rows and 12 bounded incomplete-result patterns can be saved; built-in criteria remain inspectable and factory-defined.
- **Every Agent Manager action now validates its payload at the extension-host boundary** before registry or configuration state changes.

## v0.144.0 — Concise role prompts and on-demand specialist guidance

- **All 16 user-facing built-in specialists now append measurable role-specific completion criteria** to the shared execution rubric, so debugging, review, security, GitHub, testing, documentation, performance, DevOps, dependency, oversight, SEO, and UX work each have observable evidence and verification requirements.
- **SEO and UX no longer carry encyclopedic permanent prompts.** A new read-only `specialist-guidance` skill loads one focused checklist only when relevant and requires current primary-source verification for time-sensitive search-platform, crawler, markup, performance, accessibility, and UI-platform rules.
- **GitHub and default-agent policy handling is portable.** Both discover the active repository's instruction, branch, documentation, and release rules; GitHub artifacts are derived from the actual diff, and one-off confirmations are no longer silently persisted as durable policy.

## v0.143.0 — One execution contract, evidence-based rubrics, and meaningful outcome learning

- **Every routed agent now receives the same portable operating contract and six-part execution rubric at runtime.** That includes the hand-written specialists that previously received only immutable guardrails, plus custom, ephemeral, synthesized, and persisted-override agents. The rubric requires task fit, workspace evidence, completion, proportionate verification, safe tool use, and an honest handoff; agent definitions can append observable specialist criteria.
- **Completion gates and Mission evaluation now use those criteria.** Agent-specific incomplete-response patterns trigger one finish-or-declare-blockers retry with bounded safe-regex handling, while GoalEvaluator explicitly assesses goal, success criteria, evidence, verification, and completeness and cannot accept `achieved` while listing remaining work.
- **The router's outcome signal is no longer effectively constant.** It now grades actual tool successes/failures, whether an action turn used the available tools, verification, TDD evidence, incomplete delivery, and the final recovered response. Model Comparison keeps its separate coarse completion-integrity grade and optional answer-quality judge.
- **Built-in agents are genuinely excluded from AI auto-update.** The cadence guard now enforces the promise already made by Settings and documentation, and Agent Manager renders the built-in exclusion as locked.

## v0.142.0 — Dark-mode legibility, and a score that counts what you have not done

- **The black text in dark mode is fixed.** Card titles, metric values and section headings rendered black-on-black across four dashboards. The cause was a *missing* declaration rather than a wrong one: scoping the shared shell's button paint to unclassed buttons in v0.141.0 also removed `color` from every classed button, and a `<button>` with no author colour falls back to the browser's own `buttontext` keyword — black, whatever the VS Code theme says. Every review that looked for a bad colour was looking for something that was not there. The shell now sets `color: inherit` on all buttons, and pairs colour with background on text-entry controls against the same hazard.
- **Risk and Data privacy now count toward the operational score whether or not you have engaged with them.** Risk used to be omitted from the score until an advisor had run — which meant a project that had never been assessed scored *identically* to one assessed and found clean. Both categories are now always present and score zero until addressed (Risk 15 pts, Data privacy 12 pts), each naming the unclaimed points and how to claim them. Existing projects will see the headline number fall until the advisors are run and the privacy gate is configured; that drop is the signal, not a bug.
- **Hero badge chevrons render properly again** on Model Providers and MCP, where the glyph had been corrupted into a control character and shown as tofu.

## v0.141.0 — The Project Dashboard, rebuilt around how a manager reads it

- **The 14 tabs are grouped and reordered.** The old order was archaeological — it recorded the sequence features shipped, not any reading order. Gap Analysis sat eight tabs from the Overview card that advertises it, Roadmap was buried behind four engineer-facing pages, Risk was read *after* Delivery ("should we ship" after "can we ship"), and Delivery split the three safety pages down the middle. The tabs are now five labelled clusters — **Where we stand** (Overview · Score · Gap Analysis), **The work** (Roadmap · Director · Runtime), **The code** (Repo · Testing), **Is it safe** (Security · Privacy · Risk), **Ship & record** (Delivery · Documents · SSOT) — each wrapping as a unit so a group is never split across rows. The toolbar is sticky, so switching tabs from the bottom of a long page no longer means scrolling back up.
- **The Ideation whiteboard is now the first thing you see.** It used to sit below an explainer panel, a four-step workflow guide and a full-height composer — roughly three screens before the board itself. The board leads, the composer follows it, and the workflow guide is tucked away at the bottom, opening on its own only while the board is still empty.
- **The Cost Dashboard leads with your budget.** “Am I about to be blocked?” used to be answered by a bar buried inside the Daily Spend card, behind ten equal-looking tiles. It is now the first thing on the page, full width, tinted as you approach the limit, with live in-flight spend beneath it. The tiles are grouped into Spend / Efficiency / Volume, and the two that just repeated the budget bar are gone.
- **Panel sections are ordered the way you use them.** Settings is regrouped into labelled clusters — Capabilities, Interaction, Guardrails, Autonomy, Advanced — so Resource Discovery finally sits beside Models & Integrations instead of four pages away. The Personality Profile keeps its three constraint sections together rather than scattered across positions 4, 9 and 10. MCP opens on your server list instead of a summary of it. Specialist Integrations stops showing the same eight cards on three of its four tabs. And Website Studio’s numbered steps 3 and 4 were the wrong way round — you cannot design each page consistently before the shared UI system exists.
- **Seven panels can now be used with a keyboard.** Voice, Vision, Specialist Integrations, Tool Webhooks, Model Providers, Agent Manager and MCP all told assistive tech they had a tab list, then shipped plain buttons instead — so a screen reader announced nothing useful, and reaching the last tab took one Tab press per tab. All seven now share one implementation with arrow-key navigation, Home/End, and proper tab semantics. Their appearance is unchanged. Settings was already doing this correctly and was left as it is.
- **Buttons across the extension were telling you the opposite of the truth.** A single rule in the shared page shell out-ranked every panel’s own button styling, so chat’s toggles rendered *louder when off than when on*, and a destructive “Remove” button became the loudest control on the Resource Discovery page simply because nobody had styled it. Fixed at the source, with nine button styles that had been silently borrowing that fill now defining their own.
- **Three panels had controls that did nothing.** The Skill Scanner panel did not work at all — two independent faults, either fatal on its own. The Tool Webhook “Set / Update Token” button used a browser dialog VS Code webviews do not support, so no token was ever collected. And the MCP setup wizard’s prerequisite check told you a runtime was missing while leaving Connect fully enabled.
- **“Reset all built-ins” also deleted every custom scanner rule you had written** — an unannounced side effect of a button that named only the built-ins. It now resets what it says, keeps your rules, and asks first.
- **Smaller fixes across the panels.** Personality Profile controls that worked exactly once; Agent Manager rows that invited a click and ignored it; a Specialist Integrations filter you could switch on but never off; Website Studio showing pre-save values after every save; Vision file links that missed when you clicked the filename itself; and Mission Control rendering its recommended choice identically to every other option.
- **The Overview page stops being a menu.** The twelve large shortcut buttons at the foot of the page all led somewhere you could already reach — a tab, the score ring above them, a card on the same page, or the sidebar. They are replaced by the top three recommended next actions, drawn from the same analysis the Score page shows, so the landing page ends with “what to do next” rather than “where to go”. Cards also now say where they lead: several used to be labelled “runtime” while opening a completely different panel.
- **Tabs now tell you which page needs you.** Every count was already in the same snapshot, but none of it reached the nav, so finding the red page meant opening all fourteen. Tabs carry badges for open gaps (red when any are P1), open risk findings, overdue follow-ups, stale or missing documents, blocked memory entries, unhealthy providers, artifacts needing attention, and pending file changes.
- **Every animated metric in the dashboard was, in fact, frozen.** The dashboard rebuilds its whole body on each refresh, and a CSS transition cannot animate a node that was created a moment ago — so the score ring, the metric meters and the MVP progress bar had never once moved. Meanwhile the one animation that *did* work replayed 90 chart bars every time anything unrelated changed, including each keystroke in the Testing search box. Both are fixed: values now animate when they actually change, meters grow in the first time you open their tab, and nothing flickers on an unrelated refresh. `prefers-reduced-motion` is honoured throughout.
- **New visuals on every page.** Change-shape and upstream-divergence bars on Repo; TDD evidence and token-split on Runtime; a test pyramid and coverage meter on Testing; severity mix on Gap Analysis; completion and focus mix on Roadmap; governance completeness on Security; documentation freshness on Documents; entry health on SSOT; per-provider trust meters on Privacy; artifact coverage by lifecycle phase on Delivery. Charts now headline their period total and the change against the previous window, and draw a mean line — so a bar chart tells you direction, not just shape.
- **A stakeholder influence/interest grid on the Director page.** The data model was designed for it — influence and interest have been stored all along — but they were only ever shown as a text tag on each contact card. The grid names the standard strategy for each cell: manage closely, keep satisfied, keep informed, monitor.
- **A release strip on the Delivery page.** Promotion history was eight text rows, so success rate and shipping cadence were invisible. One tick per promotion, oldest left, rollbacks notched so they read without relying on colour, with a green-rate headline.
- **Nothing dead looks clickable any more.** Roughly fifteen inert cards across Repo, Roadmap, Testing, Gap Analysis and Documents showed a hand cursor because a blanket CSS rule quietly overrode the deliberately scoped one above it. Two buttons genuinely did nothing when clicked — the Director page's run titles and its "Manage MCP servers" button — because both carried a message name where an action name belonged. Cards that *are* clickable now show a chevron at rest, so you can tell before you click rather than after.
- **Commit velocity and SSOT cadence moved to the pages that own them.** Both series were already collected for 90 days but only ever drawn on Overview. The 7D/30D/90D range picker moved too — it now sits directly above the charts it filters, on the five pages that use it, instead of sitting inert on 11 of 14 tabs. It also no longer shares the tabs’ shape and colour: in a narrow panel it used to wrap underneath the nav and read as another row of tabs, so it is now a compact joined segmented control that is visibly a filter rather than a section.
- **Keyboard and screen-reader support for the nav.** Full ARIA tab semantics, arrow-key navigation with Home/End, and a visible focus ring — reaching the fourteenth tab used to take fourteen Tab presses. The dashboard also no longer re-announces all fourteen pages to a screen reader on every keystroke.
- **A layout bug that had disabled the narrow-width breakpoint entirely.** Two stray selectors above the media query made CSS discard the whole block, so dashboard cards stayed three-across in a narrow side panel, and a stray rule that trailed it pinned the Score page's outcome grid to one column at every width.

---

## v0.140.1 — Privacy routing no longer fires on ordinary code

- **Non-PII work was being classified as regulated data.** The Data Privacy detectors scan the whole context assembled for a task — source, logs, memory, chat history — not your request, and several matched almost anything. Against a corpus of realistic non-PII repository content, **17 of 21 samples** were flagged: SVG path data and build timing tables read as phone numbers, `127.0.0.1` and `0.0.0.0` as personal IP addresses, `noreply@` commit trailers as personal email, the word `ENVIRONMENT` as a bank identifier, and "the diagnostic output shows a null deref" as protected health information. Every detector is now anchored on a cue ordinary source doesn't contain (`phone:`, `SWIFT:`, a `+` country code, a clinical construction) or validated structurally — reserved IP ranges and four-part version strings are no longer IP addresses; role mailboxes and `example.com` placeholders are no longer people. Same corpus: **0 of 23** flagged, with every true-positive case still detected.
- **One false positive no longer downgrades your model.** A single detector firing anywhere in the context bundle used to restrict the whole task to your trusted-model list — which, if that list holds only local models, silently removed every frontier model with no visible cause. The gate is now tiered: **PCI cardholder data and HIPAA PHI** still hard-gate to trusted models, while **GDPR/CCPA and custom confidential rules** are advisory — routing is left alone and the matched spans are redacted instead. Nothing leaks under either tier.
- **Privacy notices now say where a match came from.** Instead of "confidential content detected", you get `email address in memory "Stakeholders"` or `IP address in file src/net/probe.ts`, so a false positive is something you can find and fix.
- **Consenting to store one contact no longer silently enables workspace-wide scanning.** The Project Director PII modal now states that enabling the GDPR detectors applies to the whole workspace, and if the master switch had to be turned on you're told, with a shortcut to the Privacy page to review it.
- **Regression guard.** A benign source-repository corpus that must stay unclassified now ships as a test, alongside recall cases so tightening precision can't silently blind a pack.

---

## v0.140.0 — Ethics, Legal, and Commercial oversight + the Risk dashboard

- **Three new oversight advisors.** **Ethics Oversight** (user harm, fairness and bias, consent, dark patterns, transparency), **Legal Oversight** (dependency licence compatibility, IP, GDPR/CCPA, liability, terms of service), and **Commercial Oversight** (monetisation and viability, vendor cost and lock-in, contractual obligations, competitor positioning, go-to-market). They ask what the engineering specialists don't: *should we build this?*, *are we allowed to?*, *does this make commercial sense?*
- **Advisory, never authoritative.** Every prompt is explicit that it is **not professional advice**. The advisors surface concerns for human judgement and name the review a consequential finding needs — qualified counsel in the relevant jurisdiction, an ethics or DPO review, finance or commercial sign-off. They certify nothing, and no finding blocks a commit or a release.
- **Read-only by construction.** These are the first built-ins with a restricted skill allowlist: they read files, search, and inspect git history and diagnostics, but hold no file-write, commit, push, or terminal access. An advisor inspects and reports; it is not also the thing that edits.
- **New Project Dashboard → Risk page.** Run an advisor (or all three, one after another) and the findings are recorded to `project_memory/operations/risk-oversight.json` with a readable markdown mirror and an append-only audit trail. Includes a likelihood × impact **risk matrix** whose cells filter the register, an assessment-cadence chart, and per-domain freshness. Findings are never deleted — you accept, mitigate, dismiss, or reopen them — so the register stays a complete record of what was raised and what was decided.
- **Risk feeds the operational score, but only once assessed.** An unassessed project is *unknown*, not safe, so risk stays out of the score entirely until an advisor has run — installing this release does not move your existing health number. Findings are weighted by likelihood × impact, discounted by confidence, and decayed as an assessment goes stale.
- **Routing fixes.** Ordinary prompts no longer misroute: adding these agents surfaced two pre-existing scoring flaws (English function words like "the" counted toward relevance, and pinned skills leaked tool vocabulary into routing). Both are fixed, which also corrects older misroutes — "Read the file and tell me what is in it" went to the Security Reviewer and now goes to the default assistant.

---

## v0.139.0 — Keep-awake presence + Buzz (buzz.xyz) integration, Tier 1

- **Keep this computer awake so the agent stays online.** New `atlasmind.presence.keepAwake` setting (and **AtlasMind: Toggle Keep Computer Awake** command + status-bar indicator) holds an OS wake lock so a long Mission Loop run, a Remote Control gateway session, or a connected Buzz presence isn't killed by system sleep. Cross-platform (Windows / macOS / Linux) via a spawned OS helper — a VS Code extension can't use Electron's `powerSaveBlocker`. Deny-by-default and battery-safe: off unless you opt in, auto-suspends on battery (`presence.acPowerOnly`), lets the screen sleep unless you ask otherwise (`presence.keepDisplayAwake`), and auto-releases after a safety backstop (`presence.maxAwakeMinutes`).
- **Foundation for [Buzz](https://buzz.xyz).** Groundwork to bring Block's open-source, Nostr-based workspace for humans + AI agents (a self-sovereign Slack + GitHub alternative) into AtlasMind's Project Director and comms workflow.
- **Buzz identities on contacts.** Project Director contacts can carry a Buzz channel (npub / @handle / #channel) with an `https`-only deep link — no unverified native URI scheme is launched.
- **Forward-compatible connector.** Director comms now recognises Buzz-style tool names (`post_to_channel`, `send_dm`, `buzz_*`), so the moment a Buzz comms tool is connected, the existing guarded `{modal:true}` dispatch works with no further code.
- **Deny-by-default + local-first.** New `atlasmind.buzz.enabled` (off), `atlasmind.buzz.relayUrl` (`ws://localhost:3000`), and `atlasmind.buzz.allowRemoteRelay` (off) settings. The full four-tier roadmap lives in `project_memory/roadmap/buzz-integration.md`.

---

## v0.138.0 — Import MCP servers from your other tools

- **"Detected on this machine" on the Advanced Add-Server page.** AtlasMind scans for MCP servers you've already set up in Claude Desktop, Cursor, VS Code, Windsurf, or this repo, and lets you **Prefill the form** or **Import & connect** them in one click. It also shows which launch tools (npx/uvx/docker) are installed and offers env-variable names from your `.env`/`wrangler.toml` as click-to-add chips.
- **Cached and reusable.** The scan is saved to SSOT and reused on future installs, with a **Rescan** button and auto-refresh when a workspace MCP config changes.
- **Never touches your secrets.** Only env-variable *names* are cached or shown; on import, secret values are read live from the source file and stored in the OS secret store, never in the cache or the webview.
- **Stuck on an unknown server?** An "Ask Atlas to help" button hands off to chat to scope a safe setup.
- **The whole recommended catalogue is now guided (batch 2).** The remaining 21 "manual" servers — AWS, Google Cloud, Cloudflare (+ Workers), Apple/Xcode, MySQL, MongoDB, Elasticsearch, RabbitMQ, Amazon SNS/SQS, SendGrid, CircleCI, Grafana, Prometheus, Jira, Trello, Stripe, and more — became supply-chain-verified guided prefills with safe defaults (AWS/MongoDB read-only, least-privilege credential guidance, browser-OAuth via a pinned bridge for remote services). A few stay opt-in guided-manual (OpenAI web-search, Bark/APNs), and Twilio/Jenkins route to Advanced with full guidance because they require the credential on the command line, which AtlasMind won't auto-store.

---

## v0.137.0 — Guided MCP setup that actually hand-holds

- **13 "manual" MCP servers are now guided.** GitHub, Microsoft Entra ID, Microsoft 365, Shopify, WooCommerce, WordPress, Webflow, Wix, YouTube, Meta Ads, and X auto-fill a verified command and ask only for your credentials; Twitch and LinkedIn stay opt-in community servers (pinned, review-before-connect) but are still fully prefilled.
- **No more blank Advanced form for beginners.** The wizard now shows "What you'll need", a numbered how-to for getting each credential, a direct "Open credentials page" button, a docs link, and a safety note — plus example placeholders and per-field help. The Advanced form also gained inline help + examples on every field.
- **Researched and supply-chain-verified.** Each server's setup was checked for a first-party/reputable package that genuinely implements MCP; archived, non-existent, and account-risky packages were deliberately excluded.

---

## v0.136.0 — Documents dashboard tab, roadmap cleanup & MCP setup fix

- **New Documents (.md management) dashboard tab.** Define a *document filing system* (folder "shelves", optionally narrowed by a glob) and the documents to *keep updated automatically*. AtlasMind tracks each tracked document's freshness (file change time vs. a recorded review baseline), discovers uncovered markdown, and offers an explicit **Update with Atlas** / **Mark reviewed** action. Safety-first: it never rewrites a document on a timer, and every path is sanitised (no traversal outside the workspace). Backed by a new `DocumentsManager` persisting `project_memory/operations/documents.json` + a `documents.md` runbook mirror.
- **Roadmap Dashboard cleaned up.** The backlog no longer duplicates items or lists inappropriate scaffolding — the parser reads only the real backlog region, filters generator boilerplate, and de-duplicates. Drag-to-reorder now shows a clear grab handle with a live drop-target highlight, and "Mark MVP" carries a plain-language tooltip explaining what a Minimum Viable Product is.
- **MCP Guided Setup no longer dead-ends.** Servers that need details you provide (e.g. GitHub, Microsoft 365) no longer show "just connect" and then fail with a misleading "complete every required field" error — the wizard now routes you to Advanced setup, and names the exact missing field when one genuinely is blank.

---

## v0.135.0 — Project Director reminders & surfacing (Phase 4)

- **Follow-up reminders that don't nag.** A new in-process scheduler surfaces a throttled, once-per-day in-editor nudge when follow-ups are overdue or due soon, with a one-click "Open Project Director". It is notification-only — it never auto-sends anything on a timer. A startup nudge is on by default; the recurring timer is opt-in. Both toggle from the Director Setup card.
- **A Project Director sidebar view.** A new tree groups Stakeholders, Team, and due/overdue Follow-ups, with a badge showing the overdue count; clicking any item opens the Director tab.
- **Chat, too.** `@atlas /director` prints a skimmable status (people, responsibilities, assignments, follow-ups) and `@atlas /followups` lists open follow-ups grouped overdue / due soon / upcoming — both with a button to open the dashboard.

---

## v0.134.0 — Project Director connectors (Phase 3)

- **Reach people through your connected tools — opt-in and guarded.** When outbound messaging is enabled and a matching MCP connector is connected (Microsoft 365 / Outlook, Slack, a Google-Calendar server), the Director tab can email, schedule a meeting, or post a message to a contact. Otherwise it falls back to the existing deep-link / copy path and never auto-sends.
- **Deny-by-default with an explicit confirm.** Every send requires the project toggle, a connected connector, and a modal that shows exactly what will be sent (connector, tool, recipient, subject/body, risk) before anything runs. The tool comes from the connected server; the webview only supplies the draft, which is re-resolved and re-classified host-side. Sends are recorded to the Director history.
- **Connectors surfaced; credentials stay in SecretStorage.** The Setup card shows connected messaging connectors and a link to manage MCP Servers, plus an On/Off outbound toggle. Referencing a person in Microsoft 365 / Slack stays preferred over storing raw personal data.

---

## v0.133.0 — Project Director dashboard (Phase 2)

- **A People tab in the Project Dashboard.** The new **Director** tab surfaces and edits the stakeholders, delivery team, responsibilities, assignments, and follow-ups around a project, backed by `ProjectDirectorManager`. Contacts show role badges with **Open** (deep-link) and **Copy contact**; responsibilities map an area to an owner and backup; assignments can be status-cycled and can give an autonomous run a human owner; follow-ups group into Overdue / Due soon / Upcoming with done/snooze/cancel.
- **Solo-friendly, not just teams.** A one-person project foregrounds self-management and marks "you"; a team project shows the full roster. An auto/solo/team toggle overrides the inference.
- **GDPR-safe.** Seeding pulls a first draft from your repo (git contributors, CODEOWNERS, package author, Website Studio stakeholders). Storing raw personal data asks for a one-time acknowledgement and turns on the `gdpr-pii` classification pack; every edit is re-sanitised host-side and deep-links are re-checked against a scheme allowlist before opening.

---

## v0.132.0 — Remote control over an SSO gateway

- **Reach your desktop AtlasMind from your own website login.** Remote control can now run in `gateway` mode behind an SSO-gated Cloudflare Worker + Cloudflare Tunnel, so you can drive the orchestrator and view read-only cost/run dashboards from any browser signed into your platform login — not only a same-machine web client. No inbound port is opened; the Worker and tunnel are outbound/edge.
- **Identity from the login, not a copied token.** In gateway mode the server authenticates each WebSocket by the `x-atlas-origin-secret` header the Worker injects (timing-safe against the pairing-token secret) and records the forwarded user id for audit; the browser never holds a credential. Localhost pairing mode is unchanged and still the default.
- **Same safety posture.** Workspace-trust approval, the redaction boundary, desktop-authoritative tool approvals, and default-deny-on-disconnect all still apply. New command **AtlasMind: Enable Remote Control (Gateway)** and setting `atlasmind.remote.mode`.

---

## v0.131.0 — Guided MCP setup wizard

- **MCP is now approachable for first-time users.** The MCP Servers panel leads with a step-by-step **Guided Setup**: **Scan my computer** (AtlasMind finds servers it can set up from tools you already have) or **Browse by category**, then it checks prerequisites, asks only for the inputs a server needs, and connects. The old raw form lives on as an **Advanced** tab.
- **Credentials done right.** Guided secret fields (API tokens) are stored in VS Code **SecretStorage** and injected as env vars only at connect time — never written to settings — via the new `McpServerConfig.secretEnvKeys`.
- **Confirm before install.** Missing runtimes (Node, uv, …) are surfaced with the exact command and installed **only after you confirm**, replacing the previous silent auto-install.
- **Trustworthy environment scan.** The revived `detectAvailableServers()` now surfaces only servers whose launch runtime is actually present.

---

## v0.130.0 — Project Director (Phase 1: people model)

- **AtlasMind now models the people a project runs on.** A new `ProjectDirectorManager` captures stakeholders, the delivery team, responsibilities (who owns what), human task assignments, and follow-ups, persisted to `project_memory/operations/project-director.json` with a human-readable `project-director.md` mirror and a capped history file.
- **Human owners for autonomous work.** Assignments introduce a human-assignee layer that agent-role tasks lacked, and can bind an autonomous run to a human owner without mutating the run record.
- **GDPR-first by design.** AtlasMind prefers to reference people in their system of record (Microsoft 365, Slack, Google Workspace — each with a data-governance reference) instead of storing raw personal data; any locally-stored PII is flagged for a one-time consent gate, communication deep-links are restricted to a safe scheme allowlist, and the git-tracked mirror shows channels by kind/label only.
- *(This is the data + service foundation; the Project Dashboard → Director tab, guarded connector send/schedule, and scheduled reminders follow in later phases.)*

---

## v0.129.0 — Guarded website hosting environments

- **Every Website Studio project now has Develop, Staging, and Production.** Develop is local/loopback by default, with an explicit HTTPS and password-protected hosted fallback when local execution is unavailable. Staging is always an HTTPS, password-protected `<review-label>.<production-domain>` for client review. Production is public and promotion-protected.
- **The Hosting & Platforms dashboard shows the complete path.** Each environment has URL, branch/project reference, notes, locked access policy, readiness state, and actionable setup/blocking issues before the platform catalog.
- **The policy is enforced in the extension host.** A modified webview payload cannot make Staging public, turn Production into a password store, or remove Production protection. Credential fields accept only provider-prefixed references such as `SecretStorage:website.staging.password` and `env:WEBSITE_STAGING_PASSWORD`; the password value remains outside project memory.
- **Readiness is descriptive, never deployment authority.** Website Studio validates loopback, HTTPS, credential-reference, and Staging-subdomain topology, while actual publishing still enters the Project Dashboard's guarded Delivery pipeline.

---

## v0.128.0 — Website Studio

- **AtlasMind now has a dedicated, end-to-end Website Studio.** Six dashboards carry a client project from imported or hand-authored brief through sitemap, wireframes, visual design, UI system decisions, hosting/CMS readiness, and n8n workflow mapping.
- **Broad platform coverage.** Cloudflare Pages, GitHub Pages, WordPress + Elementor, WordPress, Vercel, Netlify, Azure Static Web Apps, Shopify, Webflow, and custom targets share one safe planning surface; guarded production delivery still happens in the existing Delivery dashboard.
- **Website-aware bootstrap and SSOT.** Choosing **Website / Marketing Site** seeds `project_memory/domain/website.json` and its review-friendly `website.md` mirror without overwriting an existing plan.
- **Secret-safe n8n planning.** Website Studio accepts workflow and credential references, not credential values or webhook URLs, and sanitizes/redacts imported webview data before persistence.

---

## v0.127.2 — `main` is now the default branch

- **The repository's default branch is now `main`.** The old release branch `master` was renamed to `main` and set as GitHub's default, so anyone landing on the repo sees the released, Marketplace-matching code instead of in-progress work. `develop` stays the day-to-day integration branch. CI, the release-promotion workflow, the delivery pipeline, and all docs were updated to match, and Dependabot keeps opening dependency PRs against `develop`. Also fixed an unresolved merge-conflict marker that had left `.vscode/settings.json` as invalid JSON.

---

## v0.127.1 — "Install in Ollama" shows live progress

- **The Local Model Advisor's "Install in Ollama" button now works visibly.** It always fired the pull, but it blocked silently on a non-streaming request (and failed quietly when Ollama wasn't running), so it looked like nothing happened. It now streams the download as live progress in the **"AtlasMind: Local Model Install"** output channel and a cancellable notification (matching the LM Studio install), and tells you clearly when the Ollama daemon isn't running. AtlasMind drives Ollama through its API (the same thing the `ollama pull` CLI does), so it works without the CLI on `PATH` and honours a remote Ollama endpoint.

---

## v0.127.0 — Instruction sets sync both ways, with conflicts resolved in chat

- **AI instruction sets now sync two-way.** Previously the AI Instructions page only *imported* other tools' instruction files into AtlasMind. The new **`/sync-instructions`** chat command (and the **"Align all instruction sets (two-way)"** button) reconciles every detected tool's instructions — GitHub Copilot, Claude Code, Cursor, Cline, Codex/AGENTS.md, Gemini, Windsurf, Aider — **plus AtlasMind's own** into one unified set, then mirrors that set **back into each tool's file** (in its own format, inside a managed block so your other content is preserved), so they all share the same guidance.
- **Conflicts are resolved by you, in chat.** Trivial differences merge automatically; only genuinely contradictory rules (e.g. tabs vs spaces) are raised as conflicts with a recommended pick and one button per option. **Nothing is written until you resolve them** — accept the recommendation, override with `choose <#> <#>`, then `apply`.
- **Safe by construction.** Only AtlasMind's delimited block is ever written, only into files that already exist; JSON-config tools are skipped; malformed model output aborts before any write. The unified set is also saved to `project_memory/domain/ai-instructions-sync.md`.

---

## v0.126.0 — Local Model Advisor: installs that work, on both runtimes, with installed badges

- **"Install in LM Studio" actually installs now.** It used to run `lms get` as the terminal's shell process; because `lms get` is interactive, it exited non-zero and VS Code threw the cryptic *"terminated with exit code 1"* dialog. It now runs as a direct child process with the **`--yes`** flag (skips the prompt, picks the recommended quant), streams progress into an **"AtlasMind: LM Studio Install"** output channel under a cancellable progress bar, and on failure shows the real reason and opens the HuggingFace page as a fallback.
- **"Install in Ollama" is offered for HuggingFace models too.** Ollama can pull GGUF straight from HuggingFace via the `hf.co/<owner>/<repo>` prefix, so every recommendation card now shows both **Install in Ollama** and **Install in LM Studio**.
- **Recommendation cards show when a model is already installed.** Matching is now done on a normalized identity key (source prefix, repo path, and quant noise stripped; parameter size kept), so HuggingFace-sourced models are correctly recognised and the card shows an **Installed · Ollama / · LM Studio** badge instead of install buttons.

---

## v0.125.0 — Quick-reply chips show up far more reliably

- **One-tap reply chips now appear on many more question shapes.** When an AtlasMind reply ends with a question, the Chat panel offers clickable pills — but they used to only show for inline *"A, B, or C?"* and a narrow set of yes/no phrasings, so plenty of questions silently fell back to a plain text box. Detection was rewritten: it now recognises **markdown / numbered option lists** (a selection question with a `1. … 2. …` or `- …` list above or below it → pick-one pills), tolerates markdown emphasis and internal punctuation around the question, and covers **more yes/no openers and confirmation tails** (*"Should we…", "Could I…", "…sound good?", "…make sense?"*). It stays conservative — a yes/no question above a *findings* list stays Yes/No, and an open question above a list still gets a text box rather than fabricated buttons.

---

## v0.124.0 — Promotions resolve their own fixable blockers

- **"Resolve & run" in the promotion modal.** When a promotion is blocked only by checks AtlasMind can fix — the version isn't bumped, or there's no changelog entry — the modal now offers a one-click **Resolve & run** instead of dead-ending. It bumps `package.json`, adds a `CHANGELOG.md` entry, commits them (`chore(release): vX.Y.Z`, path-scoped, **never pushed**), then runs the promotion under the single-flight lock. The **bump level is assessed from the conventional-commit history** since the target (feat → minor, breaking → major, else patch), and the modal explains what it will do and why. The offer only appears when *every* failing auto-check is fixable (a failing CI / separation-of-duties / working-tree check disables it), your own gates (manual checks, approval, protected confirmation) must already be satisfied, and the full gate is re-enforced after the fix before anything deploys.

---

## v0.123.0 — Models learn from their struggles

- **AtlasMind now remembers when a model keeps failing a *kind* of task, and routes around it.** This targets the recurring "drift down to a weak/cheap/local model" you may have noticed. When a model times out, returns nothing, emits a tool call as plain text, errors out, or gets corrected by you on the next turn, AtlasMind records a *struggle* keyed by the task signature (`phase · reasoning · tools`). The penalty is marginal and decaying (~2.5-day half-life, halved on a clean turn), but once a model has repeatedly failed a task kind, a **budget tier-escape** opens up more capable (pricier) models for that task kind so a stronger model can take over — the recurring drift is the cheap model's price advantage winning, and this is what counters it. The memory persists across sessions in `globalState` (`atlasmind.modelStruggleSignals`) and is gated by the existing learned-routing weight (`atlasmind.feedbackRoutingWeight = 0` turns it off). De-weighted models show a **"de-weighted: …"** hint in the **Compare Models** panel explaining why.

---

## v0.122.1 — Recovery no longer leaks the echo stub

- **Provider-failure recovery concludes cleanly instead of parroting its own prompt.** When a provider failed mid-turn (e.g. a 30s timeout) and no failover model existed, the self-healing recovery could route to the built-in `local/echo-1` placeholder, whose adapter just echoes the prompt — so the final reply became `Local adapter response: … Failure context: Provider "google" failed with: …`, leaking the internal recovery prompt and raw error to the user. The maintenance/bootstrap completion paths now detect the echo adapter's sentinel and return empty, so recovery falls through to a clean, actionable template (the provider stopped responding, nothing was changed, here's how to continue) and the response can finish.

---

## v0.122.0 — Proposed project runs flow straight through

- **No more dead-end "Proceed".** When a chat reply ends by offering to start an autonomous project run (e.g. *"…want me to kick off a project run to build this out?"*), AtlasMind now continues into the run on the same turn instead of stopping and waiting. It runs **immediately** under Autopilot (with a brief notice), or after a cancellable *"Starting a project run to: … — use Stop to cancel"* notice otherwise. The run reuses the exact goal that typing "Proceed" would have resolved, and unusually large runs still hit the file-count approval gate (auto-flowed runs aren't pre-approved). Detection is conservative — explicit project/autonomous-run vocabulary plus a first-person go-ahead, with declines and requirement-gathering questions ignored. Controlled by the new `atlasmind.autoStartProposedProjectRuns` setting (default **on**); set it to `false` to keep the previous Yes/No-pill confirmation.

---

## v0.121.2 — Local endpoints save again

- **Adding a local endpoint now persists.** OpenAI-compatible local endpoints (Ollama, LM Studio, …) added in **Settings → Models & Integrations** were silently dropped on refresh and never showed up in the Model Providers sidebar. The `atlasmind.localOpenAiEndpoints` setting was documented but never registered in `package.json`, so VS Code rejected the save and the fire-and-forget Settings handler swallowed the error. The setting is now a registered typed array of `{ id, label, baseUrl }`, edits persist, and any remaining save failure surfaces as a notification instead of failing silently.

---

## v0.121.1 — MCP git tools auto-fill the repo path

- **Fixed "repoPath is required" on MCP git tools.** When the model calls an MCP tool that needs a repo/working directory (e.g. GitKraken `git_status`) but omits it, AtlasMind now defaults that parameter to the current workspace folder before dispatch. Only repo/working-path parameters (`repoPath`, `projectPath`, `cwd`, `workingDirectory`, …) are filled; a bare `path` argument and any explicit value are left alone.

---

## v0.121.0 — Roadmap replies ask before they plan

- **Plan requests ask, not dump.** Asking AtlasMind to *plan the route to MVP* when project basics are missing now returns a focused **"Plan your MVP"** ask listing just the gaps (`Project type`, `Target audience`, `Timeline`, `Tech stack`, …) as direct questions — not the whole backlog. Once answered, planning hands off to the model.
- **Answer everything in one message.** A single **"Answer all N questions"** chip pre-fills the composer with a fill-in-the-blank block, so you resolve every gap at once instead of one chip at a time.
- **Status replies are tidier.** Explicit *roadmap status/progress* questions still get a summary, now leading with the questions + combined chip and with the outstanding list in a collapsed disclosure.
- **Counts only real work.** Shipped `release-history.md` notes, resolved metadata, and scaffold/legend prose outside the managed backlog block are excluded; only items inside `<!-- atlasmind:roadmap-items:start/end -->` count as outstanding.

---

## v0.120.4 — Decluttered chat panel header

- **Rebuilt the top of the chat panel.** The `AtlasMind / project` title sits on top; below it a single control strip carries a Runs icon, a Chat-Threads icon with the session count and the `+` new-session button, and the five chat action buttons (font size, clear, copy, open-as-Markdown) right-aligned on the same line.
- Chat threads and standalone runs are now independent dropdowns under the strip. The old "Dedicated Workspace" eyebrow and boilerplate subtitle are gone; the active-thread title and run guidance show only while inspecting an autonomous run.

---

## v0.120.3 — Comparison matrix re-verified + Mission Control row

- **Every competitor cell re-checked against official docs (June 2026).** Corrected stale figures: Cline **30+ providers**, Aider **100+ providers**, Cursor **5+ providers + custom API**; Claude Code custom-agent artifact fixed to **subagent `.md` files**; Copilot/Cursor/Windsurf/Continue custom-agent support moved ❌ → ⚠️; Windsurf image input, MCP, and named checkpoints upgraded; Aider/Windsurf voice input noted; Cline/Cursor/Continue/Copilot CLIs noted; Cursor & Claude Code cost visibility noted.
- **New row: "Goal-seeking autonomous loop runs (Mission Control)"** — AtlasMind's budget-bounded, self-evaluated, checkpoint-gated loop set against Claude Code `/loop`, Copilot agentic/cloud loops, Cline auto-approve, Cursor iterating agents, and Aider's scriptable test-fix loop.

---

## v0.120.2 — README & Comparison accuracy fixes

- **Built-in skill count corrected to 43** across the README (two spots) and the Comparison matrix (was stated as 35 / 36 / 32); rebuilt the README skills table to include the 7 missing skills and a new **Debugging** category.
- Comparison matrix: memory write-gate scanner **10 → 12 rules**, provider count **12+ → 20+**, and the freshness caveat updated to mid-2026.

---

## v0.120.1 — Mission Control adopts the dashboard design system

- **Visual consistency.** Mission Control now uses the Project Dashboard's shared `--dash-*` design tokens directly — gradient page background, 20px-radius gradient panel-cards with soft shadows, display-font headings, a `page-intro`-style topbar, accent buttons, and tone dots — so it matches the dashboard pages instead of approximating them.

---

## v0.120.0 — Mission Control refresh + Run Center cross-links

- **Mission Control modernised.** The autonomous-loop console gains an intro topbar with a live status chip, card-style form sections, restyled controls, and tone status dots on the Recent missions list.
- **One-click navigation between the two delivery surfaces.** Project Run Center now has a "🛰 Mission Control" button, and Mission Control has a "▶ Project Run Center" button.

---

## v0.119.0 — Design refresh reaches Cost, Run Center, and Ideation

- **Consistent visual language across the operational panels.** The Cost Dashboard, Project Run Center, and Project Ideation panels now share the same tone status dots / meters and no-dead-hover discipline introduced on the Project Dashboard.
- **Cost Dashboard.** Summary and feedback cards carry tone dots; the budgeted "Today's Spend" card shows a budget-pressure meter; the approval-rate card is toned by its actual rate.
- **Project Run Center.** The "Current posture" pills gain live tone dots reflecting the selected run's state.
- **Project Ideation.** The hero stat cards gain tone dots; the interactive canvas was audited and left intact.

---

## v0.118.0 — Project Dashboard design refresh

- **Every page now matches the Delivery standard.** Visual indicators, plain-English orientation, and fully clickable cards across Overview, Score, Repo, Runtime, Testing, SSOT, Security, Gap Analysis, and Privacy.
- **No dead hover.** Cards that looked clickable but did nothing now always resolve — open a file, jump to a page, run a command, or start an Atlas chat — and truly non-interactive elements no longer pretend to be clickable.
- **Visual indicators.** Metric pills gained tone status dots and meter bars; pages gained at-a-glance status strips; the Operational Score shows its composition as a coloured flow strip.
- **Plain-English page intros.** Each page opens with a one-line "what this is / what to do" band plus tone chips and a primary action.
- **Security standout.** Governance signals (SECURITY.md, CODEOWNERS, PR template, dependency governance) now open the file when present or ask Atlas to create it when missing.

---

## v0.117.0 — Road to MVP on the Roadmap dashboard

- **A guided path to your first shippable product.** The Project Dashboard's Roadmap page now opens with a **Minimum Viable Product** section. Tag backlog items for the MVP path with a per-item **Mark MVP** toggle (stored non-destructively as a `#mvp` tag in `project_memory/roadmap/improvement-plan.md`), or let the dashboard suggest foundational candidates when nothing is tagged yet.
- **See how far away MVP is.** A progress bar and a numbered milestone track visualise completed vs. remaining MVP milestones and percent-to-MVP.
- **Best route, AI-assisted.** A deterministic recommended sequence front-loads foundational, security, and architectural work with per-step reasoning and a highlighted next step — and a **Plan the MVP route with Atlas** button hands a focused prompt to a live chat for a deeper, dependency-aware plan.

---

## v0.116.5 — Delivery Dashboard shows the real Production version

- **No more stale deployed version.** The Production stage read its version from the local release branch, which a developer working on `develop` never pulls — so it showed a long-outdated number. The dashboard now reads the deployed version from the remote-tracking ref (`origin/<branch>`) when present, falling back to the local ref offline.

---

## v0.116.4 — Fix `[object Object]` floods; surface blocked TDD fixes honestly

- **No more `[object Object]` in replies.** When a model endpoint returns message content as an array of parts (not a plain string), the OpenAI-compatible adapter used to emit a run of `[object Object]`. Content is now normalized to text in every path.
- **A described-but-blocked fix is no longer reported as done.** When the TDD policy blocks a write and the model only *describes* the fix, Atlas re-prompts once to actually complete the red→green cycle, and otherwise appends a clear "Change not applied" note so nothing reads as applied when it wasn't.

---

## v0.116.3 — Don't downgrade corrections; recover from empty answers

- **Corrections stay on a capable model.** When you tell Atlas it's wrong ("that's not correct", "no, that's wrong", "are you sure?"), the turn is treated as high-stakes and routed to a capable, reasoning-class model instead of being silently downgraded to the cheapest/local model.
- **No more blank answers.** If a model returns nothing (zero output tokens), Atlas no longer re-prompts the same flaky model — it escalates to a stronger model and surfaces a real answer instead of an empty turn.

---

## v0.116.2 — Delivery no longer invents a `main` production branch

- **Honest branch import.** When the production branch can't be detected, the Delivery seeder used to default the Production stage to `main` — wrong for repos that use `master`/`develop`. It now leaves the branch unset and the dashboard shows "not detected" rather than importing a fabricated target. Corrected the persisted pipeline's Production branch back to `master` and added regression tests.

---

## v0.116.1 — Fix garbled verification output in chat

- **No more `[1m[7m[36m RUN …` noise.** Captured tool output (e.g. `vitest`) carries ANSI colour/cursor escape sequences that rendered as garbled fragments in the post-write **Verified:** chat summary. Verification output is now sanitised first — ANSI/CSI/OSC sequences stripped, carriage returns folded, stray control bytes removed — via the shared `src/utils/terminalOutput.ts` helper, which the managed-terminal stream also uses.

---

## v0.116.0 — Delivery hardening pt 2 (remaining gaps)

- **Concurrency lock** — only one promotion/rollback runs at a time (auto-clears after 60 min if a run crashes).
- **Trigger-CD** — a stage can promote by dispatching a CD workflow (`gh workflow run`) instead of deploying from your machine; auto-detected from a `workflow_dispatch` deploy/release workflow.
- **Backup verification + migrations** — an optional verify-backup command must pass after the backup, and a migrate command runs inside the guarded sequence.
- **Separation of duties** — optionally require the promoter to be a different person from the change's author (auto-checked via git identity).
- _Deferred (need dedicated design): first-class progressive delivery (canary/blue-green) and ephemeral per-PR preview environments._

---

## v0.115.0 — Delivery hardening (gap-analysis follow-up)

- **CI is actually enforced now.** Required CI checks are verified live via `gh` at promote time — a failing or still-running check blocks the gate (graceful fallback to manual when `gh` is unavailable). No more honor-system "CI green" checkbox.
- **Audit log + rollback.** Every promotion/rollback is recorded (who/when/what/outcome) and shown as *Recent promotions*; stages with a rollback command get a confirm-gated **Roll back** button that executes it.
- **Broader import.** Detects Python/Go/Rust/Java/.NET projects and PaaS/IaC targets (Fly.io, Vercel, Netlify, Render, GAE, Serverless, Kubernetes, Terraform, containers); derives a production URL where possible.
- **Readability.** A pipeline **flow diagram** (stage → stage with branch, version, status) heads the page, and a **Test health** button pings a stage's health URL.

---

## v0.114.0 — Delivery imports your PR/CI promotion protocol

- **PR-based promotion is now first-class.** The pipeline detects whether promoting into a branch goes through a **Pull Request** (from GitHub branch protection via `gh`, falling back to the bound routine's `gh pr create`) and the **exact required CI status checks** (branch-protection contexts like `quality (ubuntu-latest)`, else the gating workflow names from `.github/workflows`).
- **Surfaced everywhere.** Stage and push cards show a **🔀 via PR** badge and the real check names; the promotion dialog lists each CI check as a preflight item; the runbook says "Promote via Pull Request into a protected branch."
- **New guardrail.** A PR-required promotion with no routine bound to open the PR is blocked — a protected branch is never targeted by a direct push.
- The `gh` probe runs only at seed / re-import (short timeout, full fallback to local signals).

---

## v0.113.0 — Delivery imports your real protocol (not a generic template)

- **Accurate seeding.** The Delivery pipeline now imports the repository's actual signals — project archetype (VS Code extension / library / web service), database presence, publish target (Marketplace / npm / container), `.env` files, package scripts, CI, and existing routines — instead of assuming a web-app-with-database. No more phantom "production database" with a backup gate that blocked the production push on projects that have no database.
- **Real routine binding + real checks.** The production push binds to your existing publish/release/ship/deploy (or default) routine, and required checks mirror the `compile`/`lint`/`test` scripts you actually have (plus "CI green" when workflows exist). Deploy-less projects get an **Integration** stage instead of a fictional staging server.
- **Re-import from repo.** A new button re-detects signals and rebuilds the pipeline, so already-seeded projects can refresh to match reality.

---

## v0.112.1 — Security: clear all Dependabot alerts

- **All 6 open Dependabot alerts resolved** by pinning `undici` to `^7.28.0` (npm `overrides`). They all came from one transitive **dev-only** dependency in the packaging toolchain (`@vscode/vsce → cheerio → undici`), which is **not shipped in the extension** — installed users were never exposed. `npm audit` now reports 0 vulnerabilities.

---

## v0.112.0 — Delivery stays current + flags drift since last review

- **Auto-refresh.** The Project Dashboard → Delivery page now updates automatically when `delivery.json` changes outside the dashboard (a hand edit, a teammate's change pulled via git, or a script) — a file watcher reloads the pipeline and re-renders, so it always shows the current protocol.
- **"Review needed" banner.** When the delivery setup has changed since you last reviewed it — the config was edited externally, a new stage-candidate branch appeared (`release/*`, `staging`, `prod`…), a stage's branch went missing, or the CI/CD workflows changed — a banner lists exactly what changed.
- **Mark reviewed.** One click snapshots the current state as your new baseline so the banner clears until something drifts again. Saving edits through the dashboard counts as a review automatically — the banner is only for drift you didn't make. Review state is per-workspace and never committed.

---

## v0.111.1 — Automatic release tagging

- **Every Marketplace release now gets a git tag.** `npm run publish:release` creates and pushes a `v<version>` tag after publishing (cross-platform, idempotent). Tagging had lapsed; it's now automated so releases stay traceable.

---

## v0.111.0 — Mission Loop asks before stopping on a setting block

- **No more silent cancels on recoverable settings.** When a Mission Loop can't verify progress because a relaxable setting is in the way — e.g. tests can't run because `atlasmind.allowTerminalWrite` is off — it now prompts you instead of ending: **Override for this run** (relax it just for this mission, auto-reverted when the run ends), **Open settings** (deep-link to the Safety page), or **Stop**. Deny-by-default — dismissing the prompt stops safely. Works from `/loop`, the chat panel's **New Loop**, and Mission Control.
- **In-surface decision buttons.** Loop checkpoint approvals and block-recovery prompts now appear as buttons — at the base of the chat bubble in the chat panel, and as a unified in-panel decision card in Mission Control — instead of OS modal dialog boxes. The chat panel's **New Loop** also starts in its own fresh session.

---

## v0.110.1 — Competitive watch: SUPACODE

- **Competitive analysis added.** A watch note on [SUPACODE](https://supacode.sh/) — a native-macOS command center that runs 50+ CLI coding agents in parallel, each in its own `git worktree`. It maps SUPACODE's strengths to AtlasMind's current state, flags a latent write-race in parallel subtask batches (they share one working tree today), and frames worktree-per-agent isolation, a parallel multi-lane UX, and PR-native GitHub automation as a prioritization signal for items already on the roadmap. Docs-only (`project_memory/ideas/supacode-competitive-analysis.md` + `docs/roadmap.md`).

---

## v0.110.0 — WCAG Contrast Checker in the recommended MCP catalogue

- **New recommended MCP preset: WCAG Contrast Checker.** The Settings → MCP server picker now offers a one-click prefill for `npx -y contrast-checker-mcp` — WCAG 2.1/2.2 AA/AAA contrast checks, colour parsing across formats, and accessible-colour suggestions for UI and frontend work. Tagged `community` provenance with verified npm/GitHub references, Node.js runtime-install hints, and a custom-CA note for the Env vars field.

---

## v0.109.0 — Mission Loop (autonomous goal-seeking loop)

- **An optional looping development process.** Define a goal, guardrails, and a *closed parameter envelope* (cost / iteration / token / wall-clock caps + a no-progress stop) at the start of a run, and AtlasMind loops on top of the existing plan→execute→synthesize machinery — planning each increment (grounded in SSOT memory, guardrails, and success criteria), executing it, then **re-evaluating progress against the goal** — until the goal is met or a guardrail confines progress.
- **Hybrid autonomy.** The loop runs on its own but pauses for **deny-by-default** approval checkpoints at configurable triggers (every N iterations, a budget-fraction crossing, or before write/commit batches).
- **Sends agents out to learn.** Discovery is prefer-existing (registered agents/skills/MCP tools first) and may synthesize new agents/skills or use Agentic Resource Discovery — always behind the existing approval gates.
- **Verification-weighted "done."** A goal is only *achieved* with passing verification where behaviour changed; the project's Testing Methodology Matrix and TDD policy are inherited automatically. Deployments route through the guarded delivery pipeline, never run directly.
- **Surfaces:** the `/loop <goal>` chat command (preview → `--approve` → live iterations), a **New Loop** send-mode in the chat panel composer (runs the prompt as a mission goal), the **Mission Control** panel (`AtlasMind: Open Mission Control`), a dedicated **Mission Loop** page in the Settings dashboard for the `atlasmind.loop.*` defaults, and a live **Current Loops** section on the Cost Dashboard showing in-flight loop spend against the cost cap. Every run is audited to `project_memory/operations/missions.json` + a `missions.md` runbook mirror.

---

## v0.108.0 — Deployment Stages & Promotion pipeline

- **The Project Dashboard → Delivery page now opens with a Stages & Promotion pipeline.** Your environments — Local → Staging → Production — are modelled as first-class, plain-English cards. On first open AtlasMind **seeds a professional pipeline from your repository's branches** (detected production branch, `develop` as staging).
- **Each stage card explains itself.** Branch, the package version currently deployed there, hosting/config/data facets, and the **safety reasoning in everyday language** — why production is protected, that secrets are referenced by location only (never stored), and that a backup runs before any change.
- **Full in-dashboard editor.** Add, edit, reorder, and remove stages (all four facets + description + backup/gate/rollback policies), and manage promotion edges ("pushes") — add, re-point, set a routine id, remove. Edits are sanitised before they touch disk.
- **Promotions ("pushes") are described as a guarded sequence:** preflight gate → backup → promote (never force-push) → verify, with the required checks and approval listed. A data-bearing target with no backup command set is **deny-by-default blocked** until you add one.
- **Guarded execution — Execute & Runbook.** The **Promote ▸** button opens a confirmation dialog with the full plan, the preflight checks (auto-evaluated where possible, otherwise tick-to-confirm), an approval checkbox, and a type-the-name-to-confirm field for protected targets. **Confirm & run** executes the pipeline with live per-step progress (backup → your deploy/migration routine steps → health check → record), then surfaces the result and a rollback hint. **Runbook** shows the same plan read-only. Commands are always sourced from your own saved config/routines, never injected; AtlasMind never force-pushes.
- The pipeline is saved as `project_memory/operations/delivery.json` with a human-readable `delivery.md` runbook mirror, both openable from the dashboard.

---

## v0.107.0 — Resource Discovery moves into Settings

- **Resource Discovery is now a tab in the Settings dashboard.** Searching Agent Finders, installing discovered MCP servers/agents/skills/APIs, managing finders, and exporting your project's catalog now happen on a **Resource Discovery** tab inside `AtlasMind Settings` — same chrome, same navigation. The `AtlasMind: Resource Discovery` command, the sidebar tree, and `/discover` all open that tab; the separate Resource Discovery webview has been retired.
- **Privacy Dashboard fix:** the "Who may receive confidential data" trust tree now shows every provider you have actually connected, not just the interactive ones. It previously hid any provider whose live health probe had failed (e.g. a transient TLS/network hiccup), even though it appeared connected in the sidebar. The trust tree now uses the same "configured" signal as the sidebar MODELS tree.
- **Faster loads:** the Claude Code CLI is no longer re-spawned on every panel/tree render — its probe is cached briefly — which removes a recurring startup and panel-open slowdown.

---

## v0.106.0 — Agentic Resource Discovery (ARD)

- **AtlasMind is now a first-class [Agentic Resource Discovery](https://agenticresourcediscovery.org/) client and publisher.** Search federated Agent Finders for MCP servers, agents, skills, and APIs — *before* invocation — then install them with one click (MCP servers land disabled behind the existing trust gate).
- New **Resource Discovery** panel and sidebar tree, the `/discover` chat command, and a read-only `discover-resources` skill agents can call mid-task.
- **Publish** your own resources: `AtlasMind: Export Resource Catalog` writes a spec-conformant `ai-catalog.json` (secrets, prompts, and env excluded).
- Safety-first: Agent Finders ship **disabled** (opt-in), all manifests/responses are validated as untrusted, discovery URLs are HTTPS + SSRF-screened, federation is depth-bounded, and the relevance score is labelled as match-only — not trust. See [[Resource Discovery]].

---

## v0.105.2 — Sidebar Chat Sync Fix

- **The sidebar chat now mirrors the main chat panel.** Previously the sidebar could get stuck showing an empty "no sessions / Ready." view that did not reflect the sessions and transcript in the detached chat panel. The webview now performs a ready handshake on load so both surfaces always receive current state, even after the sidebar is hidden and reopened.

---

## v0.105.1 — Privacy Page Fixes: Connected-Only Tree, Scroll Stability & DSAR Links

- **Trusted Models lists only connected providers** instead of the full seeded catalog, which also fixes the slow Project Dashboard / Settings first paint caused by the oversized model list.
- **The model/tree list no longer jumps to the top** when you tick a checkbox or expand a provider — scroll position is preserved across re-renders.
- **Provider data management links to the Data Subject Request (DSAR) process** where published (e.g. Mistral), via a dedicated "Submit a data-subject request" button.

---

## v0.105.0 — Privacy Page: Trust Tree, Catch Charts & Provider Data Management

- **Trusted Models is now a provider → model tree** (collapsible, with a provider-level "trust all" toggle) and lists **only currently-active models**, so the panel stays manageable instead of showing one massive flat list.
- **Classification activity charts** show what the policy is catching: a catches-over-time chart, total/redacted counters, and a per-detector breakdown. Catches are recorded whenever a custom rule or compliance detector fires during a real task and persist across sessions.
- **Provider data management**: for each trusted provider, the page links to its GDPR / data-subject request portal, privacy policy, DPA, retention summary, and default training stance — so handling a GDPR request starts one click away. AtlasMind only links out; it never submits requests for you.

---

## v0.104.3 — Packaging Fix

- **Restored VSIX packaging** after the 0.104.2 dependency bump. `@types/vscode` was pinned back to `^1.120.0` to match `engines.vscode`, since `vsce` rejects types newer than the declared engine. The supported minimum VS Code version is unchanged.

## v0.104.2 — Dependency Security Maintenance

- **Applied Dependabot security updates for development dependencies** (`js-yaml` 4.1.1→4.2.0, `form-data` 4.0.5→4.0.6, and the developer-tooling group: `@types/vscode`, `@typescript-eslint/eslint-plugin`, `@vitest/coverage-v8`, `eslint`). `npm audit` reports 0 vulnerabilities; the full build and all 1104 tests pass. No runtime dependencies changed.

## v0.104.1 — No Success Claims Over a Failing Verification

- **A turn can no longer report success while its own verification run failed.** If a response claimed the work was done while the post-edit verification reported `FAIL` / a non-zero exit code, AtlasMind now gives the model one chance to reconcile (fix it or state the task isn't complete) and, if it still claims success, appends a deterministic caveat citing the failing line and marking the task **not complete**. Detection keys on structured markers (`FAIL:`, `exit N`, `N failed`, `✗`) and is overridden by `PASS:` / `0 failed`, so a test merely *named* "…fails when…" isn't misread.

## v0.104.0 — Data Privacy & Trusted-Model Gating

- **Mark confidential data and keep it on the models you choose.** A new project Data Privacy policy lets you classify language/terms, files, and folders as proprietary, confidential, or secret — and enable built-in compliance packs (GDPR, HIPAA, PCI-DSS, CCPA/CPRA, Financial) that detect regulated data points like emails, payment-card numbers, and health terms. Classified content is only ever sent to the **trusted models you select**; every other model receives a redacted `[CONFIDENTIAL]` placeholder.
- Enforcement is layered: a **routing gate** restricts model selection to trusted models when context is classified, a **redaction fail-safe** strips classified spans for the actually-selected model, and **tool reads are gated** so a confidential file read by an un-trusted model is withheld. Deny-by-default — an empty trusted list trusts nothing.
- Managed from the Project Dashboard → new **Privacy** page (enable toggle, compliance-standard checkboxes, custom term/regex/path rules, trusted-model multi-select, and a test-against-text/path preview). The detectors are heuristic aids, not a compliance certification.

## v0.103.2 — Honest Subtask Outcomes

- **Project subtasks that didn't actually deliver are no longer reported as completed.** A subtask that ended on a hard tool error (e.g. a missing-file read), returned only a preamble ("Let's inspect…") with no work, or otherwise signalled incomplete delivery used to be recorded as `completed` — letting the run build dependents on a broken foundation and report a false "N/N completed". These are now classified as `failed` (with an explanatory reason), so dependents are skipped and the run's completed/failed counts are honest. A failing subtask also gets one recovery retry before it's marked failed. (Iteration-cap pauses remain `needs-input`, from v0.101.0.)

## v0.103.1 — Inline Sidebar Brand Header

- **The sidebar brand header is now a single inline line.** The project name moved from a stacked subtitle to an inline **`AtlasMind/ProjectName`** form — the project name follows a forward slash after the wordmark in a slightly smaller, dimmer font — reclaiming the vertical space the second row used. When no project name is available, the slash and name are hidden and only the clickable "AtlasMind" wordmark remains. Both segments stay independently clickable (wordmark → Settings, project name → Project Dashboard).

## v0.103.0 — Smarter Triage Routing, Cleaner Answers & a Clickable Sidebar Brand Header

- **Open-ended "what should we work on next / is anything incomplete?" prompts now route to a capable model.** They previously matched no reasoning hint and fell through to the cheapest (often sub-10B) model, which can't do whole-project triage. They are now classified as high-reasoning so the router steers them to a stronger model. Mechanical follow-ups (e.g. "commit") are unaffected.
- **Duplicated answers are collapsed.** When a weak/looping model emits its final answer twice in a row, AtlasMind now drops the duplicate copy before display (conservative: only large, exact, adjacent duplicates).
- **Pick-one buttons for enumerated questions.** Answers that end in a 3–4 option choice ("…: A, B, or C?") now render one clickable pill per option, not just for yes/no or two-option questions.
- **The AtlasMind sidebar now leads with a clickable brand header.** The chat view (the topmost sidebar surface) opens with an **"AtlasMind"** wordmark that opens the **Settings** panel, and a subtitle announcing the active project that opens the **Project Dashboard**. The project name is the **connected Git repository name** when the workspace has a remote (e.g. `…/AtlasMind.git` → `AtlasMind`), falling back to the **workspace folder name** otherwise. Both are keyboard-focusable and routed through the validated webview message protocol to the existing commands. (The activity-bar container title can't be made clickable through the VS Code API, so the header lives inside the topmost view where it's reachable.)

## v0.101.0 — Paused Subtasks on Iteration Cap

- **Autonomous `/project` subtasks now pause instead of silently dying when they hit the tool-iteration cap.** A capped subtask previously returned `completed` with the bare "Execution stopped…" message as its output, so the run rolled on as if it had succeeded and the user never got the override that single-turn chat already offers. Subtasks now report a new **`needs-input`** state carrying the orchestrator's suggested higher limit; the project report shows a **"⏸️ Paused — tool-iteration limit reached"** section with a button to raise `maxToolIterations` and the choices to raise permanently, raise once and re-run, or skip. The Project Run Center, run log, and CLI all reflect the paused state.

## v0.100.3 — Documentation Accuracy Sweep

- **Corrected stale docs found while auditing changes since 0.80.0.** Fixed the `atlasmind.maxToolIterations` default (documented as `20`, actually `10`) in the configuration reference and wiki, and refreshed the Voice section that still claimed there was "no host-side OS-native speech adapter" — contradicting the OS host speech engine (0.80.0) and on-device Whisper STT (0.81.0). Docs-only.

## v0.100.2 — SSOT Tracked in Git (Selective)

- **The `project_memory/` "project brain" is now version-controlled** (agents, decisions, ideas, architecture, roadmap, routines, …) instead of being blanket-ignored. Volatile or potentially-sensitive content — chat session transcripts, temp scratch files, and dated run-history dumps — stays out of the public repo. Repo-hygiene change only.

## v0.100.1 — Open Knowledge Format (OKF) Interoperability Planning

- **Planned OKF support** for Google Cloud's new vendor-neutral knowledge format (OKF v0.1, 2026-06-16). AtlasMind's SSOT is already structurally OKF-shaped, so the plan is to add **import/export** — including a **"Convert project to OKF"** command that emits an ingested project as a portable bundle — plus a **spec-watch sync** that tracks the standard as it evolves and only raises an advisory on changes (never auto-editing your memory). Evaluation and design captured in the project roadmap; planning only, no implementation yet.

## v0.100.0 — Compare Models: All Providers, Sorting & a Quality Judge

- **Every configured model is now listed**, grouped by provider in collapsible sections (like the Models tree), with a per-provider and a global Select All. Previously only routing-enabled models showed, so most of your catalog was hidden.
- **Sortable results** — click any column header (Model, Quality, Completion, Cost, Latency, Tokens) to sort.
- **Clearer "Completion" column** — the coarse completion-integrity grade (always ~1.0 for clean answers) is now labelled and explained, instead of masquerading as answer "Quality".
- **Optional LLM judge** (off by default) — pick a judge model and it scores each answer 0–100 for correctness, completeness, and usefulness, adding a real **Quality** column that drives the ranking (rationale on hover). The judge is display-only; routing still calibrates on the completion grade. See [[Chat-Commands]].

## v0.99.1 — Faster Startup (Deferred Freshness Scan)

- **Startup no longer waits on the memory freshness scan.** The check that fingerprints the whole repo to flag stale imported memory (and light up the "Update Memory" badge) was still running on the startup-critical path — seconds of work on a large workspace. It now runs ~8s after activation settles instead. The SSOT still loads immediately, the on-save watcher keeps freshness current, and the badge just appears a moment later.

## v0.99.0 — Compare Models, Refined

- **Reworked Compare Models panel** to match the other dashboards (topbar, cards, ranked results with a highlighted winner). It now lists **only models from providers you've configured** (grouped by provider), adds a **Select All** toggle, and ships **ready-made sample prompts** (reasoning, code, summarize) as one-click chips.
- **Easier to reach**: a beaker icon on the **Models** view titlebar opens it, and there's a **Compare Models** quick-action on the Settings overview. See [[Chat-Commands]].

## v0.98.0 — Skip Unconfigured Providers + On-Demand Memory Refresh

- **Unconfigured providers are no longer probed** (`src/extension.ts`): startup discovery skips any provider with no API key/credentials before its health check — so an unconfigured Bedrock (no AWS keys) no longer burns ~30s on a network probe, and the ~20 providers you haven't set up are skipped entirely. Configured ones are unaffected.
- **Stale-memory auto-refresh is now off by default** (`atlasmind.autoRefreshStaleMemory`): re-importing stale imported memory is an expensive LLM re-summarization that slowed dashboard/panel load on launch. AtlasMind now flags stale memory and surfaces **Update Memory** for an on-demand refresh instead; set the new setting to `true` to restore auto-refresh. See [[Configuration]].

## v0.97.2 — Faster, Bounded Startup Discovery

- **No more ~1-minute `[providers]` stall** (`src/extension.ts`): startup model discovery across ~24 providers ran serially, so slow providers (or a hanging Claude CLI health probe with a 60s timeout) summed to nearly a minute. Discovery is now concurrent and each provider is bounded by a 10s timeout, so one slow provider can't stall the rest — total time drops to roughly the slowest single provider. See [[FAQ]].

## v0.97.1 — Surface Silent Activation Failures

- **Dead toolbar icons now explain themselves** (`src/extension.ts`): when a core startup step fails, the context was left unassigned and every chat-view title icon that needs it silently did nothing (only Settings worked). Activation now catches the failure and shows an actionable error with a Show Output button pointing at the "AtlasMind" output channel, where the failing step is logged. See [[FAQ]].

## v0.97.0 — Model Comparison Panel

- **A real UI for model comparison** (`src/views/modelComparisonPanel.ts`): the Compare Models command now opens a webview — enter a prompt, pick 2+ models, and see a ranked table of quality/cost/latency with output previews, instead of plain output-channel text. Graded outcomes still calibrate routing. Nonce-protected, message-validated, output escaped. See [[Architecture]] and [[Chat-Commands]].

## v0.96.1 — Higher-Fidelity Claude Brain

- **More context for the Claude Code CLI bridge** (`src/providers/claude-cli.ts`): instead of truncating every message to 4k chars, the bridge now gives the latest turn up to 16k (≈4×) while keeping history small and the total within the OS command-line limit. This directly benefits brain-role pins (`planningModelId` / `synthesisModelId`) where a single message carries the goal + memory context. See [[Model-Routing]].

## v0.96.0 — Local-Draft / Frontier-Escalate

- **Draft cheap, escalate when needed** (`src/core/orchestrator.ts`): the new `atlasmind.draftModelId` setting pins a draft model (e.g. a fast local model) for the first attempt of mechanical/low-stakes tasks, while the existing struggle-gated escalation upgrades to a stronger model if the draft falls short — completing the draft/plan/execute/synthesize role-routing set. The pin never blocks escalation (which now explicitly clears any model pin). See [[Configuration]] and [[Model-Routing]].

## v0.95.0 — Model Comparison Harness

- **Benchmark models on your own prompt** (`src/core/modelEvalHarness.ts`, `AtlasMind: Compare Models on a Prompt`): run one prompt across selected models and get a ranked comparison (quality, cost, latency, tokens, preview). The graded outcomes feed the outcome-driven routing channel, so benchmarking also calibrates routing. The scoring core is pure and unit-tested; the quality scorer is now shared (`executionQuality.ts`). See [[Model-Routing]] and [[Chat-Commands]].

## v0.94.0 — Synthesis Role Pin

- **Complete the role-routing trio** (`src/core/orchestrator.ts`): a new `atlasmind.synthesisModelId` setting pins the synthesis phase (summarizing results/sessions) to a chosen reasoner, symmetric to `atlasmind.planningModelId`. Together they implement plan-with-the-brain → execute-with-workers → synthesize-with-the-brain over the `preferredModel` pin. See [[Configuration]] and [[Model-Routing]].

## v0.93.0 — Context-Aware Outcome Routing

- **Outcome bias per reasoning tier** (`src/core/modelRouter.ts`): the learned routing bias now tracks each model's outcomes both in aggregate and per reasoning tier (low/medium/high), so a model strong at deep reasoning but weak at mechanical work is preferred only where it actually performs. Falls back to the aggregate when a tier bucket is sparse. See [[Model-Routing]].

## v0.92.0 — Planner-Brain Role Routing

- **Pin a model by role** (`src/core/modelRouter.ts`, `src/core/orchestrator.ts`): a new `RoutingConstraints.preferredModel` pin lets a specific model be chosen for a role, bypassing budget/speed gates when it is genuinely available (still respecting health and required capabilities). Its first use is the **planner brain** — the `atlasmind.planningModelId` setting pins the planning/decomposition phase to a chosen reasoner (or a Claude subscription, since planning needs no tools) while execution still routes to tool-capable workers. See [[Model-Routing]] and [[Configuration]].

## v0.91.0 — Outcome-Driven Routing

- **Routing learns from real outcomes** (`src/core/modelRouter.ts`, `src/core/orchestrator.ts`): a new per-model execution-outcome channel keeps a decayed EWMA of graded run quality (error / empty / truncated / clean) and turns it into a small, bounded routing nudge — so models that consistently do well on this project's work are preferred, and struggling ones are nudged down without being excluded. Separate from the manual thumbs feedback, gated by a minimum sample count and the `feedbackRoutingWeight` control, and persisted across sessions. See [[Model-Routing]].

## v0.90.0 — Smarter Anthropic Caching

- **Stable/volatile system split** (`src/providers/anthropic.ts`): the cache breakpoint now sits after the stable system head (guardrails/agent/skills) and before the volatile memory + evidence tail, so the cached prefix stays identical across turns and hit rates rise. The whole-system approach missed whenever memory/evidence changed.
- **Threaded tool-less caching** (`src/core/orchestrator.ts`): a new `cacheStablePrefix` request flag (set when the carried-context cacheable ratio ≥ 0.25) caches the stable prefix on threaded chat turns too, not just agentic tool loops — while still skipping single-shot turns. See [[Model-Routing]].

## v0.89.0 — Anthropic Prompt-Cache Writes

- **AtlasMind now actively caches the stable prefix on Anthropic** (`src/providers/anthropic.ts`): for agentic (tool-carrying) requests, the system prompt and tool definitions are marked with `cache_control: ephemeral`, so Anthropic bills them at the reduced cache-read rate on repeat calls within a task's tool loop. Gated on tool presence to avoid the cache-write premium on single-shot turns. Closes the loop with the v0.88.0 savings telemetry — AtlasMind writes the cache, the provider reports the reads, the Cost Dashboard shows the realised savings. See [[Model-Routing]].

## v0.88.0 — Prompt-Cache Savings Visibility

- **Measured cache savings in the Cost Dashboard** (`src/providers/*`, `src/core/costTracker.ts`, `src/views/costDashboardPanel.ts`): adapters now read cached input tokens from provider usage (Anthropic `cache_read_input_tokens`, OpenAI `prompt_tokens_details.cached_tokens`, DeepSeek `prompt_cache_hit_tokens`) on both buffered and streaming paths. The orchestrator values the avoided spend (`ModelRouter.cacheReadPricePer1k`), the cost summary aggregates `totalCacheSavingsUsd` + `totalCachedInputTokens`, and a new **Cache Savings** card appears beside Compression Savings. Closes Direction 1 of the routing roadmap end-to-end. See [[Model-Routing]].

## v0.87.1 — Per-Provider Cache Discounts

- **Realistic per-provider cache-read pricing** (`src/core/modelRouter.ts`): cache-aware routing now uses a `PROVIDER_CACHE_READ_FACTOR` baseline (Anthropic/Claude CLI 0.1×, OpenAI/Azure/Copilot 0.5×, DeepSeek/Google 0.25×) instead of a flat 0.25× for cache-capable models without an explicit cached price — so deeper-discount providers like Claude are costed correctly on iterative turns. Still a bootstrap baseline only: a dynamic `cachedInputPricePer1k` from discovery / pricing sync overrides it. See [[Model-Routing]].

## v0.87.0 — Cache-Aware Model Routing

- **Prompt-cache economics in routing** (`src/core/modelRouter.ts`, `src/core/orchestrator.ts`): AtlasMind sends a large, stable prefix (system prompt + memory bundle + tool definitions) every turn, which frontier providers bill at a reduced cache-read rate. The router now projects that saving — a new `cacheablePrefixRatio` (estimated from carried context vs. the new message) makes cache-capable models cheaper on iterative/threaded work, while single-shot turns are unaffected. `ModelInfo`/`CatalogEntry` gain `supportsPromptCaching` + `cachedInputPricePer1k`.
- **Cache capability is dynamic** — providers change model capabilities, so it is data-driven: `DiscoveredModel` and the live pricing sync can report (or retract) caching support per refresh, merged with hint → pricing → catalog precedence; the static provider set is only a bootstrap fallback. See [[Model-Routing]].

## v0.86.2 — Active-Subscription Routing Preference

- **Subscriptions preferred for ordinary work** (`src/core/modelRouter.ts`): the subscription preference bonus previously applied only on maintenance tasks, so on normal work a paid-for, quota-remaining subscription got no nudge over pay-per-token (unlike local models, which do). Added a small, quota-aware general bonus so an active subscription is preferred for everyday work too — vanishing once quota is exhausted (then treated as pay-per-token). See [[Model-Routing]].

## v0.86.1 — Reasoning-Aware Routing Fix

- **Catalog reasoning depth & latency class now reach the router** (`src/extension.ts`): `inferModelMetadata()` was dropping `reasoningDepth` and `latencyClass` when merging discovered models with the catalog. Since most models are populated via discovery, deep reasoners (Opus, DeepSeek R1, Nemotron Ultra) were collapsing to the fallback depth and getting under-ranked for high-reasoning tasks. The annotations now survive the merge. (The `claude-cli` Claude-subscription provider stays chat-only by design, so it remains correctly excluded from tool-driven agentic work.) See [[Model-Routing]].

## v0.86.0 — NVIDIA Nemotron Models (NIM)

- **First-class Nemotron catalog for NVIDIA NIM** (`src/providers/modelCatalog.ts`, `src/runtime/core.ts`): the NVIDIA NIM provider gains a provider-scoped `NVIDIA_CATALOG` for the Nemotron family — Ultra 253B (extended reasoning), Super 49B, Nano, 70B Instruct, and Mini — with accurate context windows, capabilities, reasoning depth, and hosted pricing. Resolving from a provider-scoped catalog means hosted (paid) Nemotron models no longer inherit metadata from the `$0` local Nemotron entries. The default seed now leads with Nemotron Super 49B + Nano so the family appears before runtime discovery. See [[Model-Routing]].

## v0.85.0 — Cross-Language Archetype Detection

- **Archetype detection now spans languages** (`src/core/testingScaffolder.ts`): the scaffolder reads each detected language's dependency manifest (`pyproject.toml`/`requirements.txt`/`Pipfile`, `Cargo.toml`, `go.mod`, `pom.xml`/`build.gradle`) so web/api/cli/game archetypes resolve for Python, Rust, Go, and Java — not just Node. Short Node-only package names are gated to Node to prevent substring false positives (e.g. `cargo-nextest` is no longer mistaken for Next.js). Archetype-dependent recipes like the API/CLI/web e2e branch now fire correctly across stacks.

## v0.84.0 — Multi-Language Testing-Framework Scaffolding

- **Language- and archetype-aware scaffolding** (`src/core/testingScaffolder.ts`): the framework scaffolder no longer assumes Node/JS. It detects the project language (Node/Python/Rust/Go/.NET/Java) from manifest fingerprints and a coarse archetype (web/api/cli/game/mobile/library/generic), then emits idiomatic starter files — pytest + Hypothesis + Locust (Python), `cargo test` + proptest + criterion (Rust), `go test` + `testing/quick` + benchmarks (Go), xUnit (.NET), JUnit 5 (Java), alongside the existing Node toolchain. Node e2e recipes branch on archetype (API smoke test / CLI spawn harness / Playwright web spec). Unknown stacks degrade to playbook-only guidance. Closes the prior gap where non-Node projects received JS-flavoured stubs. Still non-destructive. See [[Agents]] and [[Skills]].

## v0.83.0 — Testing Protocols for External Agents & Framework Scaffolding

- **Outbound testing-protocol sync** (`src/utils/testingProtocolSync.ts`, `src/utils/aiInstructionSync.ts`, `src/views/settingsPanel.ts`): the testing methodology matrix is now visible to AI agents *outside* AtlasMind. Instruction-file sync was previously inbound only; the new `syncTestingProtocols` writes an AtlasMind-managed, delimited block describing each enabled methodology (what, when, key tools, owner agent, preferred model, notes) into every *detected* markdown instruction file — `CLAUDE.md`, `.github/copilot-instructions.md`, `AGENTS.md`, Cursor, Cline, Gemini, Windsurf, Aider. Strictly non-destructive: only the managed block is touched, only existing files are written, and all paths pass the shared traversal guard. Saving the matrix auto-syncs; a **Sync to AI agents** button and `atlasmind.syncTestingProtocols` command trigger it on demand. See [[Skills]] and [[Security]].
- **Stack-aware framework scaffolder** (`src/core/testingScaffolder.ts`): `scaffoldTestingFramework` infers the project stack (TS/JS, test runner, UI framework, Playwright/Cypress) and generates fitting starter files for each enabled methodology (Vitest/Jest specs, Playwright/Cypress e2e, fast-check property test, k6 load script, snapshot test) plus a managed `project_memory/operations/testing-strategy.md` playbook. Non-destructive — files are created only when absent, `package.json` is never mutated, and the action is modal-confirmed. Available via the **Scaffold framework** button and `atlasmind.scaffoldTestingFramework` command.

## v0.82.0 — Remote Control from the Web Build

- **Drive a desktop instance from vscode.dev** (`src/web/*`, `src/remote/*`, `src/views/chatProtocol.ts`, `src/views/chatWebviewMarkup.ts`): AtlasMind now ships a web extension that acts as a thin client, relaying chat and read-only dashboards to a full desktop instance over a localhost WebSocket. The desktop does all Node-heavy work (models, file system, MCP, voice); the browser only renders UI. **Secrets never leave the desktop.** The chat front-end was made host-agnostic so one `ChatPanel` serves both local and remote surfaces via a synthetic webview host; every inbound remote frame is re-validated by the existing chat-message guard.
- **Security-first by default**: off unless enabled, localhost-only bind, pairing bearer token in `SecretStorage`, workspace-trust gate, audited connections, one-click revoke (token rotation), and default-deny of pending tool approvals on disconnect. See [[Remote Control]] and [[Security]].
- **Dual-target build**: added esbuild for the browser bundle (`out/web/extension.js`) alongside the existing `tsc` desktop/CLI output. New commands `atlasmind.remote.*` and settings `atlasmind.remote.enabled` / `atlasmind.remote.port`.

## v0.81.0 — On-Device Speech-to-Text (Whisper)

- **Local STT via whisper.cpp** (`src/voice/localTranscriber.ts`, `src/voice/voiceManager.ts`, `src/views/voicePanel.ts`): the Voice Panel transcribes speech entirely on-device. The webview captures the mic, encodes a 16 kHz mono WAV in-browser, and a host-side `LocalTranscriber` runs a local `whisper-cli`. Audio never leaves the machine; only the model (and, on Windows x64, the CLI) are downloaded on first use, each SHA-256-verified over HTTPS. New settings `atlasmind.voice.sttEngine` (`auto`/`webspeech`/`local`) and `atlasmind.voice.whisperCliPath`; macOS/Linux need an installed `whisper-cli` (e.g. `brew install whisper-cpp`). Web Speech remains the fallback.

## v0.80.0 — On-Device OS Speech Engine, Voice Panel Fixes, and Testing Matrix Correction

- **Host-side OS speech engine for TTS** (`src/voice/hostSpeechSynthesizer.ts`, `src/voice/voiceManager.ts`): AtlasMind can now speak using the operating system's built-in engine (Windows SAPI via PowerShell, macOS `say`, Linux `espeak-ng`) entirely on-device — no network, no API key — and even when the Voice Panel is closed. Enable it with `atlasmind.voice.hostSpeechEnabled`. Backend priority is ElevenLabs (when keyed) → OS host engine → in-panel Web Speech. Spoken text is delivered over stdin and never placed on a command line.
- **ElevenLabs playback unblocked** (`src/views/webviewUtils.ts`): added a `media-src` directive to the shared webview CSP so the `blob:` audio used for ElevenLabs server-side TTS can actually play. Previously it fell back to `default-src 'none'` and was blocked, with the Web Speech fallback hiding the failure.
- **Voice device and voice-id preferences persisted** (`package.json`, `docs/configuration.md`, `wiki/Configuration.md`): registered the `atlasmind.voice.inputDeviceId`, `atlasmind.voice.outputDeviceId`, and `atlasmind.voice.elevenLabsVoiceId` settings. They were read/written in code but unregistered, so device selections silently failed to save and the ElevenLabs voice id always defaulted to the demo voice.
- **Testing Methodology Matrix detection algorithm fixed** (`src/core/testingConfigLoader.ts`): the single-loop detection that mixed wildcard and specific signals caused `tdd` (first definition, wildcard `'*'`) to shadow all concrete methodologies. Restored two-pass detection: specific signals first, wildcard fallback only for testing roles. `e2e`, `continuous`, `bdd`, `security-testing` and all other specific-signal methodologies now fire correctly.
- **27-test suite for `TestingConfigLoader`** (`tests/core/testingConfigLoader.test.ts`): covers inference for all role types, specific-signal priority over wildcard, false-positive prevention for non-testing tasks, model override resolution, and system-prompt hint generation.

## v0.79.2 — Autonomous Run Context Continuity and Compression Savings

- **Autonomous run context continuity** (`src/core/orchestrator.ts`, `src/chat/participant.ts`): project subtasks now carry the session context bundle so long runs keep goal, summary, decisions, SSOT excerpts, and open threads between subtasks.
- **Context compression toggle** (`package.json`, `src/core/orchestrator.ts`, `src/core/costTracker.ts`): `atlasmind.contextCompressionEnabled` opt-in setting; savings reported in exec summary and cost dashboard.

## v0.78.6 — CI Lockfile and ESLint v10 Fix

- **`npm ci` failure on CI** (`package-lock.json`, `src/types.ts`): lockfile regenerated to match the 0.78.3 tooling upgrades. `@typescript-eslint/ban-types` (removed in v8) replaced with `@typescript-eslint/no-empty-object-type` in `src/types.ts`.

## v0.78.5 — Package Build Fix

- **`engines.vscode` alignment** (`package.json`): bumped `engines.vscode` from `^1.95.0` to `^1.116.0` to match the `@types/vscode` devDependency version and unblock `vsce package`.

## v0.78.4 — Local Provider Panel Refresh Fix

- **Local provider not showing after save** (`src/views/modelProviderPanel.ts`): The Model Providers panel now subscribes to the `modelsRefresh` event, so it reloads automatically when a local endpoint (LM Studio, Ollama, etc.) is saved in the Settings panel. The endpoint was always persisted correctly — the panel just wasn't listening for the update signal.

## v0.78.1 — Documentation Policy in project_soul.md

- **Documentation policy section in `project_soul.md`**: the bootstrap end-of-response checklist directive and documentation maintenance table are now embedded directly in `project_soul.md` as a `## Documentation Policy` section. This makes the policy visible to AtlasMind agents at plan and execution time via the SSOT. `CLAUDE.md` retains the same table for Claude Code users. Manifest file detection (package.json, Cargo.toml, etc.) is inferred from the captured tech stack and shared between both outputs.

## v0.78.0 — Bootstrap CLAUDE.md Generation

- **CLAUDE.md generated on bootstrap**: the `/bootstrap` command now creates a `CLAUDE.md` at the workspace root when none exists. The generated file is populated from intake answers (project name, type, tech stack, audience, timeline, primary outcome) and includes the full documentation maintenance policy: the end-of-response checklist directive and the documentation table. The version manifest row (e.g. `package.json`, `Cargo.toml`, `pyproject.toml`) is inferred from the captured tech stack. Existing `CLAUDE.md` files are never overwritten.

## v0.77.3–0.77.4 — Dynamic Skill Catalog and Git Tool Fixes

- **Dynamic skill catalog in the project planner** (`src/core/planner.ts`): the hardcoded skill whitelist in the planner prompt has been replaced with a live catalog built from the `SkillsRegistry` at plan time. Every enabled skill — all git skills (`git-push`, `git-branch`, `git-log`, `git-status`, `git-diff`, `git-blame`, `git-apply-patch`, `git-commit`), user-registered skills, and connected MCP tools — is now automatically visible to subtask agents. The planner also explicitly instructs agents to prefer dedicated skills over `terminal-run` for operations where a specific skill exists.
- **`git-commit` fixes**: message is now passed as a typed parameter directly to `execFile`, eliminating the "pathspec did not match" errors that occurred when commit messages were routed through `terminal-run`'s naive shell-string parser. Added optional `stage_tracked: true` parameter to run `git add -u` before committing.
- **`terminal-run` quoted-argument parsing**: replaced the naive `split(/\s+/)` splitter with a POSIX-aware tokeniser (`splitShellCommand`) that correctly handles single-quoted, double-quoted, and backslash-escaped arguments — so commands like `gh pr create --body "multi word body"` no longer break.

## v0.77.2 — Bootstrapper Routine Extraction and Chat Routine-Edit Intent

- **Bootstrapper routine extraction**: `/import` now scans `CLAUDE.md`, `.github/copilot-instructions.md`, and `docs/development.md` for ordered procedure sections and writes a starter routine file to `project_memory/routines/<id>.md`. Steps are extracted from numbered list items with a **Label** and a backtick-quoted `command`; `<angle-bracket-placeholders>` become `${VAR}` interpolation tokens. Manual edits to routine files are detected via body fingerprint and preserved — the file is never overwritten. After writing, `RoutineRegistry` is reloaded so the new routine is immediately available to `/ship`.
- **Chat routine-edit intent**: freeform messages like "edit the ship routine" or "update my publish routine" now open the matching routine's source `.md` file directly in the VS Code editor, bypassing the LLM. AtlasMind matches the routine name or ID from the prompt, falls back to the default, and explains how to scaffold one via `/import` if no routines exist.

## v0.77.0–0.77.1 — Project Routines and `/ship` Command

- **Project Routines**: named, executable workflows stored as YAML-frontmatter `.md` files in `project_memory/routines/`. The registry scans on startup; the runner executes steps sequentially with `on_fail: abort | prompt | continue` policies and persists run results to ProjectRunHistory.
- **`/ship` command**: runs the default routine (or a named routine via `/ship <id>`). Trailing text is passed as `${message}` for commit message interpolation. Each step streams a live checklist into chat.
- **Run Routine card in Project Run Center**: routine tiles replace the dropdown, matching the panel's run-card design language. Each tile has a Ship button and an Edit button that opens the source file.

## v0.76.0 — AI Instruction Sync and Agent Quality Improvements

- **AI instruction sync** (`src/utils/aiInstructionSync.ts`): AtlasMind detects AI instruction files from 9 other tools in the open workspace (GitHub Copilot, Claude Code, Cursor, Cline, Continue, OpenAI Codex, Gemini CLI, Windsurf, Aider) and surfaces a nudge banner in the chat panel. Clicking **Sync** merges selected files into `project_memory/domain/ai-instructions-sync.md` as advisory context; Personality Profile settings take precedence. Path traversal is rejected at both scan and write time.
- **Orchestrator default prompt**: agents now read project memory, `CLAUDE.md`, or `README.md` before invoking executable skills when answering knowledge questions ("what is the publish policy?", "how do we branch?").
- **npmScripts skill**: description clarified to distinguish execution from knowledge queries; added routing hints and a 120-second timeout.

## v0.75.x — Testing Methodology Overhaul (0.74.0 → 0.75.8)

AtlasMind's testing system was rebuilt from a single TDD default into a full 23-methodology strategy registry. Changes shipped across eight patch releases:

- **23-methodology registry** (`src/types.ts`): each methodology carries label, description, category, *When to use*, *Key tools*, *Trade-offs*, `autoDetectSignals`, and a new **AI token impact** level (Low / Medium / High) with explanation. Categories: Design-time (TDD, BDD, ATDD, SDD, V-Model), Structural (Unit, Integration, Mutation, Property-Based, Continuous/Shift-Left, White-Box), Behavioral (E2E, Snapshot, Contract, MBT, Test Design Techniques, Black-Box, Gray-Box), Non-functional (Performance, Security, Visual Regression), Exploratory (Exploratory, Agile Testing).
- **Settings Panel → Testing tab**: full 23-row methodology matrix with enable/disable toggles, expandable ⓘ info rows (When to use / Key tools / Trade-offs / **AI token impact** badge), per-methodology agent assignment dropdown, model override input, and notes field. Colour-coded token impact badges: green = Low, amber = Medium, red = High.
- **Auto-assess project button**: scans the workspace (package.json deps, test config files, CI pipeline configs, UI source files, OpenAPI/Swagger specs, `SECURITY.md`, git contributor count, README) and signal-matches against each methodology's `autoDetectSignals` to recommend a pre-selected set via an Auto / Manual / Skip QuickPick.
- **Project Dashboard → Testing page**: live methodology toggle matrix with immediate save to `project_memory/index/testing-config.json`.
- **Agent Editor → Testing Roles section**: read-only methodology chips for assigned methodologies plus per-methodology model override inputs.
- **Bootstrap and import**: Auto / Manual / Skip picker presented before the methodology list; Auto mode pre-selects inferred methodologies; Skip defaults to TDD + Unit.

## v0.73.5 — GitHub Operator: Chained Ops, Auto Commit Messages, Policy Awareness, and Publish Routine

- **`github-operator` system prompt overhaul** (`src/runtime/core.ts`): the built-in GitHub Operator now executes chained git instructions ("commit and push") sequentially in a single turn; auto-generates conventional commit messages from `git diff --staged --stat` when none is supplied; derives push-target branch, protected-branch rules, release-hygiene requirements, and publish routine from the injected workspace context (populated by the AI Instructions sync from CLAUDE.md, `.github/copilot-instructions.md`, or equivalent) rather than reading project files at runtime.
- **Planner chained-op and release-hygiene rules** (`src/core/planner.ts`): two new `PLANNER_SYSTEM_PROMPT` rules direct the planner to model "commit and push" patterns as sequential subtasks with explicit `dependsOn` ordering, and to insert a release-hygiene subtask (version bump + changelog) before commit subtasks in projects that require it.

## v0.73.1 — Audit Gap Resolution: Secret Redaction, Context Guard, Smooth Routing, and Feedback Loop

- **Secret redactor** (`src/utils/secretRedactor.ts`): new pattern-based scanner strips Anthropic/OpenAI/GitHub keys, bearer tokens, PEM private keys, DB connection strings, and generic key/secret assignments from memory context and live evidence before they reach any LLM provider API.
- **`max_tokens` guard**: the agentic loop now clamps `maxTokens` per iteration to `contextWindow − estimatedInputTokens − 1024` so completions can't overflow the model's context window as conversation history grows.
- **`ProviderId` extensibility**: `| (string & {})` appended to the union so new providers register without touching `types.ts`.
- **Outcome feedback loop**: `ModelRouter.recordModelOutcome()` accumulates fractional preference votes from real task outcomes (not only manual thumbs), feeding execution results back into future routing decisions.
- **Smooth context-window gradients**: `scoreTaskFit` context-window penalties now linearly interpolate instead of applying binary cliff penalties, so future large-context models are correctly rewarded.
- **New routing constants**: `CONTEXT_SAFE_OUTPUT_MARGIN` and `PERFORMANCE_OUTCOME_WEIGHT` extracted to `src/constants.ts`.

## v0.73.0 — Chat and Orchestration Audit: 9-Batch Hardening Pass

- **Messages loop pruning**: the agentic loop evicts the oldest assistant + tool-result pair when message count exceeds `MAX_LOOP_MESSAGES`, preventing unbounded context growth.
- **Mid-flight budget check**: the orchestrator checks the daily budget cap after each tool-result accumulation and aborts early with a clear message if the limit would be exceeded.
- **Deprecation tombstoning**: model-not-found / deprecated errors during completion are recorded as model failures and emit a progress message, matching the billing-error path.
- **Synthesize-agent retry**: `synthesizeAgentForTask` retries once with a cheap/fast fallback before caching a synthesis failure.
- **Retry-After header**: Anthropic 429 responses now use the server-provided `Retry-After` delay instead of pure exponential backoff.
- **`ANTHROPIC_API_VERSION` constant**: all three hard-coded API version literals replaced with a single overridable constant.
- **Local capability inference expanded**: `inferLocalCapabilities` now detects extended-thinking, vision, and tool-calling models from name patterns; default context window raised from 8 K to 32 768.
- **Checkpoint size guard**: `readSnapshot` skips files over 512 KB to prevent OOM crashes on large repositories.
- **Tool policy name-based classification**: unknown tools with read-like name prefixes are classified `read/low` rather than defaulting to `network/high`.
- **Frustration settings bidirectionality**: boosted carry-forward settings are automatically restored after 30 minutes if no further frustration signal fires and the user hasn't manually adjusted the values.
- **Named router scoring constants**: all magic numbers in `ModelRouter` scoring are extracted to documented named constants.
- **Extended `ModelCapability` and `SpecialistDomain` unions**: new tags for `extended_thinking`, `structured_output`, `computer_use`, `audio`, `real-time-video`, and `scientific-computing`; new `ModelInfo` fields `thinkingTokenMultiplier` and `deprecatedAt`.

## v0.72.2 — Workspace-Relative Path Fix

- **`assertInsideWorkspace` path resolution** (`src/extension.ts`): relative paths (e.g. `web/src/pages`) passed to skill tools such as `directory-list`, `file-read`, and `file-write` were resolved against the process CWD rather than the workspace root, causing false "outside workspace" rejections. Fixed to resolve relative to `workspaceRoot`; all callers use the returned absolute path for the actual operation.
- **`directory-list` description** (`src/skills/directoryList.ts`): updated `path` parameter description to explicitly state that workspace-relative paths are accepted.

## v0.68.4 — Local Model Scan Always Available

- The "Scan & Recommend" panel in Settings no longer blocks with an error when the extension context has not fully initialised. Hardware detection and local runtime discovery now proceed unconditionally; usage-based scoring is skipped (scores fall back to hardware/release baseline) when no cost records are available yet.

## v0.68.2 — Local Model Advisor And Webview Bootstrap Hardening

- Added the Local Model Advisor in Settings with release-aware local model recommendations, hardware-aware ranking, and install/remove workflows for Ollama plus LM Studio guidance.
- Added a data-driven local recommendation registry with optional `.atlasmind/local-model-recommendations.json` overrides and fallback to built-in candidates.
- Added focused provider tests for registry override parsing and fallback behavior, plus an explicit CI quality gate for `npm run test:providers:local-recommendations`.
- Hardened chat panel startup to fail safely when required webview DOM nodes are missing.
- Updated dashboard and shared webview shell loading/CSP behavior to reduce `InvalidStateError` service-worker bootstrap failures in debug-host startup scenarios.
- Set sidebar chat view webview registration to avoid retained-context restore and deferred chat initialization by one event-loop tick to reduce startup races.

## v0.67.7 — Cross-Session Bleeding Fix

- **Simultaneous chat sessions no longer bleed into each other**: When the sidebar Chat View and the detached Chat Panel were both running prompts concurrently, each session's streaming responses were appearing in the other. The fix ensures each concurrent run gets its own isolated session and eliminates spurious syncState cascades caused by redundant `selectSession` events.

## v0.67.6 — Self-Managing SSOT Memory

- **"Project memory needs update" banner removed**: The Memory sidebar no longer shows a manual-review warning when imported entries go stale. The MemoryManager now auto-runs the import pipeline silently on activation and SSOT reload. The `Update Project Memory` command remains available on-demand from the command palette and view toolbars.

## v0.67.1 — Provider Refresh And Notification Acknowledgement

- **Immediate post-credential model discovery**: Saving API-key-backed provider credentials now forces a provider model refresh before the health pass, so the Models sidebar and router immediately show the provider's discovered catalog instead of waiting for a later refresh.
- **Dismissible auto-paused provider badge**: The Models view now exposes a dismiss action for auto-paused provider notifications. Acknowledging the badge clears the session warning state but leaves the affected providers disabled until the user re-enables them explicitly.

## v0.63.0 — AI Instructions Sync

- **AI Instructions page in Settings**: Scan the workspace for instruction files from GitHub Copilot, Claude Code, Cursor, Cline, Continue, OpenAI Codex, Gemini CLI, Windsurf, Aider, and more. Found files appear with a content preview and checkboxes. Confirming the selection merges chosen sets into `project_memory/domain/ai-instructions-sync.md` for automatic context inclusion.

## v0.62.0 — Dynamic Agent Routing Overhaul

- **`primaryRoutingNeeds`** field on `AgentDefinition`: every built-in specialist now self-declares its domain. The orchestrator gives these declarations +25 pts per matched need (LLM) or +15 pts (regex), making them the dominant selection signal.
- **`fromLlm`** flag on `ClassificationResult`: the classifier now reports whether its output came from an LLM call or the regex fallback, enabling trust-weighted routing need scoring.
- **`scoreAgent()` fixed**: system prompt tokens are no longer included in the base score. The UX Consultant's large prompt was causing it to win on almost every technical query.
- **Routing need corpus narrowed**: pattern matching against agent header only (role, description, skills); system prompt excluded to prevent false positive boosts.
- **`architecture` agentPattern tightened**: removed generic terms `design`, `structure`, `systems` that were causing UX Consultant to incorrectly receive an architecture routing need boost.

## v0.67.0 — Project Run Reliability & File-Writing Agents

- **Project runs no longer hang**: `AbortSignal` from VS Code's `CancellationToken` is now threaded through the full pipeline (planner → subtask execution → synthesizer). Cancellation terminates the pipeline immediately and shows a clear "_Project run cancelled._" message.
- **No more double-planning**: The preview plan is reused as `planOverride` inside `processProject`, eliminating the redundant second LLM call and the duplicate plan table.
- **Real token counts in project footers**: `synthesize()` and every `SubTaskResult` now track `inputTokens`/`outputTokens`. The chat footer shows `N in / M out` and the session transcript is written via `recordTurn()` so follow-up context works.
- **Subtask agents can now edit files**: Nine built-in workspace tools (`file-read`, `file-write`, `file-edit`, `file-search`, `memory-query`, `memory-write`, `test-run`, `terminal-run`, `workspace-observability`) are registered on Orchestrator startup. These are the exact IDs the planner assigns to subtasks, so agents now actually write code to disk instead of printing it as chat text.

## Unreleased

- Added a background SSOT memory self-healing loop that runs during activation and while the workspace remains open, so warned and blocked memory entries can be remediated automatically.
- Updated dedicated chat-panel tool activity to render inside the inner-monologue surface with latest-first display by default and a collapsible history for earlier updates.
- Memory self-healing now quarantines blocked SSOT entries into `temp/quarantine/*.blocked.txt.bak`, replaces blocked files with safe placeholders, sanitizes warned entries (hidden Unicode, suspicious instruction-like comments, secret-like values), and reindexes memory automatically.

## v0.61.4 — Agent Skills Auto-Management Refresh

- Expanded the agent skills auto-management experience and supporting runtime behavior.
- Refreshed related tests, docs, and SSOT memory snapshots so the shipped documentation matches the current implementation.

## v0.61.3 — Documentation Sync Guardrail

- Restored the README source-version banner so it matches `package.json` again
- Added a regression test that enforces the changelog title and README version banner so both docs stay in sync
- Tightened the release/docs guidance so README and mirror documentation are updated together when versioned changes land

## v0.57.10 - SSOT Sessions Folder Documentation Alignment

- Documented the internal `project_memory/sessions/` folder in SSOT structure docs and clarified it stores per-session chat context.
- Clarified that `sessions/` is intentionally excluded from normal SSOT retrieval/index operations to keep ephemeral runtime context separate from durable project memory.

## v0.57.9 — Release Metadata Sync

- Added deterministic SSOT auto-linking between sibling artifacts in paired folders (`decisions/ <-> roadmap/`, `architecture/ <-> operations/`) during memory indexing and upserts.
- Capped `relatedPaths` density and re-applied auto-linking on upserts so new sibling artifacts become discoverable through one-hop expansion immediately.

## v0.57.8 - Memory Relationship Overlay and One-Hop Retrieval

- Added optional `MemoryEntry.relatedPaths` links so SSOT entries can declare explicit neighbor artifacts.
- Added bounded one-hop neighbor expansion in `MemoryManager.queryRelevant()` and `queryWithOptions()` when result slots remain.
- Brought `NodeMemoryManager` behavior in line with VS Code host memory retrieval for related-path parsing and one-hop expansion.
- Fixed memory import trailer parsing for optional `related-paths` metadata.

## v0.57.7 - Chat Tool Execution Rendering and Changelog Integrity Fixes

- Removed duplicated nested busy/status handlers in `media/chatPanel.js` that caused unstable history rendering.
- Replaced regex-based `[TOOL_EXEC]` parsing with brace-depth JSON extraction for nested tool metadata reliability.
- Removed duplicated `recoveryNotice` template markup and repaired tool-history CSS block placement in `src/views/chatPanel.ts`.
- Repaired malformed and duplicated `0.57.3`/`0.57.4` changelog sections from prior edits.

## v0.57.2 ÔÇö Version bump

- **Copilot quota hard-stop fixed**: `"exhausted your premium model quota"` errors are now recognised as billing failures, triggering provider auto-pause and graceful failover instead of a hard error.
- **`review` no longer escalates to Opus**: Removed bare `review` from `HIGH_REASONING_HINTS`; `code review` is still treated as high-reasoning. Lightweight reads like "review the roadmap" now route to a cheap/fast model.

## v0.57.1 - Copilot Quota Failover and Routing Over-Escalation Fix

- **Copilot quota hard-stop fixed**: `"exhausted your premium model quota"` errors are now recognised as billing failures, triggering provider auto-pause and graceful failover instead of a hard error.
- **`review` no longer escalates to Opus**: Removed bare `review` from `HIGH_REASONING_HINTS`; `code review` is still treated as high-reasoning. Lightweight reads like "review the roadmap" now route to a cheap/fast model.

## v0.57.0 ÔÇö ClassifierService: LLM-Backed Routing, Domain Detection, and UI Command Routing

- **`ClassifierService`**: New service (`src/core/classifierService.ts`) that runs a single batched LLM call per request ÔÇö cheap/local-first via the `completeMaintenance` path ÔÇö answering all routing questions at once: specialist domain, routing needs, modality, reasoning depth, workspace bias, and UI command. Replaces ~50 per-request regex tests. Degrades gracefully to regex fallback when no model is available.
- **`Orchestrator.classify()`**: Public method that exposes classification to participant.ts and other extension-layer callers without duplicating construction.
- **`resolveSpecialistRoutingPlanWithClassifier()`**: Async variant of specialist routing in `participant.ts` that replaces 6 domain regex patterns and the 20-entry `NATURAL_LANGUAGE_COMMAND_INTENTS` array with a single classifier call. Falls back to sync regex on failure.
- **Context-aware downstream routing**: `selectAgent`, `buildMessages`, and `TaskProfiler.profileTask` all read the `__classification` result from context instead of re-running regex, ensuring one call per request.

## v0.56.0 ÔÇö Universal Prompt Decomposition, Multi-Step Execution, and Robust Error Recovery

- **Universal prompt decomposition**: All freeform chat prompts are now classified for multi-action intent using a fast cheap LLM (via `completeMaintenance`). When two or more distinct separable actions are detected, AtlasMind decomposes the prompt into a Planner DAG and executes each step with streaming progress ÔÇö no `/project` command required.
- **`processTaskMultiStep`**: New orchestrator method that decomposes, schedules, and streams subtask results incrementally, falling back to a single-step plan on planner failure.
- **Robust error recovery**: All chat modes (freeform, native chat, vision) now retry once with a simplified prompt on failure, then surface actionable feedback (credits, network, no model) instead of raw exceptions.
- **Subtask auto-retry**: `executeSubTask` retries on transient provider errors and empty/capped responses before marking a step failed.

## v0.53.7 ÔÇö Dev Tooling Upgrade

- vitest 2ÔåÆ4, eslint 9ÔåÆ10, TypeScript 5ÔåÆ6 ÔÇö all 890 tests pass, zero lint warnings.
- Token count formatting pinned to `en-US` locale for consistent CI output across all platforms.

## v0.53.6 ÔÇö Live Local Model Sync

- New `src/providers/localModelSync.ts` queries Ollama and LM Studio on activation, extracting real context windows, parameter counts, and quantisation from the live API. Results cached with 1-hour TTL and applied as highest-priority metadata.
- Local provider pricing always forced to zero in `inferModelMetadata` ÔÇö no more cloud pricing heuristics leaking into local models.

## v0.53.5 ÔÇö Local Model Static Catalog

- `LOCAL_CATALOG` added to `modelCatalog.ts` covering 30+ common Ollama model families (Gemma 3, Nemotron, Devstral, Mistral, Qwen 2.5/3, Llama 3, Phi, DeepSeek R1 distills, Codestral, Command R). All entries have zero pricing and accurate capability flags.
- `inferCapabilities` updated so small local models don't get `function_calling` by default.

## v0.53.4 ÔÇö Local Model Routing Fixes

- `scoreLocalPreference` replaced with capability-gated graduated bonus (max +0.4), eliminating over-preference for weak local models.
- `classifySpeedTier` now returns `'balanced'` for local models so they are not excluded from `speed: 'considered'` routing.
- `shouldPreferLocalToolCapableModelForPrompt` tightened: threshold 8 ÔåÆ 5 words, complexity verbs and scope words now suppress local-first routing.

## v0.53.3 ÔÇö Failover And Agent Prompt

- `selectProviderFailoverModel` rewritten to step through budget/speed tiers incrementally rather than immediately jumping to expensive/considered.
- `DEFAULT_AGENT_SYSTEM_PROMPT` now names specific files per change type rather than giving vague release-hygiene guidance.

## v0.53.2 ÔÇö Documentation Matrix Fixes

- `CLAUDE.md` and `.github/copilot-instructions.md` doc matrix now includes `docs/configuration.md` for settings changes and `README.md (version banner)` for version bumps.
- Architecture docs updated for CurrencyFormatter, CopilotMultiplierSync, LocalModelSync.

## v0.52.9 ÔÇö Changelog Guardrail

- Restored the missing CHANGELOG title and intro block so release notes keep their expected structure
- Added an automated regression check and authoring guidance so future edits preserve the heading

## v0.52.9 ÔÇö Release Hygiene And Merge Reliability

- Restored the changelog heading guardrails and kept the protected merge gate stable across integration auditing, default-agent fallback behavior, and cross-platform verification
- Atlas also preserves the recent paste-handling and tool-failure recovery improvements included in this release line

## v0.52.6 ÔÇö Integration Audit Restore

- Restored the missing integration-monitor manifest so the protected CI release gate can validate extension, provider, and specialist coverage again

## v0.52.5 ÔÇö CI Release Cleanup

- Cleared the release-blocking lint issues across the command, environment, chat, dashboard, and testing surfaces so the protected master promotion flow can pass cleanly

## v0.52.4 ÔÇö Intent Routing And Release Hygiene

- Tightened Atlas chat intent handling so prompts about missing version or changelog updates stay on the corrective workspace-action path instead of collapsing into a simple version reply
- Hard-coded release-hygiene guidance into the default agent prompt so version bumps, changelog updates, and related docs are treated as part of completing the work when repo policy requires them

## v0.52.3 ÔÇö Search And Stop Reliability

- Repaired the search jump helpers so previous and next arrows can move through results reliably again
- Wired prompt cancellation through the active chat execution path so Stop can interrupt answer generation more reliably

## v0.52.2 ÔÇö Search Centering And Jump Fix

- Active search results now center themselves in the transcript and outline the containing bubble for clearer orientation
- Previous and next arrows now produce a stronger visual jump between matches

## v0.52.1 ÔÇö Session Search Recovery

- Repaired the in-thread search path so Search no longer stalls on a perpetual running message
- Kept multi-result navigation responsive with visible arrows and active highlight movement inside the transcript


## v0.51.9 ÔÇö Live Gap Analysis Chat Sessions

- Gap Analysis now opens a fresh Atlas chat session and reports progress there while it works
- The completed checklist is saved back into the Project Dashboard automatically

## v0.51.9 ÔÇö Search Navigation And Count Fix

- Session search now counts matches from the visible rendered transcript so totals align with what the operator sees
- Added previous and next result arrows beside Search for direct in-thread navigation across multiple matches

## v0.52.0 ÔÇö Prioritized Gap Analysis Reports

- Gap Analysis now produces a richer project report with grouped P1, P2, and P3 findings across architecture, safety, functionality, UI/UX, memory, code structure, testing, and delivery
- Each gap can now open its own live Atlas chat resolution session, and whole priority groups can be actioned at once

## v0.51.8 ÔÇö Instant Session Search Repair

- Session search now runs immediately against the current in-memory thread so small conversations respond instantly
- Restored match highlighting and transcript scrolling without getting stuck on a perpetual searching state

## v0.51.7 ÔÇö Session Search Feedback Fix

- Pressing Search in the chat panel now immediately shows a running status and a clear found-or-not-found result message
- Reconnected the search toggle to the live webview controls so session search mode behaves reliably

## v0.51.6 ÔÇö Chat Bubble Delete Refresh

- Replaced the header X delete control with a minimalist footer trash icon beside the chat vote actions for a cleaner transcript layout
- Preserved in-thread message deletion while reducing visual clutter in each bubble

## v0.51.7 ÔÇö Live Gap Analysis Sessions

- Gap Analysis now opens a fresh Atlas chat session and reports progress there while it works
- The completed checklist is written back into the Project Dashboard automatically

## v0.51.6 ÔÇö Gap Analysis Trigger Feedback

- Gap Analysis now opens its dashboard page immediately and shows live progress while it runs
- Fixed the silent-looking trigger behavior from the Project Dashboard

## v0.51.5 ÔÇö Project Dashboard Recovery

- Restored the Project Dashboard after the new Gap Analysis work injected broken panel and webview code that stopped the dashboard from opening
- Safely reconnected the Gap Analysis page, actions, and snapshot parsing so the dashboard loads again

## v0.49.37 ÔÇö Chat Focus Guard

- Guarded automatic Atlas chat composer focus restoration so transcript refreshes no longer steal the editor cursor after the user clicks back into another VS Code surface

## v0.49.36 ÔÇö Testing Policy Card

- Added a dedicated Testing policy highlight card to the Project Dashboard beside the framework and coverage stats
- Added an optional workspace override label so teams can show their own tests-first wording without changing AtlasMind's verification safeguards

## v0.49.36 ÔÇö In-Chat Generated Skill Review

- Warning-level generated-skill reviews now appear in the AtlasMind in-chat approval stack instead of a separate modal flow
- The approval card now shows the warning context and a focused one-time Allow Once versus Keep Blocked choice

## v0.49.35 ÔÇö Generated Skill Review Gate

- Auto-generated skills that hit warning-level scanner findings now pause for explicit user approval before AtlasMind evaluates them in-process
- Added a review-first path so operators can inspect the draft and either allow it once or keep it blocked for refinement

## v0.49.34 ÔÇö Project Dashboard Testing Explorer

- Moved the main testing inventory into the Project Dashboard so test health is shown alongside runtime, delivery, and SSOT signals
- Added searchable and category-grouped per-test browsing with a jump dropdown plus a detail inspector that opens the relevant source file at the right line

## v0.49.33 ÔÇö MCP Intent Heuristics And Memory Recall

- AtlasMind now derives natural-language routing cues for third-party MCP tools, biases tool selection toward the most likely match for prompts like ÔÇ£commitÔÇØ, and asks for clarification when multiple tools look similarly plausible
- Successful natural-language-to-MCP resolutions are now written into project memory so future turns can reuse that learned mapping

## v0.49.32 ÔÇö Keyboard Rename In Sessions

- Made F2 rename use the currently focused Sessions sidebar item so keyboard rename now works reliably for chat threads and session folders

## v0.49.31 ÔÇö Marketplace Badge Replacement

- Replaced the external README Marketplace badge with a plain version callout so the extension page no longer shows a broken or retired badge placeholder in VS Code surfaces

## v0.39.7 ÔÇö Immutable Guardrails Baseline

- Added a non-overrideable legal and human-respect baseline to built-in and routed AtlasMind agent prompts
- Restricted jurisdictionally ambiguous legal asks to safe high-level guidance and blocked person-targeted harmful, defamatory, or deceptive assistance in generated tools

## v0.39.6 ÔÇö Sidebar Default Order

- Reordered the default AtlasMind sidebar tree views to Project Runs, Sessions, Memory, Agents, Skills, MCP Servers, and Models
- Set those tree views to ship collapsed by default while keeping stable view ids so VS Code continues remembering each user's custom order and open-state preferences

## v0.39.6 ÔÇö Sidebar Quick Actions

- Added title-bar shortcuts for Settings, Project Dashboard, and Cost Dashboard across the Chat, Sessions, and Memory sidebar views
- Switched the project-memory toolbar action between `Import Existing Project` and `Update Project Memory` based on whether AtlasMind has detected workspace SSOT state

## v0.39.4 ÔÇö Command Naming Guardrails

- Hid the remaining unprefixed session actions from the Command Palette and added a manifest-level guard so unprefixed command titles stay view-local
- Split the README command reference into explicit Command Palette and Sidebar Actions sections

## v0.39.3 ÔÇö Command Surface Cleanup

- Hid sidebar-only actions from the Command Palette so palette-visible AtlasMind commands stay reserved for top-level entry points
- Split the command docs between palette-facing AtlasMind commands and view-local sidebar actions

## v0.39.2 ÔÇö Persistent Memory Drift Signal

- Added a pinned warning row at the top of the Memory tree so stale imported SSOT remains visible while browsing entries
- Treated legacy `#import` SSOT files without Atlas metadata trailers as stale imported memory so older projects also surface the refresh signal

## v0.39.2 ÔÇö Skills Panel Folders

- Grouped built-in skills into sidebar categories so the bundled set no longer expands as one flat list
- Added persistent custom skill folders, including a Skills title-bar `Create Skill Folder` action and folder-aware add/import flows
- Added `F2` rename support for highlighted chat-session rows in the Sessions sidebar

## v0.39.0 ÔÇö Filed Session Sidebar

- Added persistent folders to the Sessions sidebar so related chat threads can be filed together instead of staying in one flat list
- Added an inline rename action on each session row plus move-to-folder and create-folder commands in the Sessions tree
- Moved the optional `Import Existing Project` toolbar shortcut from the Sessions view to the Memory view

## v0.38.22 ÔÇö Cost Dashboard Visual Refresh

- Reworked the Cost Dashboard to share the Project Dashboard's stronger visual language with a cleaner shell, animated metric cards, a more professional budget meter, and upgraded model and feedback panels
- Replaced the old checkbox and numeric day input with a topbar visibility toggle and chart-overlay time-range controls inside the Daily Spend panel
- Tightened summary-card layout so the primary spend metrics stay on one row instead of wrapping into a cluttered grid

## v0.38.21 ÔÇö Responsive Chat Sessions Rail

- Made the shared Atlas chat Sessions area responsive so it remains a top strip in narrow layouts and becomes a persistent left sidebar when the webview reaches 1000px wide

## v0.38.20 ÔÇö Dashboard Settings Compatibility

- Fixed the Project Dashboard refresh path so array-backed `autoVerifyScripts` settings from AtlasMind Settings no longer break the dashboard security snapshot
- Added regression coverage for the dashboard configuration compatibility path

## v0.38.19 ÔÇö Inline Chat Feedback Controls

- Moved assistant-response vote controls onto the same footer row as the thinking summary and aligned them to the right edge of the bubble
- Replaced emoji-style thumbs with compact outlined thumb icons for a quieter chat UI

## v0.38.18 ÔÇö Feedback-Aware Cost Dashboard

- Added Cost Dashboard feedback analytics showing per-model approval rate, thumbs totals, and spend on rated models
- Added `atlasmind.feedbackRoutingWeight` so thumbs-based routing bias can be disabled or tuned without clearing vote history
- Updated recent-request rows to show the recorded feedback state for each linked assistant response

## v0.38.17 ÔÇö Chat Session Header Fit

- Tightened the shared Atlas chat Sessions header so the new-session control stays inline with the label and no longer pushes the collapsible bar partly out of view

## v0.38.16 ÔÇö Cost To Chat Deep Links

- Added session-aware links from Cost Dashboard recent-request rows back to the matching chat transcript entry when the session still exists
- Stored optional chat session and message references with cost records so AtlasMind can reopen the exact assistant response that produced a charge

## v0.38.14 ÔÇö Memory Freshness Signals

- Added startup SSOT freshness checks for imported workspaces so AtlasMind can warn when generated memory has drifted behind the codebase
- Added an `Update Project Memory` Memory-view action that reruns the import pipeline against the latest workspace state
- Fixed import body fingerprint normalization so unchanged generated files are not treated as manually edited or permanently stale on later refreshes

## v0.38.13 ÔÇö Cost Dashboard Polishing

- Sent the Cost Dashboard budget shortcut to Settings ÔåÆ Overview with a budget-focused query instead of reopening the last active settings page
- Clarified the recent-requests table so the final column is explicitly the per-message request cost

## v0.38.11 ÔÇö Dashboard Reliability And Access

- Fixed the Project Dashboard loading path so git timeline collection no longer stalls the panel and failures render a visible error state instead of hanging on the loading screen
- Added a direct Project Dashboard action to the AtlasMind sidebar chat view title bar
- Restored clean TypeScript compilation after the project-memory bootstrap refactor left import-scan metadata incomplete

## v0.38.10 ÔÇö Subscription-Aware Cost Tracking

- Added subscription-aware cost accounting so only direct and overflow-billed requests count toward the daily budget while included subscription usage remains visible for analysis
- Upgraded the Cost Dashboard with adjustable day windows, an exclude-subscriptions toggle, and explicit per-request billing labels

## v0.38.7 ÔÇö Runtime Extensibility And Project Dashboard

- Added an explicit shared-runtime plugin API with lifecycle events and plugin contribution manifests for extension-host and CLI integrations
- Added the AtlasMind Project Dashboard surface with interactive pages for repo health, runtime state, SSOT coverage, security posture, delivery workflow, and review-readiness signals
- Hardened CLI argument parsing and expanded the architecture, development, contribution, and wiki guidance for runtime extensibility, diagnostics, and operational review

## v0.38.6 ÔÇö Final Observability Sync

- Synced the `v0.38.x` roadmap branch with the newly merged workspace-observability base changes so the terminal-reader, extensions/Ports, cost dashboard, and ElevenLabs work remains mergeable on top of the latest `develop` head

## v0.38.5 ÔÇö Final Roadmap Branch Sync

- Synced the `v0.38.x` roadmap branch with the latest `develop` EXA search, workspace observability, and settings-documentation updates while preserving the terminal-reader, extensions/Ports, cost dashboard, and ElevenLabs feature work

## v0.38.4 ÔÇö Settings Docs Sync

- Synced the `v0.38.x` roadmap branch with the latest `develop` settings-documentation updates so it stays mergeable on top of the new configuration hover-help work

## v0.38.3 ÔÇö Roadmap Branch Re-Sync

- Synced the `v0.38.0` roadmap-completion branch with the latest `develop` observability changes while preserving its terminal-reader, extension, Ports, dashboard, and ElevenLabs feature work

## v0.38.2 ÔÇö CI Workflow Repair

- Removed duplicate `if` keys from the CI workflow coverage steps so the `v0.38.x` roadmap branch can execute GitHub Actions normally again after the develop sync

## v0.38.1 ÔÇö Roadmap Branch Sync

- Synced the `v0.38.0` roadmap-completion branch with the latest `develop` fixes so the extension-skill, terminal-reader, Ports, cost dashboard, and ElevenLabs work remains mergeable on top of the newer review-cleanup and lint-gate repairs

## v0.38.0 ÔÇö Roadmap Goals Resolved

- **Terminal session readers** ÔÇö new `terminal-read` skill and `getTerminalOutput()` context method; informs AtlasMind which terminals are open and guides the user to paste content.
- **Test result file parsing** ÔÇö `workspace-state` skill now parses JUnit XML and Vitest/Jest JSON result files and includes pass/fail counts and coverage percentages in the workspace snapshot.
- **VS Code Extensions skill** (`vscode-extensions`) ÔÇö lists installed extensions with version and active state, tags top-50 popular extensions, filters by name, and reports forwarded ports from the VS Code Ports panel.
- **Cost Management Dashboard** (`atlasmind.openCostDashboard`) ÔÇö full-page webview with daily spend bar chart, per-model cost breakdown, budget utilisation bar, and recent-requests table.
- **ElevenLabs TTS integration** ÔÇö Voice Panel now uses ElevenLabs server-side audio synthesis when an API key is configured; falls back to Web Speech API.

## v0.37.4 ÔÇö Workspace Observability

- Added the `workspace-observability` built-in skill plus the supporting debug-session, terminal, and test-result host hooks with safe CLI fallbacks
- Hardened the observability path so missing host hooks degrade safely and test-result output remains bounded

## v0.37.3 ÔÇö Settings Docs Sync

- Synced the `v0.37.x` feature branch with the latest `develop` settings-documentation updates so the EXA search, observability, and CLI subcommand work stays mergeable on top of the new configuration hover-help changes

## v0.37.2 ÔÇö EXA And Observability Branch Sync

- Synced the `v0.37.0` feature branch with the latest `develop` fixes so the EXA search, observability, and CLI subcommand work stays mergeable on top of the newer review-cleanup and lint-gate repairs

## v0.37.0 ÔÇö Observability, EXA Search & CLI Dev Subcommands

- EXA AI search specialist runtime (`exa-search` skill)
- Debug session inspector skill (`debug-session`)
- Workspace state skill (`workspace-state`)
- CLI `build`, `lint`, and `test` subcommands with `--dry-run`, `--fix`, and `--watch` flags
- Amazon Bedrock model catalog expanded with 16 additional entries

## v0.36.26 ÔÇö Lint Gate Repair

- Replaced non-reassigned `let` declarations in the orchestrator task-attempt path so `develop` passes the current lint gate again

## v0.36.25 ÔÇö Review Cleanup Follow-up

- Removed the duplicate Tool Webhooks command entry from the wiki command reference and normalized provider registry indentation to the repo's standard TypeScript style

## v0.36.24 ÔÇö Review Follow-up Fixes

- Repaired the Project Run Center webview string assembly so its preview, run summary, and artifact views no longer generate invalid JavaScript
- Restored a nonce-only script policy for shared webviews, fixed broken CLI wiki links, and normalized the duplicated `v0.36.4` changelog history

## v0.36.23 ÔÇö Workspace Observability Compatibility Fix

- Added safe CLI fallback implementations for workspace observability context methods so the shared `SkillExecutionContext` contract is satisfied outside the VS Code host
- Adjusted workspace observability test-results access so the extension compiles cleanly even when the typed VS Code API surface does not expose a stable `testResults` property

## v0.36.22 ÔÇö Workspace Observability Skill

- Added `workspace-observability` built-in skill: snapshots the active debug session, open integrated terminals, and most recent test run results in one call
- Added `getTestResults()`, `getActiveDebugSession()`, and `listTerminals()` to `SkillExecutionContext`, backed by `vscode.tests`, `vscode.debug`, and `vscode.window.terminals`

## v0.36.21 ÔÇö Extension Interoperability Roadmap

- Expanded the roadmap to cover interoperability with the top 50 commonly used VS Code developer extensions, their interface surfaces such as Output and Terminal, Ports view support, and explicit safety boundaries for extension interaction

## v0.36.20 ÔÇö CI Artifact Upload Fix

- Restricted CI coverage generation and coverage artifact upload to the Ubuntu matrix leg, preventing duplicate artifact-name conflicts while preserving compile, lint, and test coverage across Ubuntu, Windows, and macOS
- Updated the developer-facing docs to reflect the actual CI matrix behavior and Ubuntu-only coverage artifact publishing path

## v0.36.19 ÔÇö CI Repair Follow-up

- Fixed the lint and TypeScript issues that were blocking CI on the protected develop-to-master promotion path

## v0.36.18 ÔÇö Observability Roadmap Additions

- Added roadmap items for workspace observability, debug-session integration, and safe output or terminal readers so AtlasMind can eventually reason over more of the active VS Code environment

## v0.36.17 ÔÇö Workstation-Aware Responses

- AtlasMind now includes workstation context in routed prompts so responses can default to the active environment, including Windows and PowerShell guidance inside VS Code when appropriate
- Added regression coverage for workstation-aware prompt context in native chat and orchestrator message building

## v0.36.16 ÔÇö Provider Failover

- AtlasMind now fails over to another eligible provider when the initially selected provider errors or is missing, instead of ending the task immediately on the first provider failure
- Added orchestrator regression coverage for cross-provider failover after provider-side errors

## v0.36.15 ÔÇö OpenAI Fixed-Temperature Compatibility

- OpenAI modern chat payloads now omit `temperature` for fixed-temperature model families such as GPT-5 and the `o`-series, preventing request failures on models that reject that parameter
- Added regression coverage to keep OpenAI modern, Azure OpenAI, and generic compatible providers on the correct parameter contract

## v0.36.14 ÔÇö Early Difficulty Escalation

- AtlasMind now detects repeated tool-loop struggle signals and can reroute once to a stronger reasoning-capable model instead of spending the full loop budget on a failing route
- Added regression coverage for bounded mid-task model escalation after repeated failed tool calls

## v0.36.13 ÔÇö Grounded Version Answers

- AtlasMind now answers version questions from the root `package.json` manifest instead of depending on model inference
- If the manifest is unavailable, AtlasMind falls back to SSOT memory so repo-fact answers still come from grounded project context

## v0.36.12 ÔÇö Provider-Specific OpenAI Compatibility

- Split OpenAI-family payload handling by provider so OpenAI and Azure use `developer` plus `max_completion_tokens`, while generic OpenAI-compatible endpoints retain `system` plus `max_tokens`
- Added regression tests to lock the expected contract for OpenAI, Azure OpenAI, and third-party OpenAI-compatible providers

## v0.36.11 ÔÇö OpenAI-Compatible Token Parameter Fix

- Updated OpenAI-compatible request payloads to send `max_completion_tokens` instead of `max_tokens`, resolving 400 errors from models that reject the legacy parameter
- Added regression coverage to verify AtlasMind no longer emits `max_tokens` in OpenAI-style chat completion requests

## v0.36.10 ÔÇö Terminal Tool Schema Validation Fix

- Fixed the built-in `terminal-run` tool schema so `args` is declared as an array of strings, resolving chat failures from OpenAI function schema validation
- Added a regression test to keep the terminal tool schema compatible with function-calling providers

## v0.36.6 ÔÇö CLI Safety Gate And Narrower SSOT Auto-Load

- AtlasMind CLI now allows read-only tools by default, requires an explicit `--allow-writes` flag before workspace or git writes are permitted, and blocks external high-risk tools in CLI mode
- Startup SSOT auto-load now trusts only the configured SSOT path or the default `project_memory/` folder instead of treating workspace-root marker folders as sufficient
- Added regression tests covering CLI tool gating and the tightened startup SSOT detection boundary

## v0.36.5 ÔÇö Import Freshness And Memory Purge Safeguards

- `/import` now records generator metadata, skips unchanged generated files on repeat imports, and preserves imported SSOT files that were manually edited
- AtlasMind now generates both `index/import-catalog.md` and `index/import-freshness.md` so memory refresh status stays reviewable
- The Project Settings page now exposes a destructive memory-purge action protected by a modal confirmation plus a required `PURGE MEMORY` confirmation phrase

## v0.36.4 ÔÇö MCP, Voice, And Vision Workspaces

- Reworked the MCP Servers, Voice, and Vision panels into the same searchable multi-page workspace pattern used by AtlasMind Settings and the other admin surfaces
- Added richer sidebar empty-state links so sessions, models, agents, MCP, and project runs can jump directly to the matching panel or settings page

## v0.36.3 ÔÇö Richer Project Import Baseline

- Expanded `/import` so it generates a deeper SSOT baseline from manifests, docs, workflow/security guidance, and a focused codebase map
- Import now upgrades the starter `project_soul.md` template when it is still blank so Atlas begins with a more useful project identity

## v0.36.2 ÔÇö Deep-Linked Panel Workspaces

- Reworked the Agent Manager and Tool Webhooks panels into searchable multi-page workspaces consistent with AtlasMind Settings and the provider surfaces
- Added page-specific settings commands so sidebar actions and walkthrough steps can open the exact chat, models, safety, or project settings page directly

## v0.36.1 ÔÇö Searchable Provider Workspaces

- Reworked the Model Providers and Specialist Integrations panels into searchable multi-page workspaces with grouped cards instead of single dense tables
- Added deep-linkable AtlasMind Settings navigation so provider surfaces can reopen Settings directly on the Models page

## v0.36.0 ÔÇö Shared Runtime And CLI

- Added a compiled `atlasmind` CLI with `chat`, `project`, `memory`, and `providers` commands backed by the same orchestrator and SSOT memory pipeline as the extension
- Introduced a shared runtime builder plus Node-hosted memory, cost, and skill-context adapters so AtlasMind can run outside the VS Code host without forking core logic

## v0.35.15 ÔÇö Accessible Settings Workspace

- Reworked AtlasMind Settings into a multi-page workspace with a persistent section nav instead of a long collapsible form
- Added faster in-panel shortcuts to the embedded Chat view, detached chat panel, provider management, and specialist integrations

## v0.35.12 ÔÇö Startup SSOT Auto-Load

- AtlasMind now auto-detects and loads an existing workspace SSOT during startup when the configured `atlasmind.ssotPath` is missing
- The Memory sidebar now refreshes immediately after startup indexing so existing project memory appears without a manual reload

## v0.35.5 ÔÇö Models Tree Refresh Action

- Added a refresh action on configured provider rows in the Models sidebar so routed model catalogs can be refreshed directly where missing models are noticed

## v0.35.4 ÔÇö Follow-Up Routing Escalation Fix

- Adjusted routing so important thread-based follow-up turns can escalate away from weak local models instead of being dominated by zero-cost local scoring
- Updated the task profiler and router scoring so high-stakes conversation follow-ups can favor stronger reasoning-capable models when appropriate

## v0.35.3 ÔÇö Memory Sidebar Edit And Review Actions

- Added inline edit and review actions to Memory sidebar entries so SSOT files can be opened directly or summarized before editing

## v0.35.2 ÔÇö Get Started Chat Shortcut Fix

- Added a working `Ctrl+Alt+I` (`Cmd+Alt+I` on macOS) shortcut for `AtlasMind: Open Chat Panel`
- Updated the Get Started walkthrough chat buttons to open the AtlasMind chat panel directly

## v0.35.1 ÔÇö Sidebar Settings Shortcut And Optional Import Action

- Added an AtlasMind Settings entry to the overflow menu of AtlasMind sidebar views so the settings panel can be opened directly from the panel itself
- Added an optional Import Existing Project toolbar action to the Sessions view, with a new `atlasmind.showImportProjectAction` setting to hide it when not wanted

## v0.35.0 ÔÇö Session Workspace And Sessions Sidebar

- Upgraded the dedicated AtlasMind chat panel into a session workspace with persistent workspace chat threads and a session rail
- Added a Sessions sidebar view that lists chat sessions and autonomous runs together, with direct handoff into the Project Run Center for live run steering

## v0.34.2 ÔÇö Deferred Copilot Permission Prompt

- Deferred GitHub Copilot model discovery and health checks until explicit activation so AtlasMind no longer prompts for Copilot language-model access during normal startup

## v0.34.1 ÔÇö NVIDIA NIM Model Info Link Fix

- Corrected the NVIDIA NIM model info link so AtlasMind opens NVIDIA's model catalog instead of an unrelated API page

## v0.34.0 ÔÇö Dedicated AtlasMind Chat Panel

- Added a dedicated AtlasMind chat panel for users who want a standalone conversation UI instead of only the built-in VS Code Chat view
- Added a Settings shortcut and command-palette entry for opening the panel

## v0.33.1 ÔÇö Copilot Chat Recommendation Cleanup

- Updated the repo and bootstrap-generated VS Code extension recommendations to prefer `GitHub Copilot Chat` without also prompting for the separate `GitHub Copilot` recommendation

## v0.33.0 ÔÇö Azure OpenAI, Bedrock, And Specialist Integrations

- Added routed provider support for Azure OpenAI with deployment-based workspace configuration and `api-key` authentication
- Added routed provider support for Amazon Bedrock through a dedicated SigV4-signed adapter
- Added a Specialist Integrations panel for non-routing search, voice, image, and video vendors

## v0.32.10 ÔÇö Default Branch And Release Flow Hardening

- Switched the repository default branch to `develop`
- Locked `master` to the `develop` to `master` pre-release promotion flow
- Updated contributor and Copilot guidance to treat `develop` as the normal development push target

## v0.32.9 ÔÇö Branch Strategy Update

- Adopted `develop` for normal integration work and reserved `master` for release-ready pre-release publishing
- Updated CI to validate both `develop` and `master`
- Updated contributing guidance and Copilot instructions to avoid routine direct work on `master`
- Fixed local provider health reporting so the built-in echo fallback remains available even without a configured local endpoint

## v0.32.7 ÔÇö Mixed Provider Status Marker

- Added a bracketed warning marker for partially enabled providers in the Models sidebar while preserving the green enabled status icon

## v0.32.6 ÔÇö Models Status Icon Cleanup

- Replaced visible Models sidebar status text with colored status icons
- Sorted unconfigured providers to the bottom of the Models list

## v0.32.5 ÔÇö Configurable Local Provider

- Added a real configurable local provider path backed by `atlasmind.localOpenAiBaseUrl` and an optional SecretStorage API key
- Local provider setup can now be completed directly from the Models and Model Providers surfaces

## v0.32.4 ÔÇö Provider Configuration And Agent Assignment

- Added inline provider configure and assign-to-agent actions in the Models sidebar
- Added model-level assign-to-agent actions for quick `allowedModels` updates
- Hid child model rows for unconfigured providers until the provider is configured

## v0.32.3 ÔÇö Models Sidebar Controls

- Added inline enable/disable and info actions to provider and model rows in the Models sidebar
- Persisted provider/model availability choices so routing keeps honoring them after restarts and model catalog refreshes

## v0.32.2 ÔÇö Agent Restore Activation Fix

- Removed the activation-time dependency on the Agent Manager webview so persisted user agents can be restored without loading panel UI code during startup

## v0.32.1 ÔÇö Lazy Command Panel Loading

- Changed AtlasMind command handlers to lazy-load panel modules so panel-specific runtime issues cannot block command registration during activation

## v0.32.0 ÔÇö Getting Started Command

- Added `AtlasMind: Getting Started` so the onboarding walkthrough can be reopened directly from the Command Palette
- Carries forward the recent Agent, Skills, and MCP panel reliability fixes in the beta channel

## v0.31.4 ÔÇö Agent & Skills Panel Reliability Fixes

- Replaced CSP-blocked inline button handlers in the Manage Agents panel with explicit event bindings
- Restored the New Agent, edit, enable/disable, delete, save, and cancel actions
- Registered commands and tree views earlier in activation so Skills and MCP panel actions are available sooner
- Isolated startup registration failures so one broken surface cannot prevent command registration for the others

## v0.31.2 ÔÇö Walkthrough Activation Fix

- Activated AtlasMind on startup so getting-started walkthrough buttons are available immediately after install
- Added manifest regression tests covering the provider onboarding button wiring

## v0.31.1 ÔÇö Marketplace Beta Release

- Switched the extension icon from SVG to PNG for Marketplace compatibility
- Added the top-level extension icon field and updated the publisher to `JoelBondoux`
- Published the first live beta release to the VS Code Marketplace

## v0.30.5 ÔÇö README Cleanup

- Streamlined the README into a shorter overview and onboarding page
- Moved detailed inventories and reference material into deeper docs and wiki pages

## v0.30.4 ÔÇö CI Fixes And Wiki Refresh

- Fixed the lint issues that were failing CI and restored a passing coverage gate for the currently tested service-layer modules
- Clarified model-routing documentation around seed models, runtime catalog refresh, and metadata enrichment
- Added a funding and sponsorship wiki page and refreshed the wiki comparison content

## v0.30.3 ÔÇö Copilot Chat Recommendation Restored

- Restored `GitHub Copilot Chat` in extension recommendations for the repo and bootstrap templates
- Updated setup guidance and Copilot runtime wording to point users back to `GitHub Copilot Chat`

## v0.30.2 ÔÇö Copilot Dependency Cleanup

- Removed the deprecated `GitHub Copilot Chat` recommendation from the repo and bootstrap templates
- Updated setup guidance to point to the `GitHub Copilot` extension instead
- Renamed Copilot UI/error wording from `Copilot Chat` to `Copilot language model` / `Copilot Model`

## v0.30.1 ÔÇö Trust & Freshness Fixes

- **Real daily budget enforcement** ÔÇö `dailyCostLimitUsd` now blocks new requests once the cap is reached
- **Live provider health refresh** ÔÇö Status bar updates immediately after key save and model refresh
- **Run Center disk hydration** ÔÇö Project Run Center and project runs tree now consume async disk-backed history
- **Settings quick actions** ÔÇö Direct buttons for Chat, Model Providers, Project Run Center, Voice, and Vision
- **Budget control in Settings** ÔÇö `dailyCostLimitUsd` is now editable in the Settings panel

## v0.30.0 ÔÇö UX & Feature Overhaul

- **Getting Started walkthrough** ÔÇö Four-step guided onboarding for new users
- **API key health check** ÔÇö Immediate validation after storing a provider key
- **Collapsible settings panel** ÔÇö Grouped, collapsible sections replace the flat wall of options
- **Cost persistence and daily budget** ÔÇö Session costs persisted to globalState; `dailyCostLimitUsd` setting with 80%/100% alerts
- **Streaming for Anthropic + OpenAI** ÔÇö Full `streamComplete()` with SSE parsing and tool-call handling
- **Agent performance tracking** ÔÇö Success/failure tracking influences future agent selection
- **Cost estimation in plan preview** ÔÇö `/project` shows estimated $lowÔÇô$high cost before execution
- **Disk-based run history** ÔÇö Individual JSON files replace single-blob globalState storage
- **Diff preview in project report** ÔÇö File/status table and "Open Source Control" button in report
- **Multi-workspace folder support** ÔÇö Quick-pick when multiple folders are open
- **Per-subtask checkpoint rollback** ÔÇö Rollback by task ID instead of last-only
- **Memory tree pagination** ÔÇö Incremental loading with "Load moreÔÇª" instead of hard 200-entry cap
- **Provider health status bar** ÔÇö Shows how many providers have valid API keys
- **Expanded task profiler** ÔÇö 100+ new keywords for more accurate task classification
- **Integration test suite** ÔÇö Full orchestrator ÔåÆ agent ÔåÆ cost ÔåÆ performance lifecycle tests

## v0.29.0 ÔÇö Constants, Shared Validation & Zod

## v0.28.x ÔÇö Project Import & Stability

- **`/import` command** ÔÇö Scan existing workspaces and auto-populate SSOT memory from manifests, READMEs, configs, and license files
- **TypeScript fixes** ÔÇö Added `"types": ["node"]` to tsconfig for full Node.js global support
- **Documentation overhaul** ÔÇö Comprehensive README rewrite with logo, comparison table, and complete feature coverage

## v0.27.x ÔÇö Skills Gap Analysis & README

- **11 new skills** ÔÇö `code-symbols`, `rename-symbol`, `code-action`, `web-fetch`, `diff-preview`, `rollback-checkpoint`, `test-run`, `diagnostics`, `file-move`, `file-delete`, `git-branch`
- **README overhaul** ÔÇö Logo, competitor comparison table, comprehensive feature documentation

## v0.26.x ÔÇö MCP Integration

- **MCP client** ÔÇö Connect external tool servers via stdio or HTTP transport
- **MCP server registry** ÔÇö Persistent server configs with auto-reconnect
- **MCP tools as skills** ÔÇö External tools seamlessly appear in the skill registry

## v0.25.x ÔÇö Project Planner

- **`/project` command** ÔÇö Decompose goals into DAGs of subtasks
- **TaskScheduler** ÔÇö Topological sort into parallel batches
- **Ephemeral agents** ÔÇö Role-specific agents for each subtask
- **Project Run History** ÔÇö Persistent run records with the Run Center

## v0.24.x ÔÇö Skill Security Scanner

- **Static analysis** ÔÇö 12 built-in rules for custom skill validation
- **Scanner Rules Manager** ÔÇö Configure rules via webview panel
- **Pre-enablement gate** ÔÇö Custom skills must pass scanning before use

## v0.23.x ÔÇö Voice & Vision

- **Voice Panel** ÔÇö TTS and STT via Web Speech API
- **Vision Panel** ÔÇö Image picker for multimodal prompts
- **`/voice` and `/vision` commands**

## v0.22.x ÔÇö Tool Webhooks

- **Outbound webhooks** ÔÇö Forward tool lifecycle events to external HTTPS endpoints
- **Configurable events** ÔÇö tool.started, tool.completed, tool.failed
- **Webhook management panel**

## v0.21.x ÔÇö Cost Tracking & Budget Control

- **CostTracker** ÔÇö Per-session, per-provider cost accumulation
- **Budget modes** ÔÇö cheap, balanced, expensive, auto
- **Speed modes** ÔÇö fast, balanced, considered, auto
- **`/cost` command**

## v0.20.x ÔÇö Multi-Agent Orchestration

- **AgentRegistry** ÔÇö Custom agents with roles, prompts, and constraints
- **Agent selection** ÔÇö Token overlap scoring for best-fit selection
- **Agent Manager Panel** ÔÇö Create and configure agents via webview

## Earlier Releases

See [CHANGELOG.md](https://github.com/JoelBondoux/AtlasMind/blob/main/CHANGELOG.md) for the complete version history.
