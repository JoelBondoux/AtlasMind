/**
 * The GitHub page each dashboard page is about.
 *
 * The dashboard reads GitHub and reasons about it, and then leaves you to find
 * the actual page yourself. That is a small friction repeated many times a day:
 * you look at six stale issues, decide to triage them, and then go to the browser
 * and navigate from the repository root.
 *
 * Three rules shape what is here.
 *
 * **Only surfaces every repository has.** `/wiki` and `/discussions` 404 when the
 * feature is disabled, and a 404 behind a button we drew reads as our bug rather
 * than as a repository setting. Determining which are enabled costs a `gh` call,
 * and a link is not worth a network round trip — so the ones that might not exist
 * are simply absent.
 *
 * **A slug is untrusted input.** It arrives from `gh repo view` or a git remote,
 * both of which can carry whatever a repository's configuration says. It is
 * validated against GitHub's actual naming rules before it is ever interpolated
 * into a URL, and the origin is a constant in this file.
 *
 * **The caller resolves ids, not URLs.** These are handed to a webview, and a
 * webview that could name the URL to open could name any URL. It gets ids; the
 * host maps the id back through this module.
 */

/** Pinned. Not configurable, so no input can redirect a link off GitHub. */
const GITHUB_ORIGIN = 'https://github.com';

/**
 * GitHub's own limits: 1–39 characters for an owner, `[A-Za-z0-9-]` with no
 * leading or trailing hyphen; a repository name adds `_` and `.` and caps at 100.
 * Deliberately stricter than "contains a slash" — the point of validating is to
 * refuse anything that could carry a path segment or a query.
 */
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;

export interface RepoSlug {
  readonly owner: string;
  readonly repo: string;
}

/**
 * Read `owner/repo`, or `undefined`.
 *
 * Never throws and never guesses. A slug that does not parse produces no links at
 * all rather than links to a plausible-looking wrong repository — pointing
 * somebody at somebody else's issue tracker is a worse outcome than no button.
 */
export function parseRepoSlug(raw: string | undefined): RepoSlug | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const trimmed = raw.trim();
  // Tolerate a full URL, since `gh repo view` and git remotes both produce them.
  const withoutOrigin = trimmed
    .replace(/^https?:\/\/(?:www\.)?github\.com\//i, '')
    .replace(/^git@github\.com:/i, '')
    .replace(/\.git$/i, '');
  const parts = withoutOrigin.split('/');
  if (parts.length !== 2) {
    return undefined;
  }
  const [owner, repo] = parts as [string, string];
  if (!OWNER.test(owner) || !REPO.test(repo)) {
    return undefined;
  }
  // A repository may not be named `.` or `..`, and those would escape the path.
  if (repo === '.' || repo === '..') {
    return undefined;
  }
  return { owner, repo };
}

export interface GithubLink {
  /** Stable within a page. What the webview sends back. */
  readonly id: string;
  readonly label: string;
  /** What you will find there, for the title attribute. */
  readonly detail: string;
  readonly url: string;
}

/**
 * The path, and what it is for, per dashboard page.
 *
 * A page with no honest GitHub equivalent gets none. `privacy`, `runtime` and
 * `risk` are about this machine, this extension and this project's own judgement
 * respectively; linking them to a repository page would be inventing a
 * relationship to fill a slot.
 */
