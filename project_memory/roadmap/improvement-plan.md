# Developer Roadmap

This file is the developer-facing backlog AtlasMind should absorb into SSOT and consult when deciding what to tackle next.

> Priority order matters: items nearer the top receive more weight, but AtlasMind should still weigh criticality, security, architecture, delivery risk, and fresh execution evidence before choosing the next task.

## Project Context
- Project: ---
- Project type: Unspecified
- Target audience: Unspecified
- Timeline: Unspecified
- Tech stack: Unspecified

## Prioritized Backlog
## Chat & Orchestrator Refactor (Critical)

<!-- atlasmind:roadmap-items:start -->
- [ ] Adding items to teh Roadmap via the Project Settings needs to also update the human readable roadmap
- [ ] Project: ---
- [ ] Project type: Unspecified
- [ ] Target audience: Unspecified
- [ ] Timeline: Unspecified
- [ ] Tech stack: Unspecified
- [ ] In the sidebar the Memory index can show warnings and blocked. This title line needs to be clickable to the relevant blockages and warnings with guided solutions.
- [ ] Project: ---
- [ ] Project type: Unspecified
- [ ] Target audience: Unspecified
- [ ] Timeline: Unspecified
- [ ] Tech stack: Unspecified
- [ ] Robust error recovery and feedback: All chat modes (including freeform) attempt auto-recovery on errors, retry with simplified prompts, and always surface actionable feedback bubbles. Autopilot auto-resolves non-critical stops.
- [ ] Project: ---
- [ ] Project type: Unspecified
- [ ] Target audience: Unspecified
- [ ] Timeline: Unspecified
- [ ] Refactor orchestrator and chat participant to support stepwise execution, progress streaming, and partial recovery for multi-step prompts.
- [ ] Tech stack: Unspecified
- [ ] Architectural integrity and changes that unlock safer future work.
- [ ] Universal prompt decomposition: All chat prompts (not just /project) are analyzed and, if multi-action, decomposed into subtasks for sequential/parallel execution. Planner is invoked automatically when needed.
- [ ] Update documentation and user guidance to reflect new chat and planning behaviors.
- [ ] User-facing outcomes, milestones, and backlog order in this file.
- [ ] Delivery hygiene such as tests, CI, release notes, and documentation.
- [ ] Architectural integrity and changes that unlock safer future work.
- [ ] Add a GDPR compliance toggle in project settings. When enabled, enforce GDPR regulatory restrictions across the project, including:
- [ ] **P1 (First Release):** Shopify, Next.js SaaS, Static Website, Next.js App Router, React SPA, React Native, AI Orchestrator, Dockerised Full‑Stack, Full Testing, Auth, Payments
- [ ] User-facing outcomes, milestones, and backlog order in this file.
- [ ] Delivery hygiene such as tests, CI, release notes, and documentation.
- [ ] Auth & Payments are dependencies for most SaaS, Marketplace, and Subscription packs.
- [ ] Detection, parsing, retention, and transfer controls for PII data.
- [ ] Default to deny overrides unless explicit reasoning is provided within GDPR-compliant frameworks.
- [ ] Allow overrides only when justified and logged with GDPR-appropriate rationale.
- [ ] Document all GDPR-related controls and override policies in user-facing and developer documentation.
- [ ] Marketplace depends on Auth, Payments, and SaaS Starter packs.
- [ ] **P2:** WooCommerce, BigCommerce, Remix, Laravel, Django, Blog/CMS, SvelteKit, Nuxt, Vue, Expo, Flutter, Godot, Web Game, RAG, Agentic, Local Model, K8s, Serverless, Terraform, Playwright, API Testing, Marketplace, Subscription, Booking, CRM, Email, Analytics, i18n, Accessibility
- [ ] **P3:** Magento 2, Wix, Unity, Unreal
- [ ] AI Orchestrator depends on Agentic Workflow & Local Model Dev.
- [ ] Full Testing is a dependency for all app starters.
- [ ] Architectural integrity and changes that unlock safer future work.
- [ ] **P1 (First Release):** Shopify, Next.js SaaS, Static Website, Next.js App Router, React SPA, React Native, AI Orchestrator, Dockerised Full‑Stack, Full Testing, Auth, Payments
- [ ] Dockerised Full‑Stack is a base for Kubernetes Microservice.
- [ ] Auth & Payments are dependencies for most SaaS, Marketplace, and Subscription packs.
- [ ] Static Website is a base for Blog/CMS.
- [ ] **P2:** WooCommerce, BigCommerce, Remix, Laravel, Django, Blog/CMS, SvelteKit, Nuxt, Vue, Expo, Flutter, Godot, Web Game, RAG, Agentic, Local Model, K8s, Serverless, Terraform, Playwright, API Testing, Marketplace, Subscription, Booking, CRM, Email, Analytics, i18n, Accessibility
- [ ] **P3:** Magento 2, Wix, Unity, Unreal
- [ ] Marketplace depends on Auth, Payments, and SaaS Starter packs.
- [ ] AI Orchestrator depends on Agentic Workflow & Local Model Dev.
- [ ] Full Testing is a dependency for all app starters.
- [ ] Dockerised Full‑Stack is a base for Kubernetes Microservice.
- [ ] Architectural integrity and changes that unlock safer future work.
- [ ] **P1 (First Release):** Shopify, Next.js SaaS, Static Website, Next.js App Router, React SPA, React Native, AI Orchestrator, Dockerised Full‑Stack, Full Testing, Auth, Payments
- [ ] Static Website is a base for Blog/CMS.
- [ ] Auth & Payments are dependencies for most SaaS, Marketplace, and Subscription packs.
- [ ] **P2:** WooCommerce, BigCommerce, Remix, Laravel, Django, Blog/CMS, SvelteKit, Nuxt, Vue, Expo, Flutter, Godot, Web Game, RAG, Agentic, Local Model, K8s, Serverless, Terraform, Playwright, API Testing, Marketplace, Subscription, Booking, CRM, Email, Analytics, i18n, Accessibility
- [ ] **P3:** Magento 2, Wix, Unity, Unreal
- [ ] AI Orchestrator depends on Agentic Workflow & Local Model Dev.
- [ ] Full Testing is a dependency for all app starters.
- [ ] Marketplace depends on Auth, Payments, and SaaS Starter packs.
- [ ] Dockerised Full‑Stack is a base for Kubernetes Microservice.
- [ ] Static Website is a base for Blog/CMS.
- [ ] Architectural integrity and changes that unlock safer future work.
<!-- atlasmind:roadmap-items:end -->

