# UI Studio

The approved multi-phase path from today's Studio to a complete visual builder is in
[[UI Studio Builder Plan]]. It records requirements and acceptance criteria for the design graph, live
built-in-browser editing loop, responsive layout, components, content/assets/data, repository mappings,
quality gates, agency review, and imports.

**A visual guide for designing an interface and continuing it in the real project.**

Choose website, web app, mobile app, desktop app, editor extension, embedded UI, or another interface.
The shared workflow keeps the brief, screens and flows, words, wireframes, UI-system choices, and
implementation locations together. A website is one richer profile, with its sitemap, SEO, generated
stack, hosting, delivery comparison, and n8n workflow intact. Every profile can generate a sandboxed
HTML/CSS visual guide; for a native target it is explicitly a reference, not the implementation.

**Open it from:** Project Dashboard → Delivery · the Ideation board · **AtlasMind: Open UI Studio** ·
or by choosing **Website / Marketing Site** during `/bootstrap`.

---

## What's in it

| Dashboard | What you use it for |
|---|---|
| **Project Brief** | The interface profile, client/project, goals, audiences, features, content sources, brand notes, constraints, metrics, stakeholders, timing, budget, and one whole-interface prompt |
| **Sitemap / Screens & flows** | Websites use pages and slugs; other profiles use screens and route/view identifiers. Both map hierarchy and navigation |
| **Content Design** | Voice, principles, terminology, comprehension target, locales and accessibility rules, plus the real Markdown copy and states for each screen |
| **Wireframe canvas** | Draw the page by dragging blocks onto a grid. Select anything and describe it in your own words. Per-page design prompts, and the draft → review → approved states for wireframe, design, content and SEO |
| **UI System** | Brand direction and legacy defaults plus editable typed tokens, reusable component definitions, bounded sample-data collections, and validated assets |
| **Implementation** | Target technologies, UI source roots, component locations, handoff notes, and explicit design-to-source mappings with divergence status. Website profiles also add stack, setup, hosting, and Delivery comparison |
| **n8n Automations** | Website-only workflow mapping: event, outcome, readiness, references, and data/privacy notes |

Format v7 stores bounded typed colour, typography, spacing, radius, shadow, motion, and breakpoint definitions
with same-kind acyclic aliases. UI System now edits them directly through the same revision and undo history as
the canvas. Reserved semantic ids apply to Studio and Full Preview; all resolved definitions remain available
to adapters under uniquely encoded custom properties. The values are target-independent structured data,
not CSS declarations, so native and non-HTML projects retain the same design authority.

Format v8 adds reusable components without turning the graph into HTML. UI System edits each definition's
root type, typed properties, variants, bounded slots, and supported states. The canvas inspector separately
assigns compatible definitions, variants, states, property overrides, and parent slots to explicit instances.
Values resolve default → variant → instance with provenance, so changing an instance cannot quietly rewrite
every use. The migration adds an empty component collection and invents no design decision.

## Design the words too

Content design is now a first-class Studio step. The project-level rules are stored in the reviewable
UI SSOT; actual screen copy stays in the configured Markdown directory so the Studio edits the same
files the project uses. Capture labels, help, validation, empty/loading/error/success states, and
recovery actions beside the main prose.

A missing file can be seeded from the wireframe, but only as loud `[PLACEHOLDER: …]` gaps—never
fictional copy that looks reviewed. Saving checks that the file body still matches the version opened;
an external edit causes a refusal and reload instead of an automatic merge.

The canvas inspector separately designs short empty/loading/error/success messages at the node that owns them.
Each presentation records title, body, action label, and visible maturity, and an authored state can be selected
for in-context Studio/Full Preview review. This does not replace long-form Markdown, and placeholder-marked copy
cannot be approved. Format v9 adds no state copy during migration.

Format v10 adds structured preview-only collections with bounded text, number, boolean, HTTPS URL, and date
fields plus deliberate sample records. Select a canvas node to map title, body, and action slots to one sample.
Studio and Full Preview render the same declared values and show their collection/sample provenance. Used
fields, samples, and collections cannot be removed underneath a binding; a stale hand-edited reference is
reported at its owning node together with any missing empty/loading/error/success design. Production records,
credentials, and live connectors stay outside this authority, and migration invents no sample data.

Format v11 adds validated asset metadata: stable id, closed media kind, normalized workspace-relative or
credential-free HTTPS source, intrinsic dimensions, crop/focal intent, alt/decorative intent, and maturity.
Assign an asset from the selected-node inspector. Missing ids and missing alt text are owning-node errors.
Full Preview projects the aspect ratio, crop, focal point, provenance, and accessibility status as inert markup;
it does not fetch media or widen the no-network CSP. Migration adds an empty library and invents nothing.

