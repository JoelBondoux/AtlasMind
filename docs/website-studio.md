# Website Studio

Website Studio is AtlasMind's project-scoped workspace for taking a client website from intake to delivery readiness. Open it from **Project Dashboard → Delivery**, from the Project Ideation board, with the **AtlasMind: Open Website Studio** command, or by choosing **Website / Marketing Site** during guided bootstrap. (Until v0.234.0 the command was the only way in — the Studio linked out to the Dashboard and the Ideation board, and neither linked back.)

## Dashboards

| Dashboard | Purpose |
|---|---|
| Client Brief | Capture the client, project, goals, audiences, features, content sources, brand notes, constraints, metrics, stakeholders, launch target, and budget — plus the whole-site design prompt |
| Sitemap | Page title, slug, purpose, template, and the auto-drawn hierarchy map with each page's outbound links and inbound count |
| Wireframe canvas | Draw the page: nav, hero, section, grid, card, media, text, form, CTA, sidebar, footer. Select any element to describe it. Per-page design prompts and the wireframe/UI/content/SEO review states live here |
| UI System | Record brand direction, tone, palette, typography, spacing, corner style, accessibility target, and component notes |
| Hosting & Platforms | Configure Develop, Staging, and Production, then compare/select Cloudflare Pages, GitHub Pages, WordPress + Elementor, WordPress, Vercel, Netlify, Azure Static Web Apps, Shopify, Webflow, or custom hosting |
| n8n Automations | Map workflow event, expected outcome, readiness, opaque workflow ID, instance, credential reference, and data/privacy notes |

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

## Generate and preview

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

The preview renders in a window beside the Studio, served by a small static server. It binds
`127.0.0.1` and nothing else, serves only the preview folder, re-checks every request path against
that folder, offers no directory listing, and carries a random per-session token in its URL so another
process on the machine cannot enumerate the site. It starts when you open the preview and stops when
you close it or close the Studio.

Both switches are off by default and are two switches on purpose: writing model-authored files and
opening a local port are different decisions.

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

- `project_memory/domain/website.json` is the structured source of truth, at **format version 2**.
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
