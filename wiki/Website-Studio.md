# Website Studio

Website Studio is AtlasMind's project-scoped workspace for taking a client website from intake to delivery readiness. Open it with **AtlasMind: Open Website Studio**, or choose **Website / Marketing Site** during guided bootstrap.

## Dashboards

| Dashboard | Purpose |
|---|---|
| Client Brief | Capture the client, project, goals, audiences, features, content sources, brand notes, constraints, metrics, stakeholders, launch target, and budget |
| Sitemap | Define page title, slug, purpose, and reusable page template |
| Wireframes & UI | Outline page sections and track wireframe, visual design, content, and SEO through draft, review, and approval |
| UI System | Record brand direction, tone, palette, typography, spacing, corner style, accessibility target, and component notes |
| Hosting & Platforms | Configure Develop, Staging, and Production, then compare/select Cloudflare Pages, GitHub Pages, WordPress + Elementor, WordPress, Vercel, Netlify, Azure Static Web Apps, Shopify, Webflow, or custom hosting |
| n8n Automations | Map workflow event, expected outcome, readiness, opaque workflow ID, instance, credential reference, and data/privacy notes |

## Client Intake JSON

The Brief dashboard accepts bounded JSON from a form, CRM export, or n8n normalization workflow. AtlasMind maps common aliases such as `companyName` → `clientName`, `objectives` → `goals`, `targetAudience` → `audiences`, and `kpis` → `successMetrics`. Fields may live at the root or under `client` / `website`; list fields may be arrays or newline-delimited strings. Imports are capped at 128,000 characters and missing imported fields do not erase an existing value.

## SSOT

- `project_memory/domain/website.json` is the structured source of truth.
- `project_memory/domain/website.md` is regenerated as its review-friendly mirror.

Bootstrap never overwrites an existing website plan. All saved/imported data passes through the same extension-host sanitizer.

## Hosting Environments

Website Studio always provides the same three-stage path:

| Environment | Hosting and access policy | Purpose |
|---|---|---|
| Develop | Loopback-only by default; if local hosting is unavailable, an explicit hosted fallback requires HTTPS and a password credential reference | Implementation and private team QA |
| Staging | Hosted, HTTPS, and password-protected at `<review-label>.<production-domain>` | Client review and sign-off |
| Production | Hosted, public, and promotion-protected | Live website |

The dashboard reports each stage as `ready`, `needs-setup`, or `blocked`. The extension host reconstructs the canonical policies on every save, so a modified webview message cannot make Staging public or remove the Production guard. The SSOT stores only references such as `SecretStorage:website.staging.password` or `env:WEBSITE_STAGING_PASSWORD`, never the password.

## Platforms and Delivery

Platform readiness is descriptive state only (`not-planned`, `planned`, `configured`, `live`, `blocked`), with at most one primary target. Website Studio cannot deploy. Use **Project Dashboard → Delivery** for the actual preflight, backup, approval, publish, verification, and rollback path.

## n8n Safety Boundary

Website Studio maps workflows but does not trigger them. Store references such as `env:N8N_CONTACT_WEBHOOK_URL`, never values. Credential references require an explicit `env:`, `SecretStorage:`, or supported secret-manager prefix. AtlasMind redacts known secret shapes and n8n webhook-shaped URLs, rejects URLs with embedded credentials/query/fragment data, bounds all inputs, enforces the three hosting policies and topology, runs both SSOT outputs through the normal memory scanner (blocking error-level prompt injection before either write), and has no webview message for deployment or workflow execution.

Any future n8n runner must resolve secrets in the extension host and enter the normal tool-risk, approval, and audit pipeline.
