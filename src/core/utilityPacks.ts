/**
 * The six cross-cutting utilities — authentication, payments, email, analytics,
 * internationalisation and accessibility — and the decision each one really is.
 *
 * The other architecture packs are *project* templates: pick a stack, get a
 * starter. These six are not that shape. Nobody starts a project called
 * "payments"; they reach the point in an existing project where money has to
 * change hands, and what they do next is pick a library and discover the
 * decision afterwards. That is the wrong order, and it is the expensive one —
 * whether you or your vendor is the merchant of record is a tax-liability
 * question you cannot undo by swapping an SDK, and whether your analytics sets
 * a cookie decides whether you need a consent banner at all.
 *
 * So a pack here leads with the question and treats the candidates as *answers
 * to it*. Seven rules.
 *
 * **The decision comes before the library.** Every pack states the thing you
 * must settle first and what each answer commits you to. A catalogue that
 * opened with a list of packages would be answering a question the reader has
 * not been asked yet.
 *
 * **Every command is a constant in this file, verified on a stated date, and
 * nothing here runs it.** The same rule `websiteFrameworks` and `acpInstaller`
 * hold: a command composed from a setting, a fetched page or a model is remote
 * code execution with extra steps. {@link UTILITY_PACKS_VERIFIED_AT} says when
 * each was last read from the vendor's own documentation.
 *
 * **An unverified fact is absent, not guessed.** A candidate whose install line
 * was not verified carries none, and the surface says to follow the vendor's
 * current instructions. A plausible-looking wrong package name is worse than no
 * package name: one costs a search, the other installs somebody else's code.
 *
 * **A capability already present is reported, never proposed again.** Two auth
 * libraries in one project is a security problem rather than a redundancy —
 * two session models, two logout paths, and one of them forgotten. Detection
 * that finds two candidates answering *different* sides of the pack's decision
 * reports `ambiguous`, which is a finding, and proposes nothing.
 *
 * **What leaves the machine is stated per candidate**, because "add analytics"
 * means "start sending your users' behaviour to a third party" and a catalogue
 * that omits that is selling rather than advising.
 *
 * **Accessibility is not a library.** It is the one capability here that cannot
 * be installed, and saying otherwise would be the exact failure this project's
 * own testing protocols already name: automated tooling catches roughly 30–40%
 * of WCAG barriers (Deque publish ~57% for axe-core on a first audit), which
 * makes it necessary and not sufficient. The pack lists tools and then states
 * the part a person has to do.
 *
 * **A gate is a statement about the world, not a file that exists.** "Somebody
 * has tried the flow with a screen reader" is a gate. "There is an `auth/`
 * directory" is not, and nothing here marks itself done.
 *
 * Pure, `vscode`-free and unit-tested.
 */

/**
 * When each vendor fact below was last read from the vendor's own documentation.
 *
 * Pinned rather than implied, exactly as `ACP_SPEC_VERIFIED_AT` and
 * `BUZZ_PROTOCOL_VERIFIED_VERSION` are: a catalogue of somebody else's product
 * decays, and a reader deserves to know how old it is rather than to find out.
 */
export const UTILITY_PACKS_VERIFIED_AT = '2026-09-09';

export const UTILITY_CAPABILITIES = [
  'auth',
  'payments',
  'email',
  'analytics',
  'i18n',
  'accessibility',
] as const;

export type UtilityCapability = typeof UTILITY_CAPABILITIES[number];

export interface UtilityDecisionOption {
  id: string;
  label: string;
  /** What choosing this commits the project to. The reason the choice matters. */
  consequence: string;
}

export interface UtilityDecision {
  question: string;
  /** Why this comes before picking anything. */
  why: string;
  options: readonly UtilityDecisionOption[];
}

export interface UtilityCandidate {
  id: string;
  label: string;
  summary: string;
  /** The decision option this candidate is an answer to. */
  answers: string;
  /** Documentation root. Deliberately not a deep link — those rot fastest. */
  docs: string;
  /**
   * The vendor's published install line, where it was verified on
   * {@link UTILITY_PACKS_VERIFIED_AT}. Absent means it was **not** verified,
   * and nothing is quoted rather than something plausible being invented.
   */
  install?: string;
  /** What starts leaving this machine once it is wired up. Never omitted. */
  leavesTheMachine: string;
  /** True when it can run entirely on infrastructure you control. */
  selfHostable: boolean;
  /**
   * Manifest tokens that mean this project already has it.
   *
   * Matched with a real boundary rather than a bare substring, for the reason
   * `testingAutoAssess` gives: this vocabulary is full of hyphens, slashes and
   * `@`, and `\b` behaves surprisingly around all three.
   */
  detect: readonly string[];
}

