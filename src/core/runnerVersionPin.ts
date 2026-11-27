/**
 * Which GitHub Actions runner version the pinned image holds, and whether a
 * person needs to review a newer one.
 *
 * The local runner registers with `--disableupdate`, so the binary that runs a
 * job is the one inside the digest somebody reviewed — not one the listener
 * downloads at job time. (Without the flag GitHub tells an out-of-date runner to
 * update itself as it takes a job; the listener then downloads the new release
 * into the container, renames its own `bin` folder and relaunches, so the
 * digest pin no longer describes what ran, and a runner that updated itself this
 * way inside a container has been seen deleting its own `bin/Runner.Listener`
 * and restart-looping.)
 *
 * The cost of refusing self-update is that the pin can fall behind, and GitHub
 * stops sending jobs to a runner that falls too far behind its latest release.
 * So this module answers one question on every inspection: is the pinned
 * version behind GitHub's latest, and if so, has the newer release been out
 * long enough that jobs may stop arriving? It **never bumps anything**: a new
 * digest is a supply-chain decision, and the remedy it names is the command a
 * person runs to verify the digest before changing the setting.
 *
 * Three rules:
 *
 * - **A version is known only from this table.** The official image carries no
 *   runner-version label, and a tag is a pointer somebody else can move, so an
 *   image is matched by the exact index digest that was reviewed. Anything else
 *   (a tag, a local derivative) is `unknown-image`, said as such.
 * - **An unreadable latest release is `unknown-latest`, never `current`.**
 * - **Nothing here reaches the network.** The caller reads the latest release
 *   (`gh api repos/actions/runner/releases/latest`) and passes it in.
 */

const OFFICIAL_RUNNER_REPOSITORY = 'ghcr.io/actions/actions-runner';

export interface ReviewedRunnerImage {
  version: string;
  /** The multi-architecture index digest, verified against the registry. */
  indexDigest: string;
  /** Per-platform manifests inside that index, for operators who pin one. */
  manifests: { x64: string; arm64: string };
  /** When the digest was checked with `docker buildx imagetools inspect` and the GHCR registry API. */
  reviewedOn: string;
}

/**
 * Newest first. The first entry is the shipped default.
 *
 * 2.338.2 was verified on 2026-11-27 three ways: `docker buildx imagetools
 * inspect ghcr.io/actions/actions-runner:2.338.2`, the `docker-content-digest`
 * header GHCR returns for that tag, and a SHA-256 of the index bytes it serves.
 * 2.336.0 is kept so a machine that still pins it is told it is behind.
 */
export const REVIEWED_RUNNER_IMAGES: readonly ReviewedRunnerImage[] = [
  {
    version: '2.338.2',
    indexDigest: 'sha256:6d0b2d80d80f143f77dcb676e50920100bbb547e39e883454d57f45ab8c31300',
    manifests: {
      x64: 'sha256:4037925f16bd0626196684aff1853dabd242675c82efe08f0a2d376694738d19',
      arm64: 'sha256:73f9d0dfeb4407929795093a3dc9097fda582646610d445b28860e294e020b93',
    },
    reviewedOn: '2026-11-27',
  },
  {
    version: '2.336.0',
    indexDigest: 'sha256:0cfdcc701ce933c6d243c6b0b2da767366dc9f2e99961d4c3754b0b78084cdda',
    manifests: {
      x64: 'sha256:a1919047b038c38871d667c58cfdc7a878452711ab1212fb6036188f27a7ab16',
      arm64: '',
    },
    reviewedOn: '2026-07-21',
  },
];

/**
 * How long GitHub gives a runner registered with `--disableupdate` to move to
 * a newer version before "the GitHub Actions service will not assign jobs to
 * it" (docs.github.com, Actions reference, "Self-hosted runners", read on
 * 2026-11-27). A critical security update can cut this short.
 */
export const RUNNER_UPDATE_GRACE_DAYS = 63;

const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

