# UI Studio

UI Studio is AtlasMind's project-scoped workspace for designing an interface and carrying that design
into the implementation. Choose a website, web app, mobile app, desktop app, editor extension,
embedded UI, or another interface profile. Open it from **Project Dashboard → Delivery**, from the
Project Ideation board, or with **AtlasMind: Open UI Studio**. The command id and the
`project_memory/domain/website.json` path remain stable for extension and repository compatibility.

Website is a profile, not the product boundary. Every profile shares project brief, screens and flows,
content design, Markdown screen copy, wireframes, UI system, and implementation guidance. The website
profile additionally exposes sitemap/SEO language, stack setup,
Develop → Staging → Production hosting, Delivery comparison, and n8n mapping.

Every profile may generate a sandboxed static HTML/CSS **visual reference** beside the Studio. For a
SwiftUI, React Native, XAML, game-engine, or other non-web project, that preview communicates layout,
content, states and tokens; it never claims HTML is the implementation target. The Implementation guide
is what points subsequent project work at the real technology and source locations.

## Dashboards

| Dashboard | Purpose |
|---|---|
| Project Brief | Choose the interface profile and capture the project, goals, audiences, features, content sources, brand notes, constraints, metrics, stakeholders, timing, budget, and whole-interface prompt |
| Sitemap / Screens & flows | Website profiles use pages and slugs; other profiles use screens and stable route/view identifiers. Both share the auto-drawn hierarchy, parent relationships, and links |
| Content Design | Set voice, principles, preferred/avoided terms, comprehension target, locales, and accessibility rules; edit each screen's real Markdown copy and UI states |
| Wireframe canvas | Draw the page: nav, hero, section, grid, card, media, text, form, CTA, sidebar, footer. Select any element to describe it. Per-page design prompts and the wireframe/UI/content/SEO review states live here |
| UI System | Record brand direction, tone, palette, typography, spacing, corner style, accessibility target, and component notes |
| Implementation | Record target technologies, source roots, component locations, and handoff notes for any implementation target. Website profiles also choose framework/platform, configure hosting, run setup, and compare Delivery |
| n8n Automations (website) | Map workflow event, expected outcome, readiness, opaque workflow ID, instance, credential reference, and data/privacy notes |

## Content is part of the design

Project-wide content rules live in the versioned UI Studio SSOT. Actual screen copy remains in the
configured Markdown content directory (default `content/`) so a copywriter, developer, static-site
generator, and the Studio all work on the same source. The editor includes headings, labels,
instructions, empty/loading/error/success states, validation, and recovery actions—not only prose.

Creating a missing content file writes explicit `[PLACEHOLDER: …]` markers derived from the current
wireframe and never plausible filler. When saving, the host compares the body with the version that
was opened. If another process changed it, the save is refused and the user reloads; prose is never
auto-merged into something nobody authored.

## The wireframe canvas

A page's structure is a set of drawn boxes, not a list of strings. Pick a block from the palette,
drag on the grid to draw it, resize from any of eight handles, and drop one block inside another to
nest it. Arrow keys nudge the selection; Shift makes the step a whole column; Delete removes it.

Three rules are worth knowing because they are deliberate:

- **Coordinates are canvas units on a fixed 1000-wide grid, never pixels.** `website.json` is
  committed, and pixels would record the author's monitor size — the same design would then read
  differently on a laptop and a 4K panel.
- **Deleting a container promotes what was inside it.** Cascade delete is the obvious implementation
  and the wrong one: it silently takes six cards with the wrapper, with no undo. The children move up
  a level and the notice says so.
- **Every block is a real focusable control** that announces its kind, its width as a fraction, and
  roughly where it sits. A canvas only a mouse can use would be a step backwards from the table it
  replaces.

The canvas caps at 60 elements and 3 levels of nesting. `sanitizeWireframe()` is the untrusted
boundary: for any input at all it returns rectangles that are finite and on-canvas and a parent graph
that is a forest — a parent that does not exist, one whose kind cannot contain children, a self-parent,
a cycle, or a chain that is too deep each lose *the parent*, never the element, because dropping the
element would delete work somebody did because of a bad drag.