export interface UtilityGate {
  id: string;
  /** What must be true. A statement about the world, never a file check. */
  statement: string;
  why: string;
}

export interface UtilityPack {
  capability: UtilityCapability;
  label: string;
  /** Why this is not "install a thing". Shown before anything else. */
  premise: string;
  decision: UtilityDecision;
  candidates: readonly UtilityCandidate[];
  gates: readonly UtilityGate[];
  /**
   * False for the one capability that cannot be installed.
   *
   * A flag rather than a special case at each call site, because a surface that
   * forgot would offer "add accessibility" as though it were a dependency.
   */
  installable: boolean;
}

// ── The packs ────────────────────────────────────────────────────

const AUTH_PACK: UtilityPack = {
  capability: 'auth',
  label: 'Authentication',
  premise: 'The library is the small half. The decision is where the user record lives and who is accountable for it when something goes wrong at three in the morning.',
  decision: {
    question: 'Do you hold the user records, or does somebody else?',
    why: 'Everything downstream follows from this and almost none of it is reversible cheaply: where a password reset comes from, who gets the 3am call about a breach, what a migration looks like, whether an enterprise customer can bring their own identity provider, and what you are liable for.',
    options: [
      {
        id: 'self-hosted',
        label: 'You hold them, in your own database',
        consequence: 'You own the data, the migration path and the incident. No per-user bill, and no vendor can change its pricing under you. You are also the one who has to get session handling, rotation and account recovery right.',
      },
      {
        id: 'managed',
        label: 'A managed provider holds them',
        consequence: 'Somebody else runs the hard parts and carries the breach. You accept a per-user cost that grows with success, a dependency on their availability, and an export problem the day you want to leave.',
      },
    ],
  },
  candidates: [
    {
      id: 'better-auth',
      label: 'Better Auth',
      summary: 'A TypeScript authentication library that runs inside your app and stores users in your own database. The Auth.js project became part of Better Auth.',
      answers: 'self-hosted',
      docs: 'https://www.better-auth.com/docs',
      install: 'npm install better-auth',
      leavesTheMachine: 'Nothing, unless you enable a social provider — in which case the exchange goes to that provider and nowhere else.',
      selfHostable: true,
      detect: ['better-auth'],
    },
    {
      id: 'auth-js',
      label: 'Auth.js (NextAuth)',
      summary: 'The long-established option for Next.js and other frameworks; v5 is the current major and the npm package is still named next-auth. Note: the Auth.js project is now part of Better Auth, and its own documentation does not say which new projects should use which.',
      answers: 'self-hosted',
      docs: 'https://authjs.dev',
      install: 'npm install next-auth@beta',
      leavesTheMachine: 'Nothing beyond the OAuth exchange with whichever providers you enable.',
      selfHostable: true,
      detect: ['next-auth', '@auth/core', '@auth/sveltekit', '@auth/express'],
    },
    {
      id: 'clerk',
      label: 'Clerk',
      summary: 'A managed identity provider with drop-in UI components. The fastest route to a working sign-in, and the users live with Clerk.',
      answers: 'managed',
      docs: 'https://clerk.com/docs',
      leavesTheMachine: 'Every user record — email, profile, session — and the sign-in traffic itself.',
      selfHostable: false,
      detect: ['@clerk/'],
    },
    {
      id: 'supabase-auth',
      label: 'Supabase Auth',
      summary: 'Auth as part of a hosted Postgres platform, and self-hostable if you run the stack yourself. Sits on the boundary of the decision above rather than on one side of it.',
      answers: 'managed',
      docs: 'https://supabase.com/docs/guides/auth',
      leavesTheMachine: 'User records and sessions, to Supabase — unless you self-host the whole platform, in which case nothing does.',
      selfHostable: true,
      detect: ['@supabase/supabase-js', '@supabase/auth'],
    },
    {
      id: 'keycloak',
      label: 'Keycloak',
      summary: 'A self-hosted identity server, and the usual answer where SAML, LDAP or an enterprise SSO requirement is already on the table.',
      answers: 'self-hosted',
      docs: 'https://www.keycloak.org/documentation',
      leavesTheMachine: 'Nothing. It runs on infrastructure you operate, which is also the cost.',
      selfHostable: true,
      detect: ['keycloak'],
    },
  ],
  gates: [
    {
      id: 'recovery-tested',
      statement: 'Somebody has completed an account recovery end to end, from a real inbox, on a machine that was never signed in.',
      why: 'Account recovery is the path attackers use and the one nobody tests, because testing it properly means signing out.',
    },
    {
      id: 'session-invalidation',
      statement: 'Changing a password or revoking a session actually ends the other sessions, and somebody has watched it happen.',
      why: 'A logout that leaves a valid token behind is indistinguishable from a working one until it matters.',
    },
    {
      id: 'exit-known',
      statement: 'You know how to get every user record out, and roughly what it would cost to move.',
      why: 'A managed provider is a fine decision. Not knowing the exit is a different decision you did not make on purpose.',
    },
  ],
  installable: true,
};