## Prefab Architecture Packs Roadmap

AtlasMind will deliver a suite of fast-start, opinionated project templates (“Prefab Architecture Packs”) for major developer ecosystems. Each pack includes a description, folder structure, agents/tools, dependencies, complexity, and priority.

### 1. E‑Commerce Ecosystems
| Pack | Description | Structure | Agents/Tools | Deps | Complexity | Priority |
|------|-------------|-----------|--------------|------|-----------|----------|
| Shopify | Shopify app/theme starter | /src, /shopify, /public, /config, /scripts | Shopify CLI, Theme Kit | Shopify API, Node.js | Medium | P1 |
| WooCommerce | WP+Woo plugin starter | /wp-content/plugins, /assets, /includes | WP CLI, Woo REST agent | PHP, WooCommerce | Medium | P2 |
| BigCommerce | BigCommerce app starter | /src, /public, /bigcommerce | BigCommerce CLI | Node.js | Medium | P2 |
| Magento 2 | Magento 2 module starter | /app/code, /view, /etc | Magento CLI | PHP, Magento 2 | High | P3 |
| Wix | Wix app starter | /src, /wix, /public | Wix CLI | Wix API | Low | P3 |

### 2. SaaS & Web App Starters
| Pack | Description | Structure | Agents/Tools | Deps | Complexity | Priority |
|------|-------------|-----------|--------------|------|-----------|----------|
| Next.js SaaS | Full-stack SaaS boilerplate | /pages, /api, /components | Next.js agent, Auth agent | Next.js, Prisma | Medium | P1 |
| Remix SaaS | Remix SaaS starter | /app, /routes, /db | Remix agent | Remix, Prisma | Medium | P2 |
| Laravel SaaS | Laravel SaaS starter | /app, /routes, /database | Laravel agent | Laravel | Medium | P2 |
| Django SaaS | Django SaaS starter | /project, /apps | Django agent | Django | Medium | P2 |
| Static Website | Static site starter | /public, /src | Static site agent | None | Low | P1 |
| Blog/CMS | Blog/CMS starter | /content, /src, /themes | Astro/Hugo/WordPress agent | Astro/Hugo | Medium | P2 |

