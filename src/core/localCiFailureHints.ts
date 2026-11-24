/**
 * Why the local CI runner container died, in words a person can act on.
 *
 * The runner's own output is .NET and bash: `System.Net.Http.HttpRequestException
 * … PartialChain` is the whole of what somebody saw when antivirus was
 * intercepting the Docker VM's TLS traffic, and the fix — build a derived image
 * that trusts the local root, point one machine setting at it — lived only in a
 * documentation section nothing on the page linked to. The CI-failure taxonomy
 * exists for *GitHub job* logs; nothing read the registration and container
 * phase. This is that reader.
 *
 * Five rules.
 *
 * - **A declared rule table, first match wins.** Every hint names the rule that
 *   produced it, so a wrong hint is a wrong row rather than a wrong guess.
 * - **Only the tail is read, and it is already redacted.** The caller hands over
 *   the last lines the runner printed, after the secret redactor; this module
 *   never sees a token and never keeps more than one matched line.
 * - **Unknown is a hint too, and says so.** A failure no rule recognises still
 *   gets a card that points at the output rather than a blank.
 * - **The fix is named, never performed.** A TLS hint tells somebody to build a
 *   derived image and open one setting. AtlasMind does not build the image,
 *   because that would mean handling a certificate; and it never suggests
 *   turning verification off.
 * - **Nothing here reads a setting, a file or the network.** Lines in, a value
 *   out, which is what lets a test walk every row.
 */

export type LocalCiFailureKind =
  | 'tls-inspection'
  | 'disk'
  | 'image'
  | 'registration-token'
  | 'runner-label'
  | 'unknown';

export interface LocalCiFailureHint {
  kind: LocalCiFailureKind;
  /** The rule that matched. */
  ruleId: string;
  /** One line, in plain words. */
  title: string;
  /** What is going on and what to do. One or two sentences. */
  body: string;
  /** What not to do, where the obvious shortcut is unsafe. */
  avoid?: string;
  /** A host-owned help id resolved to a URL by the dashboard's allowlist; never a URL here. */
  helpId?: string;
  /** The machine setting that holds the fix, when there is one. */
  settingKey?: string;
  /** The redacted output line that decided it, clipped. Absent for `unknown`. */
  matchedLine?: string;
}

interface LocalCiFailureRule {
  id: string;
  kind: LocalCiFailureKind;
  pattern: RegExp;
  title: string;
  body: string;
  avoid?: string;
  helpId?: string;
  settingKey?: string;
}

export const LOCAL_CI_IMAGE_SETTING = 'atlasmind.ci.localRunner.image';

/**
 * Evaluated in order; the first rule whose pattern matches any line decides.
 * TLS comes first because its symptom lines also mention registration and
 * the API, which the later rules would otherwise claim.
 */
export const LOCAL_CI_FAILURE_RULES: readonly LocalCiFailureRule[] = [
  {
    id: 'tls-inspection',
    kind: 'tls-inspection',
    pattern: /PartialChain|unable to get local issuer certificate|certificate verify failed|SSL_ERROR|self[- ]signed certificate in certificate chain|UntrustedRoot|The SSL connection could not be established/i,
    title: 'Something on this computer intercepts secure connections',
    body: 'Antivirus or a corporate proxy is re-signing HTTPS traffic from the Docker VM, and the Linux container does not trust that software\'s certificate, so the runner cannot reach GitHub. Build a copy of the runner image that trusts the verified local root, then point the image setting at it.',
    avoid: 'Do not turn certificate checking off, in the runner or with NODE_TLS_REJECT_UNAUTHORIZED.',
    helpId: 'tls-derived-image',
    settingKey: LOCAL_CI_IMAGE_SETTING,
  },
  {
    id: 'disk-full',
    kind: 'disk',
    pattern: /no space left on device|ENOSPC|disk quota exceeded/i,
    title: 'The Docker disk is full',
    body: 'The container could not write. Free space in Docker Desktop (unused images and build cache are the usual culprits), then start the runner again.',
    helpId: 'runner-troubleshooting',
  },
  {
    id: 'image-missing',
    kind: 'image',
    pattern: /pull access denied|manifest unknown|manifest for .* not found|No such image|repository does not exist|image not known/i,
    title: 'The runner image could not be found',
    body: 'The image the setting names is not present locally and could not be pulled. Check the tag or digest in the image setting; a locally built derived image must exist on this machine before AtlasMind can start it.',
    helpId: 'runner-troubleshooting',
    settingKey: LOCAL_CI_IMAGE_SETTING,
  },
  {
    id: 'registration-token',
    kind: 'registration-token',
    pattern: /Http response code: NotFound from 'POST .*\/actions\/runner-registration'|registration token .*(expired|invalid)|Response status code does not indicate success: 404 .*runner-registration|Invalid configuration provided for token/i,
    title: 'GitHub refused the runner registration',
    body: 'The one-hour registration token was rejected. The usual causes are a token that expired while Docker started, or a GitHub sign-in that lost the repository scope. Sign in again with the GitHub CLI and start the runner again.',
    helpId: 'runner-troubleshooting',
  },
  {
    id: 'runner-label',
    kind: 'runner-label',
    pattern: /A runner exists with the same name|already exists|Runner name .* is already in use/i,
    title: 'A runner with this name is already registered',
    body: 'An earlier container registered under the same name and never removed itself. Remove the stale runner on the repository\'s Actions → Runners page, then start again.',
    helpId: 'runner-troubleshooting',
  },
];

const MAX_LINES_READ = 200;
const MAX_MATCHED_LINE = 240;

/**
 * Read the tail of the runner's redacted output and name the cause.
 *
 * Always returns a hint for a failure, so the card never goes blank; the
 * `unknown` hint says plainly that the output has the detail.
 */
export function classifyLocalCiFailure(recentLines: readonly string[], exitCode: number | null): LocalCiFailureHint {
  const tail = recentLines.slice(-MAX_LINES_READ);
  for (const rule of LOCAL_CI_FAILURE_RULES) {
    const matched = tail.find(line => rule.pattern.test(line));
    if (matched !== undefined) {
      return {
        kind: rule.kind,
        ruleId: rule.id,
        title: rule.title,
        body: rule.body,
        ...(rule.avoid ? { avoid: rule.avoid } : {}),
        ...(rule.helpId ? { helpId: rule.helpId } : {}),
        ...(rule.settingKey ? { settingKey: rule.settingKey } : {}),
        matchedLine: matched.trim().slice(0, MAX_MATCHED_LINE),
      };
    }
  }
  return {
    kind: 'unknown',
    ruleId: 'unknown',
    title: `The runner container stopped with exit code ${exitCode === null ? 'unknown' : String(exitCode)}`,
    body: 'No known cause matched the last lines of its output. Open the runner output; the final lines name what failed.',
    helpId: 'runner-troubleshooting',
  };
}
