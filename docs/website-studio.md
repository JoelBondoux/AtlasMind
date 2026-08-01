# Website Studio

Website Studio is AtlasMind's project-scoped workspace for taking a client website from intake to delivery readiness. Open it from **Project Dashboard → Delivery**, from the Project Ideation board, with the **AtlasMind: Open Website Studio** command, or by choosing **Website / Marketing Site** during guided bootstrap. (Until v0.234.0 the command was the only way in — the Studio linked out to the Dashboard and the Ideation board, and neither linked back.)

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

- `project_memory/domain/website.json` is the structured source of truth.
- `project_memory/domain/website.md` is regenerated on every save as a human-readable review mirror.

Bootstrap never overwrites an existing website plan. Every dashboard save passes through the same sanitizer, whether the original values came from rendered controls or imported JSON.

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

The current webview protocol has no deploy or workflow-trigger message. Any future execution path must resolve secrets host-side and enter AtlasMind's normal approval and audit pipeline.
