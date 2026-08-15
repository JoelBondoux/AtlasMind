/**
 * What AtlasMind *is*, told to the model that answers for it.
 *
 * Guiding somebody to the right page requires knowing the page list, and until
 * this existed neither `SETTINGS_PAGE_IDS` nor `DASHBOARD_PAGE_IDS` was
 * referenced outside the panel that owns it. Nothing put AtlasMind's own surface
 * into a prompt, so every navigational answer chat gave was recall about a
 * product that ships weekly — plausible, specific, and unverifiable by the
 * person reading it. Measured before this module: chat could open 2 of 35
 * addressable pages and reach 26 of 108 declared commands, and it had no list to
 * check either number against.
 *
 * Four rules hold it together.
 *
 * **Declared here, pinned against the panels.** The page catalogue is data in
 * this file rather than an import, because `src/core` must not depend on
 * `src/views` — but a second copy is exactly how the slash-command list once
 * came to describe commands the panel had never heard of. `capabilityIndex.test`
 * asserts this catalogue and the panels' own id arrays are the same set, in both
 * directions, so drift fails the build instead of shipping as a page the model
 * confidently names and nothing can open.
 *
 * **A page carries what it answers, not what it contains.** "Where do I turn off
 * automatic research scans?" has to match on the *question*, so each entry
 * describes the decisions its page settles. A list of widget names would be
 * larger and match nothing anybody asks.
 *
 * **Settings and commands are read from the manifest, never restated.** They
 * change every release and the manifest is the only copy that cannot be stale.
 *
 * **Bounded, and the truncation is stated.** This goes into every prompt, so it
 * is capped — and when the cap bites the text says how many entries were left
 * out, because a silently shortened index reads as a complete one and the model
 * will answer "there is no such setting" with total confidence.
 */

export type CapabilitySurface = 'settings' | 'dashboard';

export interface CapabilityPage {
  surface: CapabilitySurface;
  /** The id the panel's own navigation takes. */
  id: string;
  title: string;
  /** What questions this page settles, in the words somebody would ask them. */
  answers: string;
}

export interface CapabilitySetting {
  key: string;
  description: string;
  default?: unknown;
}

export interface CapabilityCommand {
  command: string;
  title: string;
}

export interface CapabilityIndexInput {
  /** `contributes.configuration.properties` from the manifest. */
  settings?: Record<string, { description?: string; markdownDescription?: string; default?: unknown }>;
  /** `contributes.commands` from the manifest. */
  commands?: Array<{ command: string; title?: string; category?: string }>;
  /** Characters the rendered index may occupy. */
  maxChars?: number;
}

/**
 * Every page either panel can be opened at.
 *
 * Kept in declaration order rather than sorted: it is the order the panels
 * render their navigation in, so a model reading this describes the product the
 * way the operator sees it.
 */