`WebsitePagePlan.sections` still exists and is regenerated from the top-level element labels, so the
markdown mirror and anything written against format v1 keep working from one source of truth.

## The sitemap hierarchy

The map is derived, not drawn. Hierarchy comes from the slug path — `/services/seo` sits under
`/services` — so it builds itself as pages are added. An explicit parent overrides the slug, because a
decision somebody made on purpose outranks a naming convention.

A page whose slug names a parent that no page occupies is shown at the **top level and flagged**,
rather than hidden or attached to the nearest ancestor that happens to exist. A parent chain that
loops is broken at the repeat and reported. The layout is deterministic: the same pages always produce
the same coordinates, because a map that shifts when nothing changed is one nobody trusts.

Solid edges are stated parents; dashed edges were derived from the slug.

## Links between pages

Each page carries its outbound links. The inventory shows what a page links to, how many pages link
*to* it, and which links point at a page that no longer exists.

- **A dangling link is kept and marked, never dropped** — it is the evidence that a nav is broken.
- **The root page is never reported as an orphan.** Nothing links to the front page and nothing needs
  to; counting it would put a permanent false finding on every site.
- Nav and CTA blocks on the canvas *suggest* links by matching their label to a page title, exactly
  and then case-insensitively. Nothing looser is attempted: "Get in touch" silently wired to "Get
  Started" is a wrong answer that looks like a right one. A suggested link never overwrites one
  somebody typed.

## Design prompts and asking about a selection

Three scopes carry natural-language design intent: the whole site (Brief tab), each page, and each
element on the canvas. A page with a written prompt can be generated without anyone drawing a box —
which is what makes it possible to take a whole site to first-draft design from the sitemap alone.

Selecting an element and typing a sentence sends Atlas a prompt that names the selection completely:
its kind, label, size as both a fraction and canvas units, the chain of blocks containing it, the
elements beside it, the page it is on, and the shared design system. That is what makes "make this
wider" answerable rather than a question about nothing.

**Everything read out of the workspace is fenced as REPORTED CONTENT.** Labels, purposes and stored
design prompts are all model-writable and hand-editable, so an element labelled as an instruction must
not become one. The user's own sentence is deliberately *not* fenced — it is the instruction, and
fencing it would be theatre that also breaks the feature. Every prompt ends by saying the answer is a
proposal and that nothing should be written to `website.json`.

## Full preview: the design feedback loop

**Full Preview is a numbered Studio step**, not an output utility. Save the current design, then choose
**Rebuild and open** to render one deterministic draft from three sources of truth:

- wireframe geometry and hierarchy from the canvas;
- primary, secondary, and accent colours plus safe heading/body font tokens from the UI system; and
- the exact Markdown file for each page or screen, including visible `[PLACEHOLDER: …]` gaps.

The primary surface is VS Code's built-in Simple Browser, giving the design a full browser canvas without
leaving the editor. Each screen repeats all copy in a **Content proof** below the spatial canvas: fixed
wireframe boxes can clip during layout exploration, but clipped copy must never disappear from review.
The companion **Responsive lab** uses the same URL and server with Fit, Desktop 1280, Tablet 834, and
Mobile 390 widths.

The preview index always opens the deterministic Studio draft. If model-generated output exists it is
linked separately, one click away; generation cannot take over the meaning of “show my current design”.
Saving structure, content, or UI-system changes rebuilds the draft whenever the preview server is already
running. Refresh the built-in browser to see that saved revision, or use **Rebuild and open**.

## Generate

**Generate** works from four places, each knowing a different amount:

| Pressed from | Produces | Stated as not covered |
|---|---|---|
| Brief | One concept page plus a stylesheet | No wireframe exists, so the layout is the model's proposal |
| Sitemap | Every page, driven by its own design prompt, wired together | Which pages had no wireframe, and which had no prompt |
| Wireframe canvas | That page, honouring the drawn order, nesting and relative widths | Only this page — links to others will not resolve yet |
| A selected element | That page rewritten around the element | The whole page is rewritten, so hand-edits are lost |