Format v12 adds **repository mappings** in Implementation. Connect a component, token, or canvas node to a
workspace-relative source file and optional export/selector/resource name through the React, static HTML/CSS,
VS Code webview, or limited custom adapter. Component mappings can name prop and slot correspondences; every
record says whether coverage is declared, partial, or unsupported and lists limitations where required.

**Verify fingerprints** reads the bounded local file and stores hashes—not source—to establish a comparison
baseline. The status then distinguishes design-only, code-only, conflict, in-sync, unassessed, and unsupported.
It never chooses a side, parses or executes code, or writes the project. Editing a mapping clears its old
baseline. Proposed source diffs remain later Phase 5 work and are not implied by the mapping.

Format v13 adds **Import source evidence**. React recognizes exports and simple props/slots; static HTML/CSS
recognizes literal selectors and custom properties; VS Code webview recognizes host exports and literal web
facts; custom says unsupported. Every built-in report is partial and lists what it could not evaluate. It
retains bounded facts, exact-match suggestions, adapter/graph/source provenance, and no source excerpt.

Use **Copy exact-match suggestions into form** to review detected correspondences. Nothing becomes mapping
authority until **Apply mapping** runs separately, and no import edits the graph or project source. Reports
remain visible and are labelled stale after either side changes. Proposed source diffs and their approval/
post-change verification boundary remain the next Phase 5 work.

---

## Drawing the page

Pick a block — nav, hero, section, grid, card, image, text, form, call to action, sidebar, footer —
and drag on the grid to draw it. Resize from any of the eight handles. Drop a card inside a grid and
it nests. Arrow keys nudge the selection, Shift moves it a whole column, Delete removes it.
Ctrl/Cmd+Z undoes and Shift+Ctrl/Cmd+Z redoes. Drawing, movement, resizing, nesting, deletion, kind, label,
and intent edits all use the same revision-checked graph command path; the webview never submits a graph patch.

Shift/Ctrl/Cmd-click builds a multi-selection with one primary inspector target. Align six ways, distribute
three or more blocks across or down, nudge the group, or drag the complete selection by any selected block at
any breakpoint; the whole transform is one validated revision and undo step. Group drag preserves spacing,
clamps the complete bounds, and never reparents. Multi-delete is deliberately unavailable until the selection
is narrowed.

The active breakpoint also shows deterministic layout/content/asset findings: viewport overflow,
child/parent clipping, unintended overlap, interactive blocks below a 44px touch target, broken bindings,
missing interface states, missing asset ids, and missing alt text. A clear state means every check ran.
Clicking a finding selects its owning block and shares that selection with Full Preview. Parent/child overlap
and overlay siblings are treated as intentional rather than noisy warnings.

Selecting a container exposes free, stack, grid, and overlay behaviour plus direction, gap, padding, columns,
alignment, distribution, and fixed/fill/hug sizing. The host projects direct children identically in the
canvas and full preview. Stored rectangles remain intact underneath, so reset, free mode, and undo restore
the drawn arrangement. The same behaviour can inherit or be deliberately overridden at tablet/mobile.
Any node can also set optional min/max width and height in canvas units. These bounds inherit and reset with
layout behaviour, clamp only the projected size, and never erase the retained drawn/intrinsic rectangle.
Stacks can wrap, and a bounded responsive order determines the sequence of container children before stable
geometry/id tie-breakers. These remain projections too: they never reorder stored nodes or alter hierarchy.

Duplicate copies the selected block and its complete nested subtree as one undoable base-breakpoint edit,
remapping identities and offsetting explicitly authored responsive rectangles too. Lock keeps a block
selectable and inspectable while preventing gestures, inspector changes, group transforms, deletion, and
duplication until Unlock is chosen.

A few things behave the way they do on purpose:

- **Delete a wrapper and what was inside it moves up a level** rather than disappearing with it. The
  obvious implementation takes six cards with the container and gives you no undo. A locked direct child
  holds that structural edit closed, so the wrapper cannot be deleted until the child is unlocked.
- **Sizes are proportions, not pixels.** The canvas is a 1000-unit grid, so a block that is "most of
  the width" stays that on any screen. Storing pixels would bake your monitor into a file your whole
  team reads.
- **Every block is keyboard-reachable** and announces what it is, how wide it is and roughly where it
  sits. A canvas only a mouse can use would be worse than the table it replaced.