const PAYMENTS_PACK: UtilityPack = {
  capability: 'payments',
  label: 'Payments',
  premise: 'Taking a card is the easy part and every vendor has solved it. What differs is who is legally selling to your customer, and therefore who owes the tax.',
  decision: {
    question: 'Who is the merchant of record — you, or your payment vendor?',
    why: 'The merchant of record is the legal seller on the invoice. With a payment processor you are the seller, and you are responsible for calculating, collecting and remitting sales tax, VAT and GST in every jurisdiction you sell into. With a merchant of record the vendor sells in its own name and carries that. It is a legal and tax question wearing an integration question\'s clothes, and it is not something you swap later by changing an SDK.',
    options: [
      {
        id: 'processor',
        label: 'You are the merchant of record',
        consequence: 'Lower fees and complete control of the checkout. You register for tax where you owe it, you file, and a tax authority with a question comes to you. This is not advice — a real tax position needs a qualified accountant in each jurisdiction.',
      },
      {
        id: 'merchant-of-record',
        label: 'The vendor is the merchant of record',
        consequence: 'A higher percentage of every sale, and the vendor handles registration, collection, remittance and the disputes. Less control of the checkout and of the customer relationship, and the invoice carries their name rather than yours.',
      },
    ],
  },
  candidates: [
    {
      id: 'stripe',
      label: 'Stripe',
      summary: 'The default payment processor. You remain the merchant of record; Stripe Tax can calculate what you owe but you are still the one who owes it.',
      answers: 'processor',
      docs: 'https://docs.stripe.com',
      install: 'npm install stripe',
      leavesTheMachine: 'Payment details never touch your servers if you use the hosted elements — which is the point. Customer email, address and purchase history do go to Stripe.',
      selfHostable: false,
      detect: ['stripe', '@stripe/stripe-js'],
    },
    {
      id: 'paddle',
      label: 'Paddle',
      summary: 'A merchant of record with the widest jurisdiction coverage of the three: US state sales tax, EU VAT in every member state, UK VAT, Australian GST and several Asian markets.',
      answers: 'merchant-of-record',
      docs: 'https://developer.paddle.com',
      install: 'npm install @paddle/paddle-node-sdk',
      leavesTheMachine: 'The whole transaction and the customer relationship: Paddle is the seller on the invoice.',
      selfHostable: false,
      detect: ['@paddle/paddle-node-sdk', '@paddle/paddle-js'],
    },
    {
      id: 'lemon-squeezy',
      label: 'Lemon Squeezy',
      summary: 'A merchant of record aimed at digital products and indie software; covers US sales tax, EU VAT and a growing list beyond.',
      answers: 'merchant-of-record',
      docs: 'https://docs.lemonsqueezy.com',
      install: 'npm install @lemonsqueezy/lemonsqueezy.js',
      leavesTheMachine: 'The whole transaction, as above.',
      selfHostable: false,
      detect: ['@lemonsqueezy/'],
    },
  ],
  gates: [
    {
      id: 'tax-position-stated',
      statement: 'Somebody can say, in a sentence, who is the merchant of record and which jurisdictions that leaves you registered in.',
      why: 'If nobody can answer that, the decision was made by whichever integration guide was open at the time.',
    },
    {
      id: 'webhook-verified',
      statement: 'Webhook signatures are verified, and an unverified webhook is rejected rather than logged.',
      why: 'An unverified payment webhook is an endpoint that grants entitlements to anybody who can find it.',
    },
    {
      id: 'failure-path',
      statement: 'A declined card, an expired subscription and a refund each have a tested path through your application.',
      why: 'The happy path gets tested because it is the one you build. Revenue is lost on the other three.',
    },
    {
      id: 'no-card-data',
      statement: 'No card number, CVC or full PAN reaches your servers or your logs.',
      why: 'The moment it does, you are in PCI-DSS scope you did not plan for. Every vendor above has a hosted path that avoids it.',
    },
  ],
  installable: true,
};

