# Website Studio — a plan to lead the category

**Status:** superseded as the active roadmap by `docs/ui-studio-builder-plan.md`; retained as the strategy
and competitive rationale that led to the approved plan.
**Written:** 2026-08-06, against v0.265.0.
**Audience decision:** agencies *and* developers — the agency workflow as the frame, a real
repository as the artefact.

> **On the competitive claims below.** Every one is marked **[observed]** (I have seen it directly,
> in this codebase or in the products' own public behaviour up to my knowledge cutoff) or
> **[assumed]** (a reasonable inference I have not verified). Nothing here cites a price, a market
> size, or a funding figure, because I cannot verify one and an invented number in a committed file
> is indistinguishable from research six months later. Where a claim needs checking before it drives
> a decision, it says so. This follows the rule `researchRegister.ts` applies to its own findings: an
> uncited claim is demoted to a question, not quietly graded as low-confidence fact.

---

## 1. The thesis

The AI website-building market has converged on one shape: **describe a site, receive a codebase.**
v0, Lovable, Bolt, Figma Make and the rest are extremely good at the first ninety seconds and
progressively worse after that. [observed, in broad terms]

The reason is structural, not a quality gap that a better model closes. These tools have:

- **no memory of the project** — the second prompt does not know what the first one decided, so it
  rewrites things that were already right;
- **no repository** — you export a zip or connect a repo late, and from that moment the tool and the
  code diverge;
- **no review** — nothing distinguishes "I approved this" from "it appeared";
- **no delivery pipeline** — deploying is a separate product you wire up yourself;
- **no client** — they model a builder, not an engagement with a person who has to sign off.

AtlasMind is not better at generating a hero section, and it should not try to be. What it uniquely
has, *today*, already built and already load-bearing:

| Asset | Where it already exists |
|---|---|
| Sits inside the editor, holding the real repository | the whole extension |
| Durable project memory that survives the session | `project_memory/` SSOT, `memoryManager.ts` |
| A guarded promotion engine with backup, approval, verify, rollback | `promotionRunner.ts` |
| A declared, committed team workflow | `workflowConfig.ts` |
| Model routing across subscription, local and pay-per-token | `modelRouter.ts`, `acp.ts` |
| An audit trail with determinism checks | `workflowAuditRecord.ts` |
| A safety posture that refuses rather than improvises | throughout |
| A client-engagement model — intake, stakeholders, follow-ups | `projectDirectorManager.ts` |

**So the claim to make is not "AI builds your website." It is: _the whole client engagement, with a
real repository underneath it and an audit trail through it._**

That claim is defensible because every competitor would have to build the boring half — memory,
repo, review, delivery, governance — to match it, and the boring half is where AtlasMind has already
spent its effort. Meanwhile matching *their* half is a much smaller job: a good canvas and a good
generator, which v0.264.0 and v0.265.0 have now largely built.

---

## 2. Honest competitive read

Including where each genuinely beats us. A strategy document that only lists competitors' weaknesses
is marketing.

**v0 / Lovable / Bolt** — prompt-to-app. **They beat us on:** time to first impressive result, and
polish of generated UI. Somebody with no repo and no editor gets something in ninety seconds; we
require VS Code, a git repo and a configured model provider. [observed] **We beat them on:** anything
that happens after day one. **Do not compete on:** the ninety-second demo. We will lose it, and
trying will pull the product toward statelessness.

**Webflow** — visual builder with hosting and CMS. **They beat us on:** canvas fidelity — real
box-model editing, true responsive control, and a genuinely excellent designer experience; plus a CMS
non-technical clients can actually use. [observed] **We beat them on:** the code being yours, in your
repo, in your pipeline. **Watch:** their code export has historically been the weak point, and if
that changed materially it would narrow our advantage. [assumed — worth checking]

**Framer** — design-tool-shaped site builder. **They beat us on:** motion, interaction design and
sheer visual quality. [observed] Not our fight.

**WordPress + Elementor** — the incumbent by volume. **They beat us on:** ubiquity, plugins, and the
fact that every agency already knows it and every client already has one. [observed] **We beat them
on:** everything about process — version control, review, staging, audit. **Strategic note:** this is
the *migration* story, not the competition story. Agencies stuck on WordPress are our best-qualified
lead, and `wordpress-theme` is already in the framework catalog.

**Figma Make / Figma Sites** — design-native generation. **They beat us on:** starting from a real
design file, which is where agency work often actually starts. [observed] **This is our biggest
genuine gap** — see §3.1.

**Cursor / Claude Code / Copilot Workspace** — AI in the editor. **They beat us on:** raw coding
throughput and mindshare. [observed] **We beat them on:** none of them model a *client website
engagement* at all. This is adjacency, not competition — but it is also where a competitor could
most cheaply attack us, by adding a design surface to an editor agent. **The moat is the engagement
model, not the canvas.**

---

## 3. The five gaps, in dependency order

Each with what "done" means, so it can be argued with rather than nodded at.

### 3.1 Design-token and component round-trip
**The gap.** The canvas produces boxes; generation produces one-off HTML/CSS. There is no component
concept, so the third card on the fourth page is unrelated to the first, and a brand change is a
find-and-replace. Meanwhile the design usually *starts* in Figma, and we cannot read it.

**Done means:** a design-token file is the single source for colour, type and spacing; generated CSS
references tokens, never literals; a wireframe element can be marked "this is the Card component" and
every instance regenerates together; and tokens can be imported from a Figma file or a
`design-tokens.json`.

**Why first:** everything below is worth less without it. Regenerating one page today can produce a
page that no longer matches its neighbours — which is the exact failure that makes people abandon
generated sites.

**Riskiest assumption:** that agencies will maintain a token file. If they will not, this becomes
import-only. [assumed — the cheapest thing to test with three real users]

### 3.2 Content model and real copy
**The gap.** Generated sites contain lorem ipsum and invented headlines. A client cannot review a
site whose words are fictional, so the review that Website Studio's whole workflow builds toward is
performed on something nobody can actually judge.

**Done means:** a content model per page type; content lives in markdown/JSON the client can edit;
generation fills from real content where it exists and **marks placeholders visibly as placeholders**
rather than writing plausible fiction. Plus an import path from the client's existing site.

**Why here:** it is the difference between a demo and a deliverable, and it is the single most common
reason a generated site does not survive contact with a client.

**Non-negotiable:** invented copy must never look like approved copy. The same rule the research
register applies — a fluent uncited answer is worse than a stated gap.

### 3.3 Responsive breakpoints as a first-class thing
**The gap.** `WebsiteWireframe.breakpoint` exists in the type and the canvas only ever draws desktop.
Every real site is mostly viewed on a phone.

**Done means:** draw at three breakpoints, with the mobile layout *derived* from desktop by declared
rules and then overridable — not three unrelated drawings that silently disagree. Generation emits
one responsive stylesheet. The preview switches viewports (the panel already has the control).

**Riskiest assumption:** that derived-then-override is the right model rather than independent
layouts. Worth prototyping both.

### 3.4 Client review with comment-on-element
**The gap.** The staging URL is password-protected and that is the whole review story. Feedback
arrives as an email saying "the hero is too big". This is the workflow AtlasMind claims to own, and
it currently stops one step short of the thing agencies actually spend their week on.

**Done means:** a client opens the staging URL, clicks an element, leaves a comment; the comment
lands against that element in Website Studio; resolving it is a tracked transition, and the
element-scoped prompt from v0.264.0 turns it directly into work.

**This is the strongest differentiator on the list.** It is where the design surface, the engagement
model and the delivery pipeline all meet, and no competitor in §2 does all three.

**Genuinely hard part:** it needs something hosted. AtlasMind is a local extension with a
deny-by-default posture. This may require a small optional service, which is a real architectural
decision with a real security cost — and the reason §4 says "no hosted SaaS" needs revisiting
precisely here, honestly, rather than being waved through.

### 3.5 Accessibility and performance as gates
**The gap.** `accessibilityTarget` is a string in the design system. Nothing checks it. Generated
markup is asked politely for landmarks and alt text.

**Done means:** contrast, landmarks, alt text, heading order and tab order are checked against the
declared target and reported per element on the canvas; performance budgets (image weight, CSS size,
LCP estimate) are checked at generation; both become release gates through the existing
`releasePreparation` machinery, where **`unknown` is already not a pass**.

**Why last in order but not in value:** it depends on generation being stable enough to be worth
gating, and there is an MCP accessibility tool available already, so the marginal cost is low.

---

## 4. What we should deliberately not build

Saying no is most of a strategy.

- **A Figma competitor.** Framer and Figma have thousands of person-years in the canvas. Our canvas
  needs to be good enough to express *structure and intent*, and it now is. Import from Figma; do not
  try to replace it.
- **A hosted SaaS.** It contradicts the local-first, deny-by-default posture that is the actual
  differentiator, and it would put client data on our infrastructure. **The one honest exception is
  §3.4** — client review genuinely needs a rendezvous point. If we do it, it should be the smallest
  possible relay, with the client's site content staying on their host, and it should be an explicit
  architectural decision recorded in `project_memory/decisions/`, not a drift.
- **A WYSIWYG code editor.** Round-tripping hand-edited code back into a visual canvas is where every
  previous generation of this product category died. The canvas describes *intent*; the code is the
  output. Once a human edits generated code, the canvas should say so and stop claiming ownership.
- **Our own hosting.** Cloudflare, Netlify and Vercel are better at it and already in the catalog.
- **A plugin marketplace.** Not until there is a user base that wants one.

---

## 5. Sequenced roadmap

Each phase names the assumption most likely to be wrong, because that is what should be tested first.

**Phase 1 — Make what exists trustworthy.** Design tokens (3.1) and content model (3.2). No new
surfaces. *Riskiest assumption: that the v0.264/0.265 canvas and generator are good enough to build
on, rather than needing a rewrite once real sites go through them.* **Test it by putting three real
client sites through the current tool before writing any of this.**

**Phase 2 — Make it shippable.** Responsive breakpoints (3.3) and the a11y/performance gates (3.5).
By the end of this phase a generated site should be one an agency would actually hand over.
*Riskiest assumption: that generation quality holds up at three breakpoints.*

**Phase 3 — Make it an engagement.** Client review with comment-on-element (3.4), plus the Director
roster becoming the reviewer list. *Riskiest assumption: the hosting decision in §4. Resolve that
before any code.*

**Phase 4 — Make it migrate.** WordPress import: read an existing site into a sitemap, a content
model and a token set. This turns the incumbent's installed base into our pipeline.
*Riskiest assumption: that agencies want to leave WordPress at all. Ask ten before building.*

---

## 6. How we would know it worked

Signals, not vibes. None of these are targets I can set for you — they are the things worth
instrumenting.

- **The retention question:** what fraction of sites generated get regenerated a second time a week
  later? Below roughly half and we have built another ninety-second demo. This is the single most
  diagnostic number on the list.
- **Survival to production:** how many Website Studio projects reach a `production` promotion. This
  is the whole thesis in one metric, and `promotionRunner` already records it.
- **Hand-edit divergence:** how often the generated preview is edited by hand afterwards. High
  divergence means generation is not good enough; *zero* divergence probably means nobody shipped it.
- **Review-cycle count** (once 3.4 exists): rounds of client feedback per project, and time per
  round. This is the number agencies actually feel, and the one they would pay to reduce.
- **The qualitative one that matters most:** does anyone say *"I used it for a real client"*? Three
  of those beat any dashboard.

---

## 7. The uncomfortable summary

Website Studio is now, after v0.264.0 and v0.265.0, **a good design surface attached to an excellent
delivery engine, producing sites that are not yet good enough to hand to a client** — because they
have fictional copy, one breakpoint, no components, and no way for the client to comment on them.

The gap to class-leading is not the canvas and it is not the model. It is §3.2 and §3.4: **real
content, and real client feedback.** Those two are what turn a generator into a product an agency
runs their business on, and neither is primarily an AI problem — which is precisely why the
competitors optimising for AI quality have not closed them.

---

## 8. Direction after UI Studio v0.273.0

The preview is now the product's feedback loop rather than a side utility. A numbered Full Preview step
opens a canonical deterministic draft in VS Code's built-in browser, combining structure, safe visual
tokens, and exact Markdown copy; a separate lab inspects fixed responsive widths. Generated output is
kept one click away but cannot replace the draft. This closes the first half of the “real content” gap:
copy can now be authored and judged in context without asking a model to invent the missing words.

The competitive bar from here is interaction depth, not another gallery of generated pages: responsive
layout editing rather than width-only inspection, state and variant previews, reusable component
instances, asset treatment, accessibility checks on the composed result, and client review on this same
canonical surface. Each should strengthen the one design loop rather than create another preview mode.