export const CAPABILITY_PAGES: readonly CapabilityPage[] = [
  // Settings panel.
  { surface: 'settings', id: 'overview', title: 'Settings — Overview', answers: 'budget and speed mode, daily spend cap, the main dials' },
  { surface: 'settings', id: 'agents', title: 'Settings — Agents', answers: 'which specialists exist, what each is for, editing their instructions' },
  { surface: 'settings', id: 'models', title: 'Settings — Models', answers: 'providers, API keys, subscriptions, which models are routable, per-model visibility' },
  { surface: 'settings', id: 'discovery', title: 'Settings — Resource Discovery', answers: 'finding and installing MCP servers, agents and catalogues from ARD finders' },
  { surface: 'settings', id: 'mcp', title: 'Settings — MCP Servers', answers: 'connecting an MCP server, importing one from another tool, which tools it exposes' },
  { surface: 'settings', id: 'buzz', title: 'Settings — Buzz', answers: 'the Buzz relay, watched channels, inbound follow-ups, agent bindings' },
  { surface: 'settings', id: 'chat', title: 'Settings — Chat', answers: 'how much conversation is carried between turns, quick replies, voice' },
  { surface: 'settings', id: 'ai-instructions', title: 'Settings — AI Instructions', answers: 'syncing AtlasMind rules into other tools’ instruction files' },
  { surface: 'settings', id: 'safety', title: 'Settings — Safety', answers: 'the tool approval mode, autopilot, what needs confirming before it runs' },
  { surface: 'settings', id: 'testing', title: 'Settings — Testing', answers: 'which testing methodologies this project enforces and who owns each' },
  { surface: 'settings', id: 'project', title: 'Settings — Project', answers: 'approval file threshold, verification scripts, Lens endpoint declarations' },
  { surface: 'settings', id: 'loop', title: 'Settings — Loop', answers: 'mission limits: spend, runtime, attempts, and where a run must stop and ask' },
  { surface: 'settings', id: 'experimental', title: 'Settings — Experimental', answers: 'features not yet on by default' },

  // Project dashboard.
  { surface: 'dashboard', id: 'overview', title: 'Dashboard — Overview', answers: 'what needs a person right now, what moved since last time' },
  { surface: 'dashboard', id: 'score', title: 'Dashboard — Score', answers: 'the project health score and what each component contributes' },
  { surface: 'dashboard', id: 'gapAnalysis', title: 'Dashboard — Gap Analysis', answers: 'what the project is missing against its own declared intent' },
  { surface: 'dashboard', id: 'workflow', title: 'Dashboard — Workflow', answers: 'the eight delivery stages, how far each may go unattended, what blocks one' },
  { surface: 'dashboard', id: 'roadmap', title: 'Dashboard — Roadmap', answers: 'planned work, priorities, release gates, drafting an issue from an item' },
  { surface: 'dashboard', id: 'issues', title: 'Dashboard — Issues', answers: 'GitHub issues, labels and milestones, working on one with Atlas' },
  { surface: 'dashboard', id: 'pullRequests', title: 'Dashboard — Pull Requests', answers: 'open pull requests, review comments, addressing one' },
  { surface: 'dashboard', id: 'director', title: 'Dashboard — Director', answers: 'stakeholders, team, responsibilities, follow-ups and who owns them' },
  { surface: 'dashboard', id: 'branches', title: 'Dashboard — Branches', answers: 'branch state, what is ahead or behind, stale branches' },
  { surface: 'dashboard', id: 'repo', title: 'Dashboard — Repository', answers: 'repository settings, protections and taxonomy' },
  { surface: 'dashboard', id: 'pipeline', title: 'Dashboard — Pipeline', answers: 'CI workflows and their current state' },
  { surface: 'dashboard', id: 'testing', title: 'Dashboard — Testing', answers: 'per-policy coverage, failing tests, what is untested and how bad that is' },
  { surface: 'dashboard', id: 'debt', title: 'Dashboard — Tech Debt', answers: 'deferred work found in the code, how old it is, the rule that graded it' },
  { surface: 'dashboard', id: 'security', title: 'Dashboard — Security', answers: 'dependency and code security findings' },
  { surface: 'dashboard', id: 'privacy', title: 'Dashboard — Privacy', answers: 'what data leaves the machine and what was redacted' },
  { surface: 'dashboard', id: 'risk', title: 'Dashboard — Risk', answers: 'ethical, legal and commercial findings raised by the oversight advisors' },
  { surface: 'dashboard', id: 'release', title: 'Dashboard — Release', answers: 'release gates, the notes as they would publish, the version the commits warrant' },
  { surface: 'dashboard', id: 'delivery', title: 'Dashboard — Delivery', answers: 'deployment stages, promotions, what must be true before production' },
  { surface: 'dashboard', id: 'documents', title: 'Dashboard — Documents', answers: 'which documents are tracked, which are stale, when each was reviewed' },
  { surface: 'dashboard', id: 'ssot', title: 'Dashboard — Project Memory', answers: 'what AtlasMind remembers about this project and where it is stored' },
  { surface: 'dashboard', id: 'runtime', title: 'Dashboard — Runtime', answers: 'local model capacity, what is resident, what is waiting' },
  { surface: 'dashboard', id: 'ideation', title: 'Dashboard — Ideation', answers: 'the whiteboard: problems, requirements, risks, evidence, and raising one as work' },
];