## The sitemap draws itself

You don't draw the hierarchy — it comes from the slugs. Add a page at `/services/seo` and it appears
under Services. Set a parent explicitly and that wins, because a decision you made on purpose beats a
naming convention.

If a page's slug points at a parent that doesn't exist, it sits at the top level **and says so**. It is
not hidden, and it is not quietly attached to whatever is nearest — you get told, and you decide.

Solid lines are parents you set. Dashed lines were worked out from the slug.

## Knowing where each page leads

The inventory shows what each page links to, how many pages link *to* it, and which links point at a
page that isn't there any more. That last one is kept and marked rather than tidied away — it is
exactly the finding you want, because it means a nav is broken.

Nothing links to your front page and nothing needs to, so it is never reported as an orphan.

Nav and call-to-action blocks on the canvas will *suggest* a link when their label matches a page name.
The match is exact or case-insensitive and never looser than that: "Get in touch" quietly wired to "Get
Started" is a wrong answer wearing a right one's clothes. A suggestion never overwrites a link you set.

## Just saying what you want

Click a hero and type "full-bleed photo, headline on the left, one button". Atlas gets a prompt that
names exactly what you selected — what kind of block it is, what it's called, how wide, what's around
it, what contains it, which page it's on, and the colours and type you already chose. That's what makes
"make this wider" a question with an answer.

You can do the same for a whole page and for the whole site.

Anything already stored in the project file is passed along as *quoted material*, not as instructions —
because labels and prompts can be written by a model, and a block named like a command shouldn't become
one. Your sentence is the instruction. And Atlas is told to propose, not to go and change the file.

## Generate, and watch it build

**Generate** appears at every stage, and each stage knows a different amount:

- **From the brief** — a single concept page showing the visual direction.
- **From the sitemap** — every page, each following its own written prompt, linked to the others. This
  is what lets you take a whole site to first-draft design without drawing anything.
- **From the canvas** — that page, with the layout you actually drew.
- **From a selected element** — that page again, reworked around the block you picked.

Before anything happens you get a dialog **listing every file** that will be written. It can be that
specific because the list is worked out before any model runs — the same sitemap always produces the
same list, so "yes" means something you can learn.

Whatever the stage couldn't account for is reported *with* the result, not just before it: generating
from a brief cannot honour a layout that doesn't exist yet, and a partial answer filed as a complete one
is the kind of thing you only discover much later.

Files go **only** to `.atlasmind/website-preview/`. Your source tree is never touched — moving an
approved design out of the preview folder is a separate, deliberate step. Nothing executable is
generated at all.

The full result renders in VS Code's built-in browser; a guarded companion window provides fixed
responsive widths. The little server behind both listens on `127.0.0.1` only, serves nothing but the
preview folder, has no directory listing, and puts a random one-time token in its address so nothing
else running on your machine can guess the port and read your client's unfinished work. Stop it with
**Stop Preview**, by closing UI Studio, or by deactivating the extension.

Both switches — generating files, and opening the preview port — are **off until you turn them on**,
and they're two switches rather than one because they're genuinely two different decisions.

---

## Choosing a stack, and having it set up for you

The framework and the host are one choice, not two. "Astro on Cloudflare Pages" decides your build
command, your output directory and your deploy config together — so picking them on separate pages
just meant you had to already know which combinations work.

Ten frameworks, each graded against the platform you've chosen, each with the reason on the card.
Incompatible ones stay visible: pick Shopify and Hugo is still there, marked unsupported, explaining
that Shopify serves Liquid templates from its own theme system so a separate build has nowhere to go.
Hiding it would just leave you wondering.

Some frameworks — plain HTML, WordPress themes, anything you'd call "something else" — get **no**
automatic setup, and say so. An improvised command that usually works is worse than an honest gap when
the failure lands in your repository.

**Set up this stack** runs the framework's own create command, writes the deploy config for your host,
adds the dev and build scripts, writes a `.env.example` with the variable names and no values, and
creates your develop, staging and production branches. Switch on CI generation and it writes a GitHub
Actions workflow deploying each branch to its own environment.

You see everything first — every command with what it's for, every file with its complete contents,
including the whole workflow. There's a **Show files first** button if you'd rather read them as real
documents before deciding.

What it will and won't do:

- **Never overwrites anything.** An existing config file, script, branch or workflow is left alone and
  reported. Run setup as many times as you like.
- **Never uses a shell.** Commands are constants in AtlasMind's source, run directly with an argument
  list.