const EMAIL_PACK: UtilityPack = {
  capability: 'email',
  label: 'Transactional email',
  premise: 'Sending the message is a single API call from any of these. Getting it *delivered* is a DNS problem, and it is the whole of the work.',
  decision: {
    question: 'Who owns the sending domain and its DNS, and has it been authenticated?',
    why: 'Since February 2024 Google and Yahoo require bulk senders — over 5,000 messages a day to their users — to publish SPF and DKIM with at least one aligned for DMARC, to publish a DMARC record of p=none or stronger, and to offer one-click unsubscribe. **Transactional mail counts toward that threshold**; there is no exemption, and everything from one domain is counted together. Enforcement has been live since 2025. Picking a provider before you can change DNS on the sending domain gets the order wrong.',
    options: [
      {
        id: 'provider',
        label: 'A sending provider, with your domain authenticated',
        consequence: 'You publish SPF, DKIM and DMARC records the provider gives you, and their reputation plus yours decides delivery. This is the ordinary answer.',
      },
      {
        id: 'own-infrastructure',
        label: 'Your own mail server',
        consequence: 'Complete control and a reputation you build from nothing on an IP address that may have a history. Rarely the right answer for application mail, and never the quick one.',
      },
    ],
  },
  candidates: [
    {
      id: 'resend',
      label: 'Resend',
      summary: 'A developer-first transactional email API with first-class React email templating.',
      answers: 'provider',
      docs: 'https://resend.com/docs',
      install: 'npm install resend',
      leavesTheMachine: 'Every recipient address and the full body of every message you send.',
      selfHostable: false,
      detect: ['resend'],
    },
    {
      id: 'postmark',
      label: 'Postmark',
      summary: 'Long-standing transactional specialist that deliberately keeps bulk marketing on separate infrastructure, which is why its transactional reputation holds.',
      answers: 'provider',
      docs: 'https://postmarkapp.com/developer',
      leavesTheMachine: 'Recipient addresses and message bodies, as above.',
      selfHostable: false,
      detect: ['postmark'],
    },
    {
      id: 'ses',
      label: 'Amazon SES',
      summary: 'The cheapest at volume and the least helpful about it: you get raw sending, and reputation, bounce handling and complaint processing are yours to build.',
      answers: 'provider',
      docs: 'https://docs.aws.amazon.com/ses/',
      leavesTheMachine: 'Recipient addresses and message bodies, to AWS in the region you choose.',
      selfHostable: false,
      detect: ['@aws-sdk/client-ses', '@aws-sdk/client-sesv2', 'aws-sdk'],
    },
    {
      id: 'nodemailer',
      label: 'Nodemailer',
      summary: 'Not a provider — an SMTP client. Useful in front of any of the above, or in front of your own server, and it makes no delivery promise of its own.',
      answers: 'own-infrastructure',
      docs: 'https://nodemailer.com',
      install: 'npm install nodemailer',
      leavesTheMachine: 'Whatever your SMTP host receives, which is a decision you make separately.',
      selfHostable: true,
      detect: ['nodemailer'],
    },
  ],
  gates: [
    {
      id: 'spf-dkim-dmarc',
      statement: 'The sending domain publishes SPF and DKIM, at least one is aligned, and a DMARC record exists at p=none or stronger.',
      why: 'Below this, Gmail and Yahoo reject rather than spam-folder, and they have done since 2025.',
    },
    {
      id: 'unsubscribe',
      statement: 'Anything that is not strictly transactional carries a working one-click unsubscribe.',
      why: 'It is a bulk-sender requirement, and the spam-complaint rate it protects is the thing that quietly kills a sending domain.',
    },
    {
      id: 'bounces-handled',
      statement: 'Bounces and complaints are processed, and a hard-bouncing address stops being sent to.',
      why: 'Continuing to send to a dead address is the fastest way to lose a domain reputation you spent a year building.',
    },
    {
      id: 'not-in-request',
      statement: 'Sending happens outside the request that triggered it.',
      why: 'A provider outage should slow your email, not fail your sign-ups.',
    },
  ],
  installable: true,
};