Four properties hold:

- **The file list is deterministic and no model chooses it.** The same workspace and stage produce a
  byte-identical plan, which is what makes the confirmation dialog worth reading — a list a model
  composed would differ on every press and nobody could learn what "yes" means. The model writes file
  *contents*; it never decides file *paths*.
- **A path that does not validate refuses the whole plan**, with the reason, rather than being cleaned
  up. Quietly fixing a bad path leaves whoever wrote it believing something else happened, and here
  that something else is a write.
- **Everything lands in `.atlasmind/website-preview/`.** Your source tree is never written to.
  Extensions are limited to `.html`, `.css`, `.svg` and `.txt` — no `.js`, because a generated page
  that can execute is a different security question from one that cannot.
- **What the stage could not account for is reported with the result**, not just before it. A partial
  generation stored as a whole one lies by omission the next time somebody opens the preview.

A model that returns a file that was not in the approved plan has it **reported, not written** — the
defence is not that the path is malformed, it is that the user did not agree to it.

The preview is served by a small static server. It binds `127.0.0.1` and nothing else, serves only the
preview folder, re-checks every request path against that folder, offers no directory listing, and
carries a random per-session token in its URL so another process on the machine cannot enumerate the
design. It starts when you open a preview and stops through **Stop Preview**, when the Studio closes,
or when the extension deactivates.

Both switches are off by default and are two switches on purpose: writing model-authored files and
opening a local port are different decisions.

## Framework, platform and automatic setup

The framework and the hosting platform are **one decision**. "Astro on Cloudflare Pages" has a known
build command, a known output directory and a known deploy config; splitting the choice across two
pages made the compatible pairing something the user had to already know.

Ten frameworks are declared in `websiteFrameworks.ts`, each carrying the three facts everything
downstream needs — the scaffold command, the build command, and the output directory.
`describeStackCompatibility` grades every pairing `ideal` / `workable` / `unsupported` **with a
reason**, and an unsupported pairing stays in the list: removing Hugo when Shopify is selected would
leave somebody wondering where it went, while "Shopify serves Liquid templates from its own theme
system, so a separate build has nowhere to go" answers the question they had.

`custom`, `static` and `wordpress-theme` carry **no scaffold command**. An improvised command that
usually works is worse than an honest gap, because the failure lands in somebody's repository — the
same treatment `acpInstaller` gives Rust's `curl | sh` installer.

### What Set up this stack does

Planning performs nothing; a separate call executes after a modal listing every command with its
purpose and every file with its full contents.

| Step | What it does |
|---|---|
| `runtime` | Reports a missing Node or Hugo as a blocker before anything else is attempted |
| `scaffold` | The framework's own create command, skipped when a `package.json` already exists |
| `config-file` | `wrangler.toml` / `netlify.toml` / `vercel.json` / `staticwebapp.config.json` |
| `scripts` | `dev` and `build` in `package.json`, only where the key is absent |
| `env-example` | Per-environment variable **names**, never a value |
| `branches` | `git branch` for the stage branches that do not exist |
| `ci` | The GitHub Actions workflow, gated by its own setting |
| `manual` | Anything touching a remote account — quoted, not run |

Five properties hold, each pinned by a test:

1. **No step runs a shell.** Every executable step is `execFile(command, args)` and every command is a
   module constant. A test walks *every* producible plan and fails on a shell metacharacter, or on a
   command naming a shell or a downloader.
2. **No step writes outside the workspace.** Validated at plan time, re-resolved against the root
   before each write, with the writer injected so a test fails the run on an escaping path.
3. **Everything that could destroy work is create-only.** Existing files, scripts, branches and
   workflows are reported untouched. Re-running is safe, which is the case it exists for.
4. **Branch creation is `git branch` only** — never checkout, never push, never force.
5. **Success is re-probed from the filesystem**, never inferred from an exit code.

### The generated CI workflow

Off by default and gated separately from the rest of setup, because it is the one generated artefact
that **acts on its own**: it runs on GitHub's infrastructure, with the repository's secrets, on a push
nobody reviewed it for.

