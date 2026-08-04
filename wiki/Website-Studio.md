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
| **Client Brief** | The client, the goals, the audiences, the features, where the content is coming from, brand notes, constraints, success metrics, stakeholders, launch date and budget |
| **Sitemap** | Every page — title, slug, what it's for, and which template it uses |
| **Wireframes & UI** | Page sections, tracked through draft → review → approved for wireframe, visual design, content and SEO |
| **UI System** | Brand direction, tone, palette, typography, spacing, corner style, accessibility target and component notes |
| **Hosting & Platforms** | Set up Develop, Staging and Production, and compare Cloudflare Pages, GitHub Pages, WordPress (with or without Elementor), Vercel, Netlify, Azure Static Web Apps, Shopify, Webflow, or your own |
| **n8n Automations** | Which workflow handles which event, what it should do, whether it's ready, and any data or privacy notes |

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