const ANALYTICS_PACK: UtilityPack = {
  capability: 'analytics',
  label: 'Analytics',
  premise: 'Adding analytics means beginning to send your users\' behaviour to somebody else. The first question is not which tool — it is whether the tool sets a cookie, because that decides whether you owe your visitors a consent banner.',
  decision: {
    question: 'Cookieless and aggregate, or identified and cookie-based?',
    why: 'Cookieless, aggregate analytics generally need no consent banner and collect no personal data, which removes an entire compliance surface and a piece of UI everybody hates. Identified analytics can answer questions the other kind cannot — funnels, cohorts, session replay — and in exchange you are processing personal data, with the lawful basis, consent flow, retention policy and subject-access obligations that follow.',
    options: [
      {
        id: 'cookieless',
        label: 'Cookieless and aggregate',
        consequence: 'No consent banner in most jurisdictions, no personal data, a script measured in single-digit kilobytes — and you cannot follow an individual through a funnel, which is sometimes exactly what you needed.',
      },
      {
        id: 'identified',
        label: 'Identified, cookie-based product analytics',
        consequence: 'Funnels, retention, replay and experiments. Also a consent banner, a retention policy, a data-processing agreement, and personal data you now hold.',
      },
    ],
  },
  candidates: [
    {
      id: 'plausible',
      label: 'Plausible',
      summary: 'Cookieless, aggregate, one dashboard. Integrates as a script tag rather than as a dependency, and is open source and self-hostable.',
      answers: 'cookieless',
      docs: 'https://plausible.io/docs',
      leavesTheMachine: 'Aggregate page views and referrers. No cookies and no personal data — or nothing at all if you self-host.',
      selfHostable: true,
      detect: ['plausible-tracker', '@plausible-analytics/tracker', 'plausible.io'],
    },
    {
      id: 'umami',
      label: 'Umami',
      summary: 'Cookieless and open source, aimed at self-hosting: a container and a Postgres database, plus a script tag on your site.',
      answers: 'cookieless',
      docs: 'https://umami.is/docs',
      leavesTheMachine: 'Nothing, when self-hosted. That is the reason to choose it.',
      selfHostable: true,
      detect: ['@umami/', 'umami.is'],
    },
    {
      id: 'posthog',
      label: 'PostHog',
      summary: 'Product analytics — funnels, cohorts, replay, feature flags, experiments — with a cookieless mode and EU hosting available, and self-hostable.',
      answers: 'identified',
      docs: 'https://posthog.com/docs',
      install: 'npm install posthog-js',
      leavesTheMachine: 'Behavioural events tied to an identified user, and session replays if you enable them. Replay is the one to think hardest about: it can capture form contents unless you mask them.',
      selfHostable: true,
      detect: ['posthog-js', 'posthog-node'],
    },
    {
      id: 'matomo',
      label: 'Matomo',
      summary: 'Full-featured and self-hostable, with anonymisation and consent tooling built in. Widely used where data residency is a hard requirement.',
      answers: 'identified',
      docs: 'https://matomo.org/docs/',
      leavesTheMachine: 'Nothing when self-hosted; everything a full analytics product collects when using their cloud.',
      selfHostable: true,
      detect: ['matomo', 'piwik'],
    },
    {
      id: 'ga4',
      label: 'Google Analytics 4',
      summary: 'Free and the most widely understood. Also the one with the largest privacy trade-off and, in several EU jurisdictions, the most contested legal position.',
      answers: 'identified',
      docs: 'https://developers.google.com/analytics',
      leavesTheMachine: 'Behavioural data to Google, with the transfer and consent questions that attach to it.',
      selfHostable: false,
      detect: ['gtag', 'react-ga4', 'googletagmanager'],
    },
  ],
  gates: [
    {
      id: 'question-first',
      statement: 'Somebody can name a decision that will be made differently depending on what the analytics say.',
      why: 'Analytics nobody acts on is personal data collected for nothing, which is the worst of both sides of the decision above.',
    },
    {
      id: 'consent-matches',
      statement: 'If the tool sets cookies or identifies users, consent is asked for before it loads — not after.',
      why: 'A banner that appears while the tracker is already running is decoration.',
    },
    {
      id: 'retention-set',
      statement: 'A retention period is set deliberately rather than left at the vendor default.',
      why: 'The default is usually the longest one, and "we kept everything forever" is not a policy anybody chose.',
    },
    {
      id: 'replay-masked',
      statement: 'If session replay is on, inputs are masked and somebody has watched a recording of a real form to check.',
      why: 'Replay is the single easiest way to accidentally record a password or a card number.',
    },
  ],
  installable: true,
};

