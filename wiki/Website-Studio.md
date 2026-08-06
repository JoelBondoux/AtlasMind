# Website Studio

**A workspace for taking a client website from the first conversation to launch.**

If you build sites for clients, the hard part usually isn't the code — it's keeping the brief, the
sitemap, the design decisions, the hosting choice and the sign-offs in one place that everyone can see.
Website Studio is that place.

**Open it from:** Project Dashboard → Delivery · the Ideation board · **AtlasMind: Open Website Studio** ·
or by choosing **Website / Marketing Site** during `/bootstrap`.

---

## What's in it

| Dashboard | What you use it for |
|---|---|
| **Client Brief** | The client, the goals, the audiences, the features, where the content is coming from, brand notes, constraints, success metrics, stakeholders, launch date and budget — and one sentence describing how the whole site should look |
| **Sitemap** | Every page — title, slug, what it's for, which template it uses, where it links to, and a hierarchy map that draws itself |
| **Wireframe canvas** | Draw the page by dragging blocks onto a grid. Select anything and describe it in your own words. Per-page design prompts, and the draft → review → approved states for wireframe, design, content and SEO |
| **UI System** | Brand direction, tone, palette, typography, spacing, corner style, accessibility target and component notes |
| **Hosting & Platforms** | Set up Develop, Staging and Production, and compare Cloudflare Pages, GitHub Pages, WordPress (with or without Elementor), Vercel, Netlify, Azure Static Web Apps, Shopify, Webflow, or your own |
| **n8n Automations** | Which workflow handles which event, what it should do, whether it's ready, and any data or privacy notes |

---

## Drawing the page

Pick a block — nav, hero, section, grid, card, image, text, form, call to action, sidebar, footer —
and drag on the grid to draw it. Resize from any of the eight handles. Drop a card inside a grid and
it nests. Arrow keys nudge the selection, Shift moves it a whole column, Delete removes it.

A few things behave the way they do on purpose:

- **Delete a wrapper and what was inside it moves up a level** rather than disappearing with it. The
  obvious implementation takes six cards with the container and gives you no undo.
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

The result renders in a window beside the Studio. The little server behind it listens on `127.0.0.1`
only, serves nothing but the preview folder, has no directory listing, and puts a random one-time token
in its address so nothing else running on your machine can guess the port and read your client's
unfinished work. It stops when you close the window.

Both switches — generating files, and opening the preview port — are **off until you turn them on**,
and they're two switches rather than one because they're genuinely two different decisions.

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