- The YAML is a declared template with only validated values substituted — branch names, output
  directory, node version, build command, each charset-checked first. A rendered file still containing
  a placeholder refuses rather than being written.
- `.github/workflows/` is **create-only**. Replacing somebody's deploy pipeline is not recoverable
  from an editor.
- Production declares `environment: production`, so the approval gate exists on GitHub's side too.
  AtlasMind's confirmation protects the moment the file is written; the environment protects every run
  after that.
- Secrets are **named, never written**, and the plan lists which to add and where.
- Explicit `permissions:`, pinned action majors, and per-environment `concurrency` with
  `cancel-in-progress: false` — a half-finished deploy is worse than a queued one.
- A platform with no verified deploy action is **refused**, not guessed at.

### Remote project creation

`wrangler pages project create`, `netlify sites:create` and `vercel link` are planned as `manual`
steps unless `atlasmind.website.setup.allowRemoteProjectCreation` is explicitly on. They authenticate
as the user and create billable resources, and a run that fails halfway leaves them orphaned with no
teardown.

## Website Studio and the Delivery pipeline

Both model dev → staging → production. `DeploymentStage` is the executable one, with the backup,
approval, rollback and protection policy that `promotionRunner` acts on; Website Studio's
`WebsiteHostingEnvironment` is a planning model carrying website-specific policy Delivery has no
concept of (loopback develop, password-protected staging subdomain).

Keeping both was a deliberate choice, and its cost is drift. `compareWebsiteToDelivery` is therefore a
**comparison, not a verdict** — shaped after `findTaxonomyDrift`, it reports per stage which fields
disagree and what each side says, and writes nothing. When nobody has compared them, the page says so
rather than showing a reassuring blank.

Syncing is one-directional and confirmed, and two rules protect the operational side:

- **An empty planning field never clears a real one.** A blank box in the Studio must not erase a
  working `healthCheckUrl` from a page that never claimed to own it. Absent means "no opinion".
- **Protection only tightens.** Sync can mark a stage protected; it can never unprotect one.

Sync also **never creates a Delivery stage** — that would mean inventing a backup and rollback policy
from a page that models neither, and `promotionRunner` would then act on defaults nobody chose. An
unmapped environment is reported instead.

## Seeing the wireframe

A wireframe renders straight to HTML with **no model involved** — instant, free, and identical every
time. This exists because of a real bug: there was no deterministic HTML renderer anywhere in
`src/core/`, so a wireframe could not reach a browser without first running a generation, and an empty
preview root served the 404 as a near-blank page.

Renders live under `_wireframe/`, deliberately **not** at the address a generated page occupies.
Sharing an address would mean either the create-only rule blocking a later Generate, or a Generate
silently replacing the wireframe — and in both cases somebody looks at the wrong thing believing it is
the other. Opening the preview always shows the live design index. A generated visual guide, when
present, is a separate link and never silently replaces the deterministic draft.

Without content, every block is unmistakably unfinished: hatched fill, dashed border, its own label. A
`text` block renders grey bars rather than lorem ipsum; `media` renders a crossed rectangle rather than
a stock photo; `nav` and `footer` show the **real page titles from the sitemap**, because those are facts
rather than filler. With content, an inert Markdown subset renders exact copy into eligible blocks and
the full content proof; input is escaped before formatting. The output carries no script and no external
request, so it satisfies the preview server's existing strict CSP without widening policy.

## Page content

Copy lives in markdown under `content/` (configurable), one file per page, with YAML front-matter for
`title`, `metaDescription` and `status`. Unknown front-matter keys survive a round trip, so a field
your static-site generator depends on is never silently dropped.

Five rules:

- **Invented copy must never look like approved copy.** `[PLACEHOLDER: what is needed]` is parsed,
  **counted**, and rendered visibly as a gap. A page's readiness is "four placeholders remaining" — a
  fact — rather than a status somebody set. Generation is instructed to emit markers rather than
  plausible prose, and never to write invented company names, testimonials, prices or statistics.