const I18N_PACK: UtilityPack = {
  capability: 'i18n',
  label: 'Internationalisation',
  premise: 'The library renders a string in a locale. The work is everything around it: who writes the translations, where they live, and how a new one reaches production without a developer.',
  decision: {
    question: 'Who translates, and how does a translation get into the build?',
    why: 'Almost none of these libraries includes translation management. They handle rendering and formatting, and the workflow of writing, reviewing and shipping a translation is left to you. Choosing a library before you know whether translations come from a developer, a translator with a spreadsheet, or a managed platform is choosing the least consequential part first.',
    options: [
      {
        id: 'in-repo',
        label: 'Translation files live in the repository',
        consequence: 'Simple, reviewable, versioned with the code. A translator needs a pull request or somebody to make one for them, which caps how often copy changes.',
      },
      {
        id: 'managed-platform',
        label: 'A translation management platform holds them',
        consequence: 'Non-developers can change copy without a deploy, and you gain a sync step, a subscription, and a source of truth that is not the repository.',
      },
    ],
  },
  candidates: [
    {
      id: 'i18next',
      label: 'i18next / react-i18next',
      summary: 'The most widely used option, with the largest plugin ecosystem and the most existing answers to whatever you hit.',
      answers: 'in-repo',
      docs: 'https://www.i18next.com',
      install: 'npm install i18next react-i18next',
      leavesTheMachine: 'Nothing.',
      selfHostable: true,
      detect: ['i18next', 'react-i18next', 'next-i18next'],
    },
    {
      id: 'next-intl',
      label: 'next-intl',
      summary: 'The shortest path on Next.js, and works inside Server Components without forcing a client boundary.',
      answers: 'in-repo',
      docs: 'https://next-intl.dev',
      install: 'npm install next-intl',
      leavesTheMachine: 'Nothing.',
      selfHostable: true,
      detect: ['next-intl'],
    },
    {
      id: 'formatjs',
      label: 'FormatJS / react-intl',
      summary: 'The most complete ICU MessageFormat implementation — locale-correct plurals, gendered selects, rich text — and the largest of these at roughly 20KB gzipped.',
      answers: 'in-repo',
      docs: 'https://formatjs.github.io/docs/getting-started/installation',
      leavesTheMachine: 'Nothing.',
      selfHostable: true,
      detect: ['react-intl', '@formatjs/'],
    },
    {
      id: 'lingui',
      label: 'Lingui',
      summary: 'Compile-time catalogues and a small runtime, with full ICU support. The choice when bundle size is a real constraint.',
      answers: 'in-repo',
      docs: 'https://lingui.dev',
      leavesTheMachine: 'Nothing.',
      selfHostable: true,
      detect: ['@lingui/'],
    },
    {
      id: 'vue-i18n',
      label: 'vue-i18n',
      summary: 'The standard answer in a Vue or Nuxt application.',
      answers: 'in-repo',
      docs: 'https://vue-i18n.intlify.dev',
      leavesTheMachine: 'Nothing.',
      selfHostable: true,
      detect: ['vue-i18n', '@nuxtjs/i18n'],
    },
  ],
  gates: [
    {
      id: 'no-concatenation',
      statement: 'No user-visible sentence is assembled by concatenating fragments.',
      why: 'Word order differs by language. A sentence built from pieces is a sentence that cannot be translated correctly, and it is the single most expensive thing to undo later.',
    },
    {
      id: 'plurals-are-icu',
      statement: 'Anything with a count uses the library\'s plural handling rather than an `if (n === 1)`.',
      why: 'English has two plural forms. Several languages have three or more, and Japanese has one.',
    },
    {
      id: 'locale-formatting',
      statement: 'Dates, times, numbers and currency are formatted by locale, not by a hand-written format string.',
      why: 'These are where a half-translated interface stops feeling foreign and starts feeling broken.',
    },
    {
      id: 'missing-visible',
      statement: 'A missing translation is visible in development rather than silently falling back to English.',
      why: 'A silent fallback means the gap is found by a user in the locale you added it for.',
    },
  ],
  installable: true,
};