/** The runner version a reviewed digest holds, or `undefined` when this table does not know the image. */
export function reviewedRunnerVersionForImage(image: string): string | undefined {
  const match = /^([^@\s]+)@(sha256:[a-f0-9]{64})$/i.exec(image.trim());
  if (!match || match[1]!.toLowerCase() !== OFFICIAL_RUNNER_REPOSITORY) {
    return undefined;
  }
  const digest = match[2]!.toLowerCase();
  const entry = REVIEWED_RUNNER_IMAGES.find(candidate => candidate.indexDigest === digest
    || candidate.manifests.x64 === digest
    || (candidate.manifests.arm64 !== '' && candidate.manifests.arm64 === digest));
  return entry?.version;
}

export function compareRunnerVersions(left: string, right: string): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

export interface LatestRunnerRelease {
  version: string;
  publishedAt?: string;
}

/**
 * Read `gh api repos/actions/runner/releases/latest --jq '{tag: .tag_name, published: .published_at}'`.
 * Untrusted text from the network: anything that is not a plain `vX.Y.Z` is
 * refused rather than coerced.
 */
export function parseLatestRunnerRelease(raw: string): LatestRunnerRelease | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const record = value as { tag?: unknown; published?: unknown };
  const tag = typeof record.tag === 'string' ? record.tag.trim().replace(/^v/, '') : '';
  if (!VERSION.test(tag)) {
    return undefined;
  }
  const published = typeof record.published === 'string' && Number.isFinite(Date.parse(record.published))
    ? record.published
    : undefined;
  return { version: tag, ...(published ? { publishedAt: published } : {}) };
}

export type RunnerVersionPinState = 'current' | 'behind' | 'unknown-image' | 'unknown-latest';

export interface RunnerVersionPinAssessment {
  state: RunnerVersionPinState;
  pinnedVersion?: string;
  latestVersion?: string;
  /** True once the newer release has been out longer than the grace period. */
  overdue: boolean;
  /** What to show a person; absent only when the pin is current. */
  warning?: string;
}

export function assessRunnerVersionPin(input: {
  image: string;
  latest: LatestRunnerRelease | undefined;
  now: number;
}): RunnerVersionPinAssessment {
  const pinnedVersion = reviewedRunnerVersionForImage(input.image);
  if (!pinnedVersion) {
    return {
      state: 'unknown-image',
      overdue: false,
      warning: 'AtlasMind cannot tell which runner version the configured image holds (it is not a digest AtlasMind reviewed). '
        + 'The runner registers with --disableupdate, so keep that image current yourself: GitHub stops sending jobs to runners that fall too far behind.',
    };
  }
  if (!input.latest) {
    return {
      state: 'unknown-latest',
      pinnedVersion,
      overdue: false,
      warning: `AtlasMind could not read GitHub's latest runner release, so it cannot say whether the pinned runner ${pinnedVersion} is current.`,
    };
  }
  const latestVersion = input.latest.version;
  if (compareRunnerVersions(pinnedVersion, latestVersion) >= 0) {
    return { state: 'current', pinnedVersion, latestVersion, overdue: false };
  }
  const publishedMs = input.latest.publishedAt ? Date.parse(input.latest.publishedAt) : Number.NaN;
  const overdue = Number.isFinite(publishedMs) && input.now - publishedMs > RUNNER_UPDATE_GRACE_DAYS * 86_400_000;
  const review = `Review the new image and pin its digest in atlasmind.ci.localRunner.image: compare `
    + `\`docker buildx imagetools inspect ${OFFICIAL_RUNNER_REPOSITORY}:${latestVersion}\` with GitHub's package page before trusting it.`;
  return {
    state: 'behind',
    pinnedVersion,
    latestVersion,
    overdue,
    warning: overdue
      ? `The pinned runner ${pinnedVersion} is behind GitHub's ${latestVersion}, released more than ${RUNNER_UPDATE_GRACE_DAYS} days ago, `
        + `and the runner does not update itself. GitHub may stop sending jobs to it. ${review}`
      : `The pinned runner ${pinnedVersion} is behind GitHub's latest release, ${latestVersion}. The runner does not update itself. ${review}`,
  };
}