const PAGE_LINKS: Readonly<Record<string, ReadonlyArray<{ id: string; label: string; detail: string; path: string }>>> = {
  overview: [
    { id: 'repo', label: 'Repository', detail: 'The repository this dashboard is reading.', path: '' },
    { id: 'pulse', label: 'Pulse', detail: "GitHub's own summary of recent activity.", path: '/pulse' },
  ],
  score: [
    { id: 'pulse', label: 'Pulse', detail: "GitHub's own summary of recent activity, for comparison.", path: '/pulse' },
  ],
  gapAnalysis: [
    { id: 'issues', label: 'Issues', detail: 'Where a gap becomes something somebody is assigned.', path: '/issues' },
  ],
  workflow: [
    {
      id: 'branch-protection',
      label: 'Branch protection',
      detail: 'Where a workflow stops being a habit and becomes a rule. Needs admin on the repository.',
      path: '/settings/branches',
    },
    { id: 'actions', label: 'Actions', detail: 'The workflow runs behind the CI stage.', path: '/actions' },
  ],
  roadmap: [
    { id: 'milestones', label: 'Milestones', detail: "GitHub's own grouping of issues by release.", path: '/milestones' },
  ],
  issues: [
    { id: 'issues', label: 'All issues', detail: 'The full tracker, with GitHub’s own search.', path: '/issues' },
    {
      id: 'unassigned',
      label: 'Unassigned',
      detail: 'Open issues with no assignee — the ones nobody has picked up.',
      path: '/issues?q=is%3Aissue+is%3Aopen+no%3Aassignee',
    },
    { id: 'labels', label: 'Labels', detail: 'The label taxonomy this page manages.', path: '/labels' },
  ],
  pullRequests: [
    { id: 'pulls', label: 'All pull requests', detail: 'The full list, with GitHub’s own filters.', path: '/pulls' },
    {
      id: 'review-requested',
      label: 'Awaiting your review',
      detail: 'Pull requests where your review has been requested.',
      path: '/pulls?q=is%3Apr+is%3Aopen+review-requested%3A%40me',
    },
  ],
  director: [
    {
      id: 'contributors',
      label: 'Contributors',
      detail: 'Who has committed, and how much. Read-only.',
      path: '/graphs/contributors',
    },
  ],
  repo: [
    { id: 'repo', label: 'Repository', detail: 'The repository root.', path: '' },
    { id: 'branches', label: 'Branches', detail: 'Every branch, with ahead/behind against the default.', path: '/branches' },
    { id: 'commits', label: 'Commits', detail: 'The commit history on the default branch.', path: '/commits' },
  ],
  pipeline: [
    { id: 'actions', label: 'Actions', detail: 'Every workflow run, with logs.', path: '/actions' },
  ],
  testing: [
    {
      id: 'test-runs',
      label: 'Actions',
      detail: 'Where the test runs live. A JUnit report is an artifact of a run.',
      path: '/actions',
    },
  ],
  debt: [
    {
      id: 'debt-issues',
      label: 'Tech-debt issues',
      detail: 'Open issues labelled `tech-debt`, if that label is in use.',
      path: '/issues?q=is%3Aissue+is%3Aopen+label%3Atech-debt',
    },
  ],
  security: [
    { id: 'security', label: 'Security', detail: 'Advisories, code scanning and secret scanning.', path: '/security' },
    {
      id: 'dependabot',
      label: 'Dependabot alerts',
      detail: 'Known vulnerabilities in dependencies.',
      path: '/security/dependabot',
    },
  ],
  release: [
    { id: 'releases', label: 'Releases', detail: 'What has actually been published.', path: '/releases' },
    { id: 'tags', label: 'Tags', detail: 'Every tag, including ones with no release.', path: '/tags' },
  ],
  delivery: [
    { id: 'deployments', label: 'Deployments', detail: 'What GitHub has recorded as deployed, and where.', path: '/deployments' },
  ],
  documents: [
    {
      id: 'docs-tree',
      label: 'docs/ on GitHub',
      detail: 'The documentation directory as anybody reading the repository sees it.',
      path: '/tree/HEAD/docs',
    },
  ],
  ssot: [
    {
      id: 'ssot-tree',
      label: 'project_memory/ on GitHub',
      detail: 'The SSOT as committed. It is tracked, so this is what your team sees.',
      path: '/tree/HEAD/project_memory',
    },
  ],
};

/**
 * Pages that intentionally have no GitHub equivalent, listed so the omission is a
 * decision rather than an oversight — and so a test can hold it to that.
 */
export const PAGES_WITHOUT_GITHUB_EQUIVALENT = ['privacy', 'runtime', 'risk', 'ideation'] as const;

/**
 * The links for one dashboard page.
 *
 * Empty when the slug does not parse, when the page has no GitHub equivalent, or
 * when the repository is not on GitHub at all. The caller reports the reason; this
 * function does not invent a link to fill the space.
 */
export function githubLinksForPage(page: string, slug: RepoSlug | undefined): readonly GithubLink[] {
  if (!slug) {
    return [];
  }
  const entries = PAGE_LINKS[page];
  if (!entries) {
    return [];
  }
  const base = `${GITHUB_ORIGIN}/${slug.owner}/${slug.repo}`;
  return entries.map(entry => ({
    id: entry.id,
    label: entry.label,
    detail: entry.detail,
    url: `${base}${entry.path}`,
  }));
}

/**
 * Resolve a page and link id back to a URL.
 *
 * This is the function a message handler calls. It exists so the webview can send
 * `{page, id}` instead of a URL: a surface that could name the URL to open could
 * name any URL, and `openExternal` does not care whose it is.
 */
export function resolveGithubLink(page: string, id: string, slug: RepoSlug | undefined): string | undefined {
  return githubLinksForPage(page, slug).find(link => link.id === id)?.url;
}

/** Why a page shows no links, in a sentence. */
export function describeMissingLinks(page: string, slug: RepoSlug | undefined): string | undefined {
  if (!slug) {
    return 'AtlasMind could not read a GitHub repository for this workspace, so there is nothing to link to. '
      + 'A repository with no GitHub remote, or a `gh` that has not been signed in, both look like this.';
  }
  if (!PAGE_LINKS[page]) {
    // Said plainly rather than left blank: a blank space reads as something that
    // failed to load.
    return 'This page has no GitHub equivalent. What it reports lives in this workspace, not in the repository.';
  }
  return undefined;
}
