# Interface Studio

Interface Studio is AtlasMind's project-scoped workspace for planning and shaping visual interfaces. It uses the familiar layout of a UI builder—tools and structure on the left, a canvas in the centre, a contextual inspector and Atlas conversation on the right—without assuming that the final renderer is HTML. A project can describe websites, native applications, embedded screens, game UI, or another target while keeping one visual language and interaction model.

The documentation path, persisted website files, and `atlasmind.openWebsiteStudio` command id remain stable for compatibility. The command is displayed as **AtlasMind: Open Interface Studio**; Website is the first target adapter, not the identity of the studio.

Open Interface Studio from **Project Dashboard → Delivery**, from Project Ideation, with **AtlasMind: Open Interface Studio**, or by choosing **Website / Marketing Site** during guided bootstrap.

## Workspace

| Region | What it is for |
|---|---|
| Top toolbar | Switch between Plan, Design, Build, and Preview; choose Desktop, Tablet, or Mobile; see Saved, Saving, Unsaved changes, or a recovered draft; and save the current revision |
| Tool rail | Open Surfaces, Layers, Components, Assets, Visual language, or History, with project setup kept at the bottom |
| Left panel | Browse surfaces and nodes, inspect the layer hierarchy, reuse component guidance, and review visual-language tokens |
| Canvas | Arrange the project flow in Plan or work with the selected surface in the visual builder |
| Inspector | Edit the selected surface or node in context instead of navigating to a separate form |
| Atlas pane | Discuss the current selection with its preview profile, visual language, bounded project brief, and current unsaved selection/page context attached |
| Project setup drawer | Maintain the detailed Brief, Surfaces, Visual language, Review states, Delivery, and Automations data that backs the builder |

The selection is shared by the surface tree, layer tree, canvas, inspector, and Atlas pane. Selecting a node therefore changes the editing context everywhere; it does not open a disconnected dashboard.

## Modes and preview profiles

| Mode | Current experience |
|---|---|
| Plan | Shows the project brief and ordered surface flow as a planning board |
| Design | Presents the visual composition with selection and contextual editing |
| Build | Uses the same draft but exposes node labels and structural editing cues |
| Preview | Hides editing labels and selection outlines for a cleaner review |

Desktop, Tablet, and Mobile change the canvas profile and travel with an Atlas handoff. These profiles describe review context rather than choosing an implementation technology. The renderer-neutral model can also carry explicit viewport, orientation, form-factor, and input-mode profiles for adapters that need them.

## Conversational development

Choose a surface or node and ask Atlas for a change in the right-hand pane. The webview reads the controls at the moment of the request, and the extension host sanitizes them before deriving the context for the selected page. Atlas receives that current unsaved selection/page context rather than the entire project draft or only the last saved `website.json`. The handoff includes:

- the selected surface and, when present, selected node;
- the active Desktop, Tablet, or Mobile preview profile;
- the projected visual language and target-adapter metadata;
- the selected page's current sections and design notes;
- the bounded project brief.

The current implementation opens the normal Atlas chat panel with an editable drafted prompt; it does not run a model inside the Studio webview, attach unrelated pages/delivery settings, or mutate the design automatically. **Apply** is visibly disabled because there is no structured-patch return protocol from Chat to Interface Studio. It must remain disabled until a future protocol validates a bounded patch in the extension host. **Reject** only dismisses the proposal card and leaves the draft unchanged.

## Draft recovery and save reconciliation

Interface Studio keeps two kinds of state deliberately separate:

- `vscode.setState()` stores presentation choices only: mode, tool panel, selected surface/node, preview profile, and zoom.
- Extension `workspaceState` stores one bounded, sanitized pending-draft record with its revision and timestamp. It is recovery data, not the Website SSOT and not a committed project file.

Each draft change advances a non-negative revision and schedules a bounded `storeDraft` message; closing the webview flushes any outstanding draft. The host limits serialized config payloads to 1,000,000 characters, sanitizes the config, and queues workspace-state updates so an older write cannot overtake a newer one. When Interface Studio opens again, it restores a valid pending draft only when no Website SSOT exists or the pending record is newer than the saved `website.json`; stale recovery data is discarded. A recovered draft remains visibly unsaved until the operator saves it.

Save and intake import share a host-side promise queue and carry the webview revision that initiated them. The host persists through `WebsiteWorkspaceManager`, then returns that revision with the canonical sanitized config. If it still matches the live revision, the webview reconciles the canonical values into its existing controls, marks the draft saved, and clears only the matching recovery record. If the operator edited again while the host was working, the older acknowledgement is recorded but the newer draft stays visibly unsaved. Neither save nor import requires a host-driven webview re-render.

## Renderer-neutral project model

`src/core/interfaceStudioModel.ts` defines the host-neutral model:

`Project → Flow → Surface → Node`

A project also owns a visual language, preview profiles, and target adapters. Nodes express semantic role, content intent, reusable token references, and child structure; they do not store CSS, SwiftUI, Jetpack Compose, Flutter, or other renderer instructions. A target adapter is responsible for translating that intent and for retaining target-specific metadata.