/** How much of a prompt the index may occupy before it is truncated. */
export const DEFAULT_CAPABILITY_INDEX_CHARS = 4000;

const clamp = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;

/**
 * Settings worth naming to the model, with their descriptions from the manifest.
 *
 * Deliberately not every one of the 134: the index is for answering "where do I
 * change X", and a wall of keys crowds out the pages. Anything not listed is
 * still findable — the model is told the prefix and told to say when it is not
 * certain, which is better than it inventing a plausible key.
 */
export function selectIndexedSettings(
  settings: CapabilityIndexInput['settings'],
  limit = 40,
): CapabilitySetting[] {
  if (!settings) {
    return [];
  }
  return Object.entries(settings)
    .slice(0, limit)
    .map(([key, value]) => ({
      key,
      description: clamp(String(value?.description ?? value?.markdownDescription ?? '').split('\n')[0] ?? '', 140),
      ...(value?.default !== undefined ? { default: value.default } : {}),
    }));
}

/**
 * The settings vocabulary, as areas rather than keys.
 *
 * 134 keys with their descriptions do not fit beside 35 pages, and when they did
 * not fit they were dropped **entirely** — measured: `omitted.settings: 134`,
 * zero keys reaching the model. Asked where a setting lived, it therefore had a
 * page list, no key vocabulary at all, and an instruction that only forbade
 * saying a setting did not exist. It invented a file path, a flag and an
 * environment variable, which is close to the expected outcome given what it was
 * handed.
 *
 * The areas cost about 230 characters for all eighteen, so they always fit. They
 * do not name the key — nothing here should, because a key named from memory is
 * exactly the guess that caused this — but they establish that the vocabulary
 * exists, which half of the question, and point at the tool that can read the
 * exact value.
 */
export function buildSettingsNamespaceSummary(
  settings: CapabilityIndexInput['settings'],
): string | undefined {
  const keys = Object.keys(settings ?? {});
  if (keys.length === 0) {
    return undefined;
  }
  const areas = new Map<string, number>();
  for (const key of keys) {
    const parts = key.split('.');
    const area = parts.length > 2 ? parts[1]! : 'general';
    areas.set(area, (areas.get(area) ?? 0) + 1);
  }
  const listed = [...areas.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([area, count]) => `${area} (${count})`)
    .join(', ');

  return `\nSettings: ${keys.length} keys, all named \`atlasmind.<area>.<name>\`, across — ${listed}.`
    + '\nThe exact key is NOT listed here. Read one with the `atlasmind-settings` tool (`action: "get"`) '
    + 'before naming it, and change one with `action: "set"`, which asks the operator first.';
}

export interface CapabilityIndex {
  text: string;
  /** Entries the cap left out, so the caller can say so rather than imply completeness. */
  omitted: { pages: number; settings: number; commands: number };
}

/**
 * Render the index for a prompt.
 *
 * The closing instruction is the load-bearing part. Without it a model handed a
 * page list treats the list as the whole product and answers "there is no such
 * setting" about the 94 it was not shown — which is worse than the recall it
 * replaced, because it sounds checked.
 */