const ACCESSIBILITY_PACK: UtilityPack = {
  capability: 'accessibility',
  label: 'Accessibility',
  premise: 'This is the one capability here that cannot be installed. Automated tooling catches roughly 30–40% of WCAG barriers — Deque publish about 57% for axe-core on a first audit — which makes it necessary and not sufficient. Everything below helps; none of it is the answer.',
  decision: {
    question: 'Who does the part a tool cannot do, and when?',
    why: 'The majority of accessibility barriers are things no automated rule can decide: whether alternative text is *useful*, whether a focus order makes sense, whether an error message tells somebody how to fix it, whether the whole flow works with a keyboard alone. If nobody owns that, a green automated score becomes evidence of compliance that would not survive a real audit — or an EAA enforcement question. In the EU, the European Accessibility Act applied from 28 June 2025, and conformance is presumed via EN 301 549, which incorporates WCAG 2.1 AA.',
    options: [
      {
        id: 'in-team',
        label: 'Somebody on the team owns it, with a recurring manual pass',
        consequence: 'Cheapest and most effective, and it needs a name against it and time in the plan. AtlasMind can hold that as a test case with an owner rather than an intention.',
      },
      {
        id: 'external-audit',
        label: 'An external audit, periodically',
        consequence: 'Expert, thorough, and a snapshot: it tells you about the product on the day it was audited, so it works alongside a routine pass rather than instead of one.',
      },
    ],
  },
  candidates: [
    {
      id: 'axe-core',
      label: 'axe-core',
      summary: 'The engine nearly every other tool is built on. Rules cover WCAG 2.0, 2.1 and 2.2 at A, AA and AAA, and EN 301 549.',
      answers: 'in-team',
      docs: 'https://github.com/dequelabs/axe-core',
      install: 'npm install --save-dev axe-core',
      leavesTheMachine: 'Nothing. It runs locally.',
      selfHostable: true,
      detect: ['axe-core', '@axe-core/'],
    },
    {
      id: 'axe-playwright',
      label: '@axe-core/playwright',
      summary: 'Runs axe inside an existing Playwright suite, so a regression fails a build instead of being found later.',
      answers: 'in-team',
      docs: 'https://playwright.dev/docs/accessibility-testing',
      leavesTheMachine: 'Nothing.',
      selfHostable: true,
      detect: ['@axe-core/playwright'],
    },
    {
      id: 'jest-axe',
      label: 'jest-axe',
      summary: 'The same engine at component level, which is where a violation is cheapest to fix.',
      answers: 'in-team',
      docs: 'https://github.com/nickcolley/jest-axe',
      leavesTheMachine: 'Nothing.',
      selfHostable: true,
      detect: ['jest-axe', 'vitest-axe'],
    },
    {
      id: 'eslint-jsx-a11y',
      label: 'eslint-plugin-jsx-a11y',
      summary: 'Catches a narrow set of mistakes in the editor, before they are written. The earliest and cheapest of these, and the least complete.',
      answers: 'in-team',
      docs: 'https://github.com/jsx-eslint/eslint-plugin-jsx-a11y',
      leavesTheMachine: 'Nothing.',
      selfHostable: true,
      detect: ['eslint-plugin-jsx-a11y'],
    },
    {
      id: 'pa11y',
      label: 'Pa11y',
      summary: 'Runs a scan across a list of URLs from CI, which is the shape that suits a site rather than an application.',
      answers: 'in-team',
      docs: 'https://pa11y.org',
      leavesTheMachine: 'Nothing.',
      selfHostable: true,
      detect: ['pa11y'],
    },
  ],
  gates: [
    {
      id: 'keyboard-only',
      statement: 'Somebody has completed your main flow with the keyboard alone, without touching a mouse.',
      why: 'It takes ten minutes, it needs no tooling, and it finds more than any scanner will.',
    },
    {
      id: 'screen-reader',
      statement: 'Somebody has tried that flow with a screen reader and can say what it announced.',
      why: 'This is the part automation cannot do, and the reason a green score is not a compliance position.',
    },
    {
      id: 'focus-visible',
      statement: 'Focus is always visible, and focus order follows the visual order.',
      why: 'A removed focus ring makes keyboard use guesswork, and it is usually removed on purpose by somebody who did not know.',
    },
    {
      id: 'owned',
      statement: 'A named person owns accessibility, and the manual pass is scheduled rather than intended.',
      why: 'Everything else here is a tool. This is the only line that changes the outcome.',
    },
  ],
  installable: false,
};

export const UTILITY_PACKS: readonly UtilityPack[] = [
  AUTH_PACK,
  PAYMENTS_PACK,
  EMAIL_PACK,
  ANALYTICS_PACK,
  I18N_PACK,
  ACCESSIBILITY_PACK,
];

const PACK_BY_CAPABILITY = new Map(UTILITY_PACKS.map(pack => [pack.capability, pack]));

export function utilityPack(capability: UtilityCapability): UtilityPack | undefined {
  return PACK_BY_CAPABILITY.get(capability);
}

// ── Detection ────────────────────────────────────────────────────

/**
 * Match a token with a real boundary.
 *
 * `\b` is not usable here: this vocabulary is full of `@`, `/` and `-`, all of
 * which `\b` treats as boundaries in surprising places — `@axe-core/` would
 * match inside a longer scope, and `stripe` would match `stripe-mock`. The
 * lookaround pair used by `testingAutoAssess` is the same fix for the same
 * reason.
 */
function matchesToken(corpus: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // A token ending in `/` is a scope prefix and is matched as one; anything
  // else must not be followed by a word character, so `stripe` does not match
  // `stripe-mock` and `matomo` does not match `matomo-tracker-fork`.
  const suffix = token.endsWith('/') ? '' : '(?![a-z0-9-])';
  return new RegExp(`(?<![a-z0-9@/-])${escaped}${suffix}`, 'i').test(corpus);
}

export type UtilityStatus = 'present' | 'absent' | 'ambiguous';

export interface UtilityAssessment {
  capability: UtilityCapability;
  status: UtilityStatus;
  /** Candidate ids found in the project. */
  presentIds: string[];
  /**
   * Which side of the pack's decision the present candidates answer.
   *
   * More than one means the project has answered its own question twice, which
   * is what `ambiguous` reports.
   */
  answeredOptions: string[];
  /** Why the status is what it is, in a sentence the surface can show. */
  note: string;
}