The Website Workspace v1 adapter projects the current website plan into this model:

- website pages become surfaces and their ordered sections become nodes;
- UI-system values become semantic visual-language tokens and component guidance;
- route, template, review, SEO, hosting, platform, and n8n data remain website-adapter metadata;
- stable deterministic IDs keep project, flow, surface, and node selection addressable across equivalent projections;
- the complete sanitized v1 source is retained as the adapter's `sourceSnapshot`, so the projection is lossless;
- page order is preserved, but `transitions` remains empty because v1 records no evidence-backed navigation graph.

This projection is in memory. It is not a schema migration: `project_memory/domain/website.json` remains `WebsiteWorkspaceConfig` schema version 1 and saving Interface Studio writes that existing format through `WebsiteWorkspaceManager`.

## Website adapter setup

The project setup drawer keeps the website adapter's detailed planning fields secondary to visual composition:

| Section | Website adapter data |
|---|---|
| Brief | Client, project, goals, audiences, features, content sources, brand notes, constraints, metrics, stakeholders, launch target, and budget |
| Surfaces | Page title, slug, purpose, and reusable template |
| Visual language | Brand direction, tone, palette, typography, spacing, corner style, accessibility target, and component guidance |
| Review states | Section outline, design notes, and independent wireframe, UI, content, and SEO states |
| Delivery | Fixed hosting environments and static, managed-CMS, commerce, or custom platform targets |
| Automations | n8n event, outcome, readiness, opaque workflow ID, instance, credential reference, and data/privacy notes |

### Client intake JSON

The Brief section accepts a bounded JSON object, including exports from a form or CRM and normalized n8n intake output. Common aliases are mapped:

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

Fields may be nested under `client` or `website`. Arrays are preferred for list fields; newline-delimited strings are also accepted. Imports are capped at 128,000 characters and do not clear an existing normalized field when the imported value is missing. Import uses the current live controls as its base, preserving unrelated unsaved edits before the normalized result is saved.

## Source-of-truth files

- `project_memory/domain/website.json` is the structured Website Workspace v1 source of truth.
- `project_memory/domain/website.md` is regenerated on every save as a human-readable review mirror.

Guided bootstrap never overwrites an existing website plan. Save and import both cross the same host-side sanitizer, regardless of whether values came from rendered controls or intake JSON.

## Hosting environments

Every Website adapter workspace has exactly three environments in a fixed order. Older `website.json` files gain these defaults automatically when loaded:

| Environment | Hosting rule | Access rule | Intended use |
|---|---|---|---|
| Develop | Local by default; explicit hosted fallback when local execution is unavailable | Loopback-only locally; HTTPS plus password protection when hosted | Implementation and private team QA |
| Staging | Hosted at `<review-label>.<production-domain>` | Always HTTPS and password-protected | Client review and sign-off |
| Production | Hosted | Public; promotion-protected | Live website |

The persisted model contains URLs, branch/project references, notes, and—only where password access is required—a credential *reference*. Store `SecretStorage:website.staging.password`, `env:WEBSITE_STAGING_PASSWORD`, or another supported secret-manager reference, never the password itself.

`assessWebsiteHostingEnvironments()` reports `ready`, `needs-setup`, or `blocked` for each stage. Missing URLs or references are setup work. HTTP hosted URLs, non-loopback local URLs, and a Staging URL outside the configured Production-domain review subdomain are blocking policy violations. `sanitizeWebsiteWorkspace()` always reconstructs canonical environment names, access policies, hosting restrictions, and the Production promotion guard, so a modified webview payload cannot downgrade them.

## Delivery and automation boundaries

Platform status is planning state: `not-planned`, `planned`, `configured`, `live`, or `blocked`. Only one platform may be primary. Interface Studio records public URLs and non-secret project/environment references, but it does not deploy. Use **Project Dashboard → Delivery** for the guarded preflight, backup, approval, publish, health-check, and rollback path.

The Automations section maps n8n workflows but does not trigger them. Use references such as `env:N8N_CONTACT_WEBHOOK_URL` or `SecretStorage:n8n.contact`; never paste a credential or webhook value. Hosting, platform deployment, and automations remain secondary project settings because they are target-specific delivery concerns rather than visual-language primitives.

Before persistence AtlasMind:

- applies the shared secret redactor to every text field;
- replaces n8n webhook-shaped URLs;
- blocks error-level prompt-injection content through the SSOT memory scanner before either file is written;
- accepts only HTTP(S) URLs without embedded credentials, query strings, or fragments;
- accepts credential references only with an explicit provider prefix such as `env:`, `SecretStorage:`, or a supported secret-manager prefix;
- locks Develop, Staging, and Production to their environment-specific hosting and access policies and validates HTTPS, loopback, and review-subdomain readiness;
- caps field, list, page, and workflow sizes;
- normalizes IDs and allow-lists status and platform values.

The webview protocol exposes no deploy or workflow-trigger message. Any future execution path must resolve secrets in the extension host and enter AtlasMind's normal approval and audit pipeline.