export function buildCapabilityIndex(input: CapabilityIndexInput = {}): CapabilityIndex {
  const maxChars = input.maxChars ?? DEFAULT_CAPABILITY_INDEX_CHARS;
  const settings = selectIndexedSettings(input.settings);
  const commands = (input.commands ?? [])
    .filter(entry => typeof entry.command === 'string' && entry.command.startsWith('atlasmind.'))
    .map(entry => ({ command: entry.command, title: String(entry.title ?? '') }));

  const omitted = { pages: 0, settings: 0, commands: 0 };
  // Says whose surface this is, in the first line.
  //
  // Without it the page ids read as facts about the *workspace*: a model
  // discussing where to put a browser test proposed testing "settings:overview",
  // reasoning about an AtlasMind page as though it were a route in the
  // operator's own project. The index answers "where in AtlasMind", and nothing
  // said that is a different question from "where in this repository".
  const sections: string[] = [
    'AtlasMind surface index — the pages of the AtlasMind extension you are running inside.',
    'These are NOT files, routes or components in the operator\'s workspace. Never cite one as part of '
    + 'the project under discussion, and never test one: they belong to the tool, not to their code.',
  ];

  const pageLines: string[] = [];
  for (const page of CAPABILITY_PAGES) {
    pageLines.push(`- ${page.surface}:${page.id} — ${page.title}: ${page.answers}`);
  }
  sections.push(`\nPages that can be opened:\n${pageLines.join('\n')}`);

  if (settings.length > 0) {
    const total = Object.keys(input.settings ?? {}).length;
    omitted.settings = Math.max(0, total - settings.length);
    sections.push(`\nSettings (all keys begin \`atlasmind.\`; ${total} exist in total):\n${settings.map(entry => `- \`${entry.key}\`${entry.default !== undefined ? ` (default ${JSON.stringify(entry.default)})` : ''} — ${entry.description}`).join('\n')}`);
  }

  if (commands.length > 0) {
    sections.push(`\nCommands (${commands.length}):\n${commands.map(entry => `- \`${entry.command}\` — ${entry.title}`).join('\n')}`);
  }

  // Held out of the budget and appended last, never truncated.
  //
  // It was inside `sections` and the clamp cut from the end, so the larger the
  // real manifest grew the more certainly this line was the first thing dropped
  // — leaving a model holding a partial list and no instruction saying it was
  // partial, which is precisely the state in which it tells the operator a
  // setting does not exist. The rule most worth stating is the one a size cap is
  // most likely to remove.
  // Reserved, and never truncated.
  //
  // The namespace summary joins the closing instruction outside the budget
  // because it is the half that was silently lost: when the settings section did
  // not fit it was dropped *entirely* — measured at `omitted.settings: 134`,
  // zero keys reaching the model — so a model asked where a setting lives had no
  // setting vocabulary whatsoever. All eighteen areas cost about 230 characters.
  // Losing them is what produced an invented file path and an invented
  // environment variable.
  const namespaceSummary = buildSettingsNamespaceSummary(input.settings) ?? '';
  const closing = '\nUse these ids exactly when directing the operator to a page. '
    + 'This index is abbreviated: settings and commands not listed here still exist. '
    + 'Never tell the operator a setting or page does not exist, and never invent where one lives — '
    + 'do not name a settings key, a file path or an environment variable you have not read. '
    + 'If you are not certain, say so and point at the surface that owns it, or read the exact value with `atlasmind-settings`.';
  const budget = Math.max(0, maxChars - namespaceSummary.length - closing.length - 2);

  let body = sections.join('\n');
  if (body.length > budget) {
    // Commands go first, then settings: a page id the operator can be sent to is
    // worth more than a command name they would have to find anyway.
    omitted.commands = commands.length;
    body = sections.filter(section => !section.startsWith('\nCommands')).join('\n');
    if (body.length > budget) {
      omitted.settings += settings.length;
      body = sections.filter(section => !section.startsWith('\nCommands') && !section.startsWith('\nSettings')).join('\n');
    }
    body = clamp(body, budget);
  }

  return { text: `${body}${namespaceSummary}\n${closing}`, omitted };
}

/**
 * Resolve a page from something the operator or the model said.
 *
 * Exact id first, then a title match, then the `answers` text — in that order,
 * because an exact id is a statement and a keyword hit is a guess. Returns every
 * candidate rather than picking one: a caller offering two links is honest, a
 * caller silently choosing between them is not.
 */
export function findCapabilityPages(query: string): CapabilityPage[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) {
    return [];
  }

  const exact = CAPABILITY_PAGES.filter(page =>
    page.id.toLowerCase() === needle || `${page.surface}:${page.id}`.toLowerCase() === needle);
  if (exact.length > 0) {
    return exact;
  }

  const byTitle = CAPABILITY_PAGES.filter(page => page.title.toLowerCase().includes(needle));
  if (byTitle.length > 0) {
    return byTitle;
  }

  const words = needle.split(/\s+/).filter(word => word.length >= 3);
  if (words.length === 0) {
    return [];
  }
  return CAPABILITY_PAGES.filter(page => {
    const haystack = `${page.title} ${page.answers}`.toLowerCase();
    return words.every(word => haystack.includes(word));
  });
}