- **Only ever creates branches** — never checks out, pushes, or forces.
- **Checks afterwards.** A create command can exit successfully having done nothing; the report comes
  from looking at your files.
- **Won't touch your hosting account** unless you explicitly allow it. `wrangler pages project
  create` and friends authenticate as you and create things you'll be billed for, so by default you
  get the command and run it yourself.

### The generated workflow

This one has its own switch, off by default, because it's the only thing AtlasMind generates that
**runs on its own** — on GitHub, with your secrets, on a push nobody reviewed it for.

It's built from a fixed template with only checked values filled in, never by a model. Production
deploys declare a GitHub Environment, so you can require reviewers there and not rely solely on
AtlasMind's confirmation. Secrets are named, never written — you're told which to add and where.
Permissions are explicit rather than inherited, and two pushes to the same branch queue rather than
racing. If AtlasMind has no verified deploy action for your platform, it refuses to write a workflow
rather than guessing at one.

### Cross-checking against Delivery

Website Studio's three environments and the Delivery page's stages are two separate records of the
same thing, which means they can drift apart. Rather than pretend otherwise, the Stack page compares
them and tells you exactly which fields disagree and what each side says. Before you've compared them,
it says that too — an unchecked pipeline shouldn't look like a clean one.

Syncing is deliberately cautious. An empty box in the Studio never wipes a real value in Delivery, and
sync can add promotion protection but never remove it — a planning page shouldn't be able to take away
a guard the promotion runner depends on.

---

## Full preview

Full Preview is step 6 of UI Studio and the main place to judge the design as a whole. **Rebuild and
open** launches VS Code's built-in browser with a deterministic index built from the saved wireframe,
UI tokens, resolved component variants/states, and exact Markdown content. Each screen includes a complete
content proof below its spatial canvas, so copy clipped by a fixed wireframe box cannot disappear from
review. `[PLACEHOLDER: …]` markers remain visibly unfinished.

Use the separate **Responsive lab** for Fit, Desktop 1280, Tablet 834, and Mobile 390 widths. It shares
the same guarded loopback server and URL as the full browser. If a model-generated visual guide exists,
the index links to it separately; it never replaces the live Studio draft.

The deterministic draft now projects the saved responsive graph at those widths. Desktop values inherit
through tablet into mobile; explicit geometry and visibility overrides replace only the properties they
name, and clearing one restores inheritance. The projection is static CSS, so responsive review adds no
new browser command, storage, or write capability.

The Studio canvas now offers the same Desktop, Tablet, and Mobile views. Its inspector shows computed
geometry, visibility, layout and sizing together with the breakpoint each property came from. Apply or reset
responsive geometry and visibility independently; hidden nodes stay faintly selectable in the editor while
remaining absent from the full preview. Dragging, resizing, or arrow-key nudging at a non-base breakpoint
creates a deliberate geometry override with normal undo/reset. Drawing, nesting, deletion, and parent changes
stay on the base breakpoint because they alter shared structure.

Saving structure, content, or UI-system changes rebuilds preview artefacts while the server is running.
The built-in browser receives the new render revision and reloads automatically. Select a saved block in
Studio to highlight it in the full preview; click a preview block to focus it back in Studio. The frozen
runtime may submit only the current revision and bounded screen/node IDs, which the host resolves against
the saved graph. It cannot submit edits, paths, commands, graph fragments, or source code. The Responsive
lab remains scriptless and is refreshed by AtlasMind itself.

## Seeing the wireframe

Open the preview and you see your drawing — immediately, with no model call and no waiting. Every block
is obviously a placeholder: hatched, dashed, labelled. Text is grey bars rather than lorem ipsum, images
are crossed rectangles rather than stock photos, and your nav shows the real page names from your
sitemap because those are actual facts.

The banner says outright that nothing on the page is real content, which matters more than it sounds:
the whole failure mode here is a page that *looks* finished getting signed off.

Generated pages and wireframes live side by side, so pressing Generate never overwrites your drawing.
The deterministic design index stays the preview entry point, with generated output one click away.

## Writing the copy

Page copy lives in **markdown files under `content/`**, one per page. Hand them to a copywriter, edit
them in any editor, review them in a pull request like anything else.

Where the words aren't written yet, leave a marker:

```
[PLACEHOLDER: two paragraphs on how the firm started — needs the founder interview]
```

AtlasMind **counts** those. A page reads as "four placeholders remaining" rather than a status somebody
ticked, and generation is explicitly told to leave them visible rather than helpfully inventing
something. That instruction is the point of the whole feature.

A couple of behaviours worth knowing:

- **A page with no file and a page with an empty file are different things.** One hasn't been started;
  the other was started and left blank. AtlasMind never reports the first as "0 placeholders".
- **The file always wins.** Edit the markdown while the Studio has it open and the Studio's save is
  refused rather than merged — automatically combining two versions of your prose produces something
  neither of you wrote.
- Seeding a starter file writes **only placeholders**, one per section you drew. Never draft prose.

## Client feedback on the actual thing

Your client opens the staging site, clicks the element they want to talk about, and types. The comment
lands against *that element*, and turns into scoped work with one click.

- Comments move through open → addressed → resolved (or "not doing"), and are **never deleted** —
  "we fixed it" and "we decided not to" are different things worth keeping apart.
- Anything resolved can be re-opened, because "still not right" is the commonest event in a review.
- **Delete an element somebody commented on and the comment survives**, flagged, still saying what it
  was about. That's the evidence the thing was removed mid-review, and it's exactly the comment that
  would otherwise vanish.

**AtlasMind doesn't host any of this.** The overlay ships inside your site, so it travels to the
password-protected staging environment the Stack page already sets up — your client's own hosting. They
get a normal URL.

Feedback comes back either as a file they download and send you (import it with **AtlasMind: Import
Website Client Feedback**), or by POST to an endpoint you already own if you've configured one. Without
one, the page can't make a network request at all — no endpoint is ever invented, because a guessed URL
would send your client's feedback to a stranger.

Re-importing the same file is safe: nothing duplicates, and nothing you've already resolved gets
re-opened.

What this deliberately can't do — no live presence, no threaded replies, and comments sit in your
client's browser until they send them — is written up in
`project_memory/decisions/website-client-review-hosting.md`, along with why we didn't build a hosted
relay.

---

## Getting a brief in without retyping it

The Brief dashboard accepts **JSON** — from your intake form, a CRM export, or an n8n workflow that
normalises it.

You don't have to match AtlasMind's field names exactly. It understands common aliases (`companyName`
becomes the client name, `objectives` becomes goals, `targetAudience` becomes audiences, `kpis` become
success metrics), accepts fields at the root or nested under `client` or `website`, and takes list
fields as either arrays or line-separated text.

Anything missing from the import **leaves your existing value alone** rather than blanking it.

---

## The three environments

Every project gets the same three-stage path, and the rules for each are fixed:

| Environment | How it's hosted | What it's for |
|---|---|---|
| **Develop** | Local only by default. If local hosting isn't possible, a hosted fallback requires HTTPS *and* a password | Building it, and private team QA |
| **Staging** | Hosted, HTTPS, password-protected, at `<review-label>.<production-domain>` | Client review and sign-off |
| **Production** | Hosted, public, promotion-protected | The live site |

Each shows as `ready`, `needs-setup` or `blocked`.

These policies are **rebuilt from scratch every time you save**, on the extension side. That means a
tampered-with message from the browser panel can't make Staging public or strip the Production guard —
the rules aren't stored where they could be edited.

Passwords are never stored. What's saved is a *reference* — `SecretStorage:website.staging.password` or
`env:WEBSITE_STAGING_PASSWORD` — and the actual value is resolved when it's needed.

---

## Website Studio plans; it doesn't deploy

Platform readiness here is **descriptive only** — `not-planned`, `planned`, `configured`, `live` or
`blocked`, with at most one primary target. Choosing a platform doesn't push anything anywhere.

The actual deployment path, with its preflight, backup, approval, publish, verification and rollback
steps, is **Project Dashboard → Delivery**. See [[Delivery]].

The same applies to automations: Website Studio **maps** n8n workflows but never triggers one. Store
references like `env:N8N_CONTACT_WEBHOOK_URL`, never the value itself. Credential references must carry
an explicit `env:`, `SecretStorage:` or supported secret-manager prefix.

AtlasMind also redacts known secret shapes and webhook-shaped URLs, rejects URLs carrying embedded
credentials, bounds every input, and runs everything it saves through the normal memory scanner — which
blocks prompt-injection attempts before anything is written. There is no message the panel can send that
would deploy anything or run a workflow.

---

## Where your plan lives

Your website plan is stored in your repository, as structured data with a readable Markdown mirror
alongside it. Both are yours to read, diff and review.

Running `/bootstrap` again never overwrites an existing plan.

---

## Related

- [[Delivery]] — the guarded path to production
- [[GitHub Workflow]] — the wider workflow this sits inside
- [[Memory System]] — where the plan is kept
- [[Security]] — the boundaries described above