- **The file wins.** Saving from the Studio re-reads first, and a file that changed underneath is
  refused rather than merged: automatically resolving two versions of somebody's prose produces a
  document neither of them wrote.
- **Missing is not empty.** No file means nobody has started; an empty file means somebody started and
  left it blank. Distinguishable at every layer, and a missing file is never reported as
  "0 placeholders".
- **Front-matter is bounded and sanitized**, and the body keeps its newlines — markdown is
  line-structured, and collapsing whitespace would destroy every paragraph break.
- **The path is derived from the slug one way**, via the sitemap's own `normalizeSlug`, so the content
  tree and the sitemap cannot disagree. A file no page claims is reported, never deleted.

Seeding a starter file writes **only placeholders** — one per drawn section, naming what is needed.

## Client review

Comments are recorded against a page or a specific wireframe element and transition through
`open → addressed → resolved`, plus `wont-fix`.

- **Comments transition, never delete.** "We fixed it" and "we decided not to" are different facts.
- **An orphaned comment is kept and flagged**, carrying the label the element had when the comment was
  made. It is the evidence that something was removed while under review — and the comment a naive
  implementation drops. `resolved` can always be re-opened, because "still not right" is the commonest
  event in a review.
- **The body is fenced as REPORTED CONTENT** wherever it reaches a model. It is third-party text that
  travelled through a browser we do not control.

### The shareable link

The overlay is generated **into the site**, so it travels to the password-protected staging
environment the Stack page already sets up — the client's own hosting. **AtlasMind hosts nothing.**

Comments return either by download (imported with **AtlasMind: Import Website Client Feedback**) or by
POST to an endpoint the team already owns. **No endpoint is ever invented**: unset means export-only,
and the page's `connect-src` is then `'none'` — it cannot make a request at all.

This is the only place AtlasMind puts JavaScript into a generated page, so:

- The script is a **frozen constant**, hand-written, never model-written, with nothing from the
  workspace interpolated into it — configuration travels in a `data-` attribute as JSON.
- The preview server's `.js` exception is **one named file**, not a widened extension class, and
  `script-src 'self'` is added only while the overlay setting is on.
- Import is **idempotent**: re-sending the same export adds nothing and never resets a comment already
  resolved.

The decision not to run a hosted relay — and what that costs — is recorded in
`project_memory/decisions/website-client-review-hosting.md`.

## Client Intake JSON

The Brief dashboard accepts a bounded JSON object. This works well for an export from a form/CRM or the normalized output of an n8n intake workflow. Common field aliases are mapped:

| Normalized field | Accepted examples |
|---|---|
| `clientName` | `companyName`, `businessName`, `organisation`, `organization` |
| `projectName` | `websiteName`, `siteName` |
| `summary` | `brief`, `description`, `overview` |
| `goals` | `objectives`, `websiteGoals` |
| `audiences` | `audience`, `targetAudience`, `personas` |
| `requiredFeatures` | `features`, `functionality`, `requirements` |
| `successMetrics` | `metrics`, `kpis` |
| `targetLaunch` | `launchDate`, `deadline`, `timeline` |

Fields may also be nested under `client` or `website`. Arrays are preferred for list fields; newline-delimited strings are also accepted. Imports are capped at 128,000 characters and do not clear an existing normalized field when the imported value is missing.

## SSOT Files

- `project_memory/domain/website.json` is the structured source of truth, at **format version 5**.
- `project_memory/domain/website.md` is regenerated on every save as a human-readable review mirror. It carries the hierarchy as an indented outline, each page's outbound links, the navigation findings, and the design prompts — so "nothing links to the new Pricing page" shows up in a pull request rather than only on screen.

Bootstrap never overwrites an existing website plan. Every dashboard save passes through the same sanitizer, whether the original values came from rendered controls or imported JSON.

### Format v1 → v2

Version 2 added the wireframe canvas, the sitemap hierarchy, the link graph and the design prompts.
The migration is registered in `schemaMigration.ts` as the `website` kind and runs on load:

