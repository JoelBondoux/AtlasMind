# AtlasMind Human-Facing Roadmap

This roadmap provides a clear, user-friendly overview of upcoming features, improvements, and compliance initiatives for AtlasMind. It is updated in sync with the developer backlog and highlights priorities relevant to users, contributors, and stakeholders.

## Upcoming Features & Improvements

### Chat & Orchestrator Refactor (Critical)
- Universal prompt decomposition: All chat prompts (not just /project) are analyzed and, if multi-action, decomposed into subtasks for sequential/parallel execution. Planner is invoked automatically when needed.
- Robust error recovery and feedback: All chat modes (including freeform) attempt auto-recovery on errors, retry with simplified prompts, and always surface actionable feedback bubbles. Autopilot auto-resolves non-critical stops.
- Refactor orchestrator and chat participant to support stepwise execution, progress streaming, and partial recovery for multi-step prompts.
- Update documentation and user guidance to reflect new chat and planning behaviors.

### Project Settings: GDPR Toggle (Security & Compliance)
- Add a GDPR compliance toggle in project settings. When enabled, AtlasMind will:
    - Enforce GDPR regulatory restrictions across the project.
    - Detect, parse, and control retention and transfer of PII data.
    - Deny overrides unless explicit reasoning is provided within GDPR-compliant frameworks.
    - Allow overrides only when justified and logged with GDPR-appropriate rationale.
    - Document all GDPR-related controls and override policies in user-facing and developer documentation.

### Prefab Architecture Packs (Summary)
AtlasMind will deliver fast-start, opinionated project templates for:
    - **E‑Commerce:** Shopify, WooCommerce, BigCommerce, Magento 2, Wix
    - **SaaS/Web Apps:** Next.js, Remix, Laravel, Django, Static, Blog/CMS
    - **Frontend:** Next.js, SvelteKit, Nuxt, React, Vue
    - **Mobile:** React Native, Expo, Flutter
    - **Game Dev:** Unity, Unreal, Godot, Web-based
    - **AI/Automation:** AI SaaS, RAG, Agentic, Local Model, Orchestrator
    - **DevOps:** Docker, Kubernetes, Serverless, Terraform
    - **Testing:** Full, Playwright, API
    - **Business Models:** Marketplace, Subscription, Booking, CRM
    - **Utilities:** Auth, Payments, Email, Analytics, i18n, Accessibility

**First Release Focus:**
Shopify, Next.js SaaS, Static Website, Next.js App Router, React SPA, React Native, AI Orchestrator, Dockerised Full‑Stack, Full Testing, Auth, Payments.

### Ongoing Commitments
- Architectural integrity and changes that unlock safer future work.
- User-facing outcomes, milestones, and backlog order transparency.
- Delivery hygiene: tests, CI, release notes, and documentation.

---

For more details or to contribute, see the full developer backlog in `project_memory/roadmap/improvement-plan.md`.