/**
 * What this project already has.
 *
 * `corpus` is the lowercased manifest text the caller already gathers for
 * archetype detection — dependency names, config keys. Nothing is inferred from
 * source shape, for the reason `testingSubjects` refuses to: a declared
 * dependency is a decision somebody made, and an import is not.
 *
 * The interesting result is `ambiguous`. Two candidates answering *different*
 * sides of the pack's decision is not redundancy, it is a project that has two
 * session models, or is both the merchant of record and not — and the right
 * response is to say so rather than to propose a third.
 */
export function assessUtilityPack(pack: UtilityPack, corpus: string): UtilityAssessment {
  const lower = corpus.toLowerCase();
  const present = pack.candidates.filter(candidate =>
    candidate.detect.some(token => matchesToken(lower, token)));
  const presentIds = present.map(candidate => candidate.id);
  const answeredOptions = [...new Set(present.map(candidate => candidate.answers))];

  if (present.length === 0) {
    return {
      capability: pack.capability,
      status: 'absent',
      presentIds,
      answeredOptions,
      note: pack.installable
        ? 'Nothing in this project\'s manifests names any of these. That may be deliberate.'
        : 'No accessibility tooling is declared. Tooling is not the answer here, but its absence usually means nobody has started.',
    };
  }

  if (answeredOptions.length > 1) {
    return {
      capability: pack.capability,
      status: 'ambiguous',
      presentIds,
      answeredOptions,
      note: `This project has ${present.length} of these, and they answer the decision differently: ${present.map(candidate => candidate.label).join(' and ')}. That is worth resolving rather than adding to — two answers to one question usually means one of them is forgotten.`,
    };
  }

  return {
    capability: pack.capability,
    status: 'present',
    presentIds,
    answeredOptions,
    note: `Already using ${present.map(candidate => candidate.label).join(', ')}.`,
  };
}

/** Assess every pack against one corpus. */
export function assessUtilityPacks(corpus: string): UtilityAssessment[] {
  return UTILITY_PACKS.map(pack => assessUtilityPack(pack, corpus));
}

/**
 * The packs worth offering.
 *
 * Only `absent` ones, and never `accessibility` — it is not installable, so
 * "add it" is not an offer anybody can accept. It still appears in an
 * assessment, because *not having started* is the thing worth knowing.
 */
export function offerableUtilityPacks(assessments: readonly UtilityAssessment[]): UtilityCapability[] {
  return assessments
    .filter(assessment => assessment.status === 'absent')
    .map(assessment => assessment.capability)
    .filter(capability => PACK_BY_CAPABILITY.get(capability)?.installable === true);
}

// ── Handing a pack to an agent ───────────────────────────────────

/**
 * The prompt for working through one of these decisions.
 *
 * It exists to help somebody *decide*, and there are two things it must not do.
 * It must not install anything — the install lines here are constants that
 * nothing executes, and an agent running one would make this catalogue an
 * installer. And it must not invent a vendor fact: this text is a snapshot with
 * a date on it, vendors ship faster than AtlasMind releases, and a confidently
 * stated wrong price or package name is the failure mode a catalogue like this
 * has.
 */
export function buildUtilityDecisionPrompt(pack: UtilityPack): string {
  const lines = [
    `Help me decide about ${pack.label.toLowerCase()} for this project.`,
    '',
    pack.premise,
    '',
    `The decision: ${pack.decision.question}`,
    pack.decision.why,
    '',
    ...pack.decision.options.map(option => `  - ${option.label} — ${option.consequence}`),
    '',
    'Candidates AtlasMind holds, as read from each vendor\'s own documentation on '
      + `${UTILITY_PACKS_VERIFIED_AT}:`,
    ...pack.candidates.map(candidate =>
      `  - ${candidate.label}: ${candidate.summary} Leaves the machine: ${candidate.leavesTheMachine}`),
    '',
    'What has to be true afterwards:',
    ...pack.gates.map(gate => `  - ${gate.statement} (${gate.why})`),
    '',
    'Look at this repository first and say which answer fits what is already here —',
    'the stack, the hosting, whether there is a database, who is likely to operate it.',
    '',
    'Two things you must not do.',
    '',
    'Do not install anything, and do not run any command. The lines above are records',
    'of what each vendor publishes, not instructions to execute.',
    '',
    `Do not state a price, a package version or a feature you have not been given here.`,
    'The list above is a snapshot dated ' + UTILITY_PACKS_VERIFIED_AT + ' and vendors change faster',
    'than that. If something matters and is not here, say it needs checking and where.',
  ];
  return lines.filter(line => line !== '').join('\n');
}