- Each page's old `sections` list becomes **stacked wireframe bands** in the same order. A transcription
  rather than a design — nobody drew it, and it claims only what the list already said, which is the
  sequence. The alternative was to leave migrated projects opening onto an empty canvas, where the work
  they had already done would look lost.
- `order` is seeded from array position, the only ordering a v1 file recorded.
- `designPrompt` and `links` are seeded **empty rather than guessed**. A migration has no standing to
  write a design intent on the author's behalf, and a guessed link would be indistinguishable from one
  they set.

### Formats v2 → v5

- v3 added the framework/platform stack choice and left it absent on migration rather than guessing.
- v4 moved actual copy into separately managed Markdown files; migration created no files because
  missing content is a meaningful state.
- v5 adds `surfaceKind`, project-wide content design and implementation guidance. A v4 workspace
  becomes `website`, the only profile the old format could represent, and both new guidance records
  start empty rather than inventing product or source-code decisions.

A `website.json` written by a **newer** AtlasMind is refused rather than replaced: the Studio opens
read-only and says so. The previous read path collapsed "corrupt" and "from the future" into the same
answer, so an older build would seed a default and overwrite the newer format on the next save.

## Hosting Environments

Every Website Studio workspace has exactly three environments in a fixed order. Older `website.json` files gain these defaults automatically when loaded:

| Environment | Hosting rule | Access rule | Intended use |
|---|---|---|---|
| Develop | Local by default; explicit hosted fallback when local execution is unavailable | Loopback-only locally; HTTPS plus password protection when hosted | Implementation and private team QA |
| Staging | Hosted at `<review-label>.<production-domain>` | Always HTTPS and password-protected | Client review and sign-off |
| Production | Hosted | Public; promotion-protected | Live website |

The persisted model contains URLs, branch/project references, notes, and—only where password access is required—a credential *reference*. Store `SecretStorage:website.staging.password`, `env:WEBSITE_STAGING_PASSWORD`, or another supported secret-manager reference, never the password itself.

`assessWebsiteHostingEnvironments()` reports `ready`, `needs-setup`, or `blocked` for each stage. Missing URLs/references are setup work; HTTP hosted URLs, non-loopback local URLs, and a Staging URL outside the configured Production-domain review subdomain are blocking policy violations. `sanitizeWebsiteWorkspace()` always reconstructs the canonical environment names, access policies, hosting restrictions, and Production promotion guard, so a modified webview payload cannot downgrade them.

## Platforms and Delivery

Platform status is planning state:

- `not-planned`
- `planned`
- `configured`
- `live`
- `blocked`

Only one platform may be primary. Website Studio records public URLs and non-secret project/environment references, but it does not deploy. Open the Project Dashboard's Delivery page to configure the actual preflight, backup, approval, publish, health-check, and rollback path.

## n8n Boundary

Website Studio maps n8n workflows but does not trigger them. Use credential references such as `env:N8N_CONTACT_WEBHOOK_URL` or `SecretStorage:n8n.contact`; never paste the value.

Before persistence AtlasMind:

- applies the shared secret redactor to every text field;
- replaces n8n webhook-shaped URLs;
- blocks error-level prompt-injection content through the normal SSOT memory scanner before either file is written;
- accepts only HTTP(S) URLs without embedded credentials, query strings, or fragments;
- accepts credential references only when they have an explicit provider prefix such as `env:`, `SecretStorage:`, or a supported secret-manager prefix;
- locks Develop, Staging, and Production to their environment-specific hosting/access policies and validates HTTPS/loopback/subdomain readiness;
- caps field, list, page, and workflow sizes;
- normalizes IDs and allow-lists status/platform values.

The webview protocol has no deploy or workflow-trigger message. Any future execution path must resolve secrets host-side and enter AtlasMind's normal approval and audit pipeline.

The four messages added for the canvas and Generate carry **data only** — a scope, some ids, and the user's own sentence. None of them can name a command, a path, or a file, so no webview message can widen what the panel is willing to do. Generation and preview are gated separately (`atlasmind.website.generation.enabled`, `atlasmind.website.preview.enabled`), both off by default, and generation additionally requires a modal confirmation naming every file.