### 3. Frontend Framework Packs
| Pack | Description | Structure | Agents/Tools | Deps | Complexity | Priority |
|------|-------------|-----------|--------------|------|-----------|----------|
| Next.js App Router | Next.js 13+ starter | /app, /components | Next.js agent | Next.js | Low | P1 |
| SvelteKit | SvelteKit SPA/SSR | /src, /routes | SvelteKit agent | SvelteKit | Low | P2 |
| Nuxt 3 | Nuxt 3 starter | /pages, /components | Nuxt agent | Nuxt 3 | Low | P2 |
| React SPA | React SPA starter | /src, /public | React agent | React | Low | P1 |
| Vue SPA | Vue SPA starter | /src, /public | Vue agent | Vue | Low | P2 |

### 4. Mobile App Development
| Pack | Description | Structure | Agents/Tools | Deps | Complexity | Priority |
|------|-------------|-----------|--------------|------|-----------|----------|
| React Native | React Native starter | /src, /components | RN agent | React Native | Medium | P1 |
| Expo Full‑Stack | Expo app w/ backend | /app, /api | Expo agent | Expo | Medium | P2 |
| Flutter | Flutter starter | /lib, /assets | Flutter agent | Flutter | Medium | P2 |

### 5. Game Development Architectures
| Pack | Description | Structure | Agents/Tools | Deps | Complexity | Priority |
|------|-------------|-----------|--------------|------|-----------|----------|
| Unity | Unity starter | /Assets, /Scenes | Unity agent | Unity | High | P2 |
| Unreal | Unreal starter | /Source, /Content | Unreal agent | Unreal | High | P3 |
| Godot | Godot starter | /scenes, /scripts | Godot agent | Godot | Medium | P2 |
| Web Game | Phaser/Three.js | /src, /assets | Web game agent | Phaser.js | Medium | P2 |

### 6. AI / Agent / Automation Architectures
| Pack | Description | Structure | Agents/Tools | Deps | Complexity | Priority |
|------|-------------|-----------|--------------|------|-----------|----------|
| AI SaaS | SaaS w/ AI features | /src, /ai | AI agent | OpenAI, LangChain | High | P1 |
| RAG App | RAG app starter | /src, /rag | RAG agent | OpenAI, Pinecone | High | P2 |
| Agentic Workflow | Multi-agent workflow | /agents, /skills | Orchestrator | AtlasMind | High | P2 |
| Local Model Dev | Local LLM dev | /models, /src | Local model agent | LM Studio | Medium | P2 |
| AI Orchestrator | Task graph, memory | /orchestrator, /tools | Orchestrator agent | AtlasMind | High | P1 |

### 7. DevOps / Infrastructure Packs
| Pack | Description | Structure | Agents/Tools | Deps | Complexity | Priority |
|------|-------------|-----------|--------------|------|-----------|----------|
| Dockerised Full‑Stack | Docker Compose stack | /docker, /src | Docker agent | Docker | Medium | P1 |
| Kubernetes Microservice | K8s microservices | /services, /k8s | K8s agent | Kubernetes | High | P2 |
| Serverless | Serverless starter | /functions, /infra | Serverless agent | AWS/Azure/GCP | Medium | P2 |
| Terraform | Terraform IaC | /terraform, /modules | Terraform agent | Terraform | Medium | P2 |

### 8. Testing & Quality Engineering Packs
| Pack | Description | Structure | Agents/Tools | Deps | Complexity | Priority |
|------|-------------|-----------|--------------|------|-----------|----------|
| Full Testing | Comprehensive test setup | /tests, /src | Test runner agent | Vitest/Jest | Medium | P1 |
| Playwright E2E | Playwright E2E starter | /tests/e2e, /src | Playwright agent | Playwright | Low | P2 |
| API Testing | API test starter | /tests/api, /src | API test agent | Supertest | Low | P2 |

### 9. Business‑Model Packs
| Pack | Description | Structure | Agents/Tools | Deps | Complexity | Priority |
|------|-------------|-----------|--------------|------|-----------|----------|
| Marketplace | Marketplace starter | /marketplace, /api | Marketplace agent | Stripe, DB | High | P2 |
| Subscription | Subscription SaaS | /subscriptions, /api | Subscription agent | Stripe, DB | Medium | P2 |
| Booking | Booking/reservation | /bookings, /api | Booking agent | Calendar API | Medium | P2 |
| CRM | CRM/back-office | /crm, /api | CRM agent | DB | Medium | P2 |

### 10. Utility Packs
| Pack | Description | Structure | Agents/Tools | Deps | Complexity | Priority |
|------|-------------|-----------|--------------|------|-----------|----------|
| Auth | Auth starter | /auth, /src | Auth agent | Auth.js, JWT | Low | P1 |
| Payments | Payments starter | /payments, /src | Payments agent | Stripe, PayPal | Low | P1 |
| Email | Email starter | /email, /src | Email agent | Resend, Postmark | Low | P2 |
| Analytics | Analytics starter | /analytics, /src | Analytics agent | PostHog | Low | P2 |
| Internationalisation | i18n/l10n starter | /i18n, /src | i18n agent | i18next | Low | P2 |
| Accessibility‑First UI | Accessible UI starter | /ui, /src | Accessibility agent | axe-core | Low | P2 |

---

### Release Sequence & Dependencies

- **P1 (First Release):** Shopify, Next.js SaaS, Static Website, Next.js App Router, React SPA, React Native, AI Orchestrator, Dockerised Full‑Stack, Full Testing, Auth, Payments
- **P2:** WooCommerce, BigCommerce, Remix, Laravel, Django, Blog/CMS, SvelteKit, Nuxt, Vue, Expo, Flutter, Godot, Web Game, RAG, Agentic, Local Model, K8s, Serverless, Terraform, Playwright, API Testing, Marketplace, Subscription, Booking, CRM, Email, Analytics, i18n, Accessibility
- **P3:** Magento 2, Wix, Unity, Unreal

**Dependency Graph:**
- Auth & Payments are dependencies for most SaaS, Marketplace, and Subscription packs.
- AI Orchestrator depends on Agentic Workflow & Local Model Dev.
- Full Testing is a dependency for all app starters.
- Dockerised Full‑Stack is a base for Kubernetes Microservice.
- Static Website is a base for Blog/CMS.
- Marketplace depends on Auth, Payments, and SaaS Starter packs.

**Minimum Viable Set:**
Shopify, Next.js SaaS, Static Website, Next.js App Router, React SPA, React Native, AI Orchestrator, Dockerised Full‑Stack, Full Testing, Auth, Payments.
2. Architectural integrity and changes that unlock safer future work.
generated-at: 2026-04-20T11:29:55.094Z
source-paths: README.md | package.json
body-fingerprint: ffbb3f5c
-->
