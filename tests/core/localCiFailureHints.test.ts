import { describe, expect, it } from 'vitest';
import {
  LOCAL_CI_FAILURE_RULES,
  LOCAL_CI_IMAGE_SETTING,
  classifyLocalCiFailure,
} from '../../src/core/localCiFailureHints.ts';

describe('local CI failure hints', () => {
  /** The failure that cost an evening: raw .NET on screen, the fix in a doc nothing linked. */
  it('names TLS inspection from the runner\'s own words and points at the image setting, never at disabling checks', () => {
    const hint = classifyLocalCiFailure([
      '[runner] Connecting to GitHub…',
      '[runner] System.Net.Http.HttpRequestException: The SSL connection could not be established, see inner exception.',
      '[runner]  ---> System.Security.Authentication.AuthenticationException: The remote certificate is invalid because of errors in the certificate chain: PartialChain',
      '[runner] Container atlasmind-ci-37837bb1c007-a0121173 exited with code 1.',
    ], 1);
    expect(hint).toMatchObject({ kind: 'tls-inspection', ruleId: 'tls-inspection', helpId: 'tls-derived-image', settingKey: LOCAL_CI_IMAGE_SETTING });
    expect(hint.title).toContain('intercepts secure connections');
    expect(hint.body).toContain('copy of the runner image');
    expect(hint.avoid).toContain('Do not turn certificate checking off');
    expect(hint.matchedLine).toContain('SSL connection could not be established');
    expect(hint.matchedLine!.length).toBeLessThanOrEqual(240);
    expect(classifyLocalCiFailure(['curl: (60) unable to get local issuer certificate'], 60).kind).toBe('tls-inspection');
  });

  it('tells disk, image, registration and duplicate-name failures apart', () => {
    expect(classifyLocalCiFailure(['write /tmp/x: no space left on device'], 1)).toMatchObject({ kind: 'disk', ruleId: 'disk-full' });
    expect(classifyLocalCiFailure(['Error response from daemon: pull access denied for atlasmind-runner-local'], 125))
      .toMatchObject({ kind: 'image', settingKey: LOCAL_CI_IMAGE_SETTING });
    expect(classifyLocalCiFailure(["Http response code: NotFound from 'POST https://api.github.com/actions/runner-registration'"], 1))
      .toMatchObject({ kind: 'registration-token' });
    expect(classifyLocalCiFailure(['A runner exists with the same name'], 1)).toMatchObject({ kind: 'runner-label' });
  });

  /** Unknown is a hint too: the card never goes blank, and it says where the detail is. */
  it('returns an unknown hint naming the exit code when nothing matches', () => {
    const hint = classifyLocalCiFailure(['[runner] Listening for Jobs', '[runner] bye'], 137);
    expect(hint).toMatchObject({ kind: 'unknown', ruleId: 'unknown', helpId: 'runner-troubleshooting' });
    expect(hint.title).toContain('exit code 137');
    expect(hint.matchedLine).toBeUndefined();
    expect(classifyLocalCiFailure([], null).title).toContain('exit code unknown');
  });

  it('reads only the tail, so an old symptom cannot explain a new failure', () => {
    const lines = ['PartialChain', ...Array.from({ length: 250 }, (_, index) => `line ${index}`)];
    expect(classifyLocalCiFailure(lines, 1).kind).toBe('unknown');
  });

  it('publishes rules that each carry a help id and never a URL, and never suggest disabling verification', () => {
    for (const rule of LOCAL_CI_FAILURE_RULES) {
      expect(rule.helpId, rule.id).toBeTruthy();
      expect(`${rule.title} ${rule.body} ${rule.avoid ?? ''}`).not.toMatch(/https?:\/\//);
      expect(`${rule.title} ${rule.body}`).not.toMatch(/REJECT_UNAUTHORIZED=0|--insecure|curl -k/);
    }
    expect(new Set(LOCAL_CI_FAILURE_RULES.map(rule => rule.id)).size).toBe(LOCAL_CI_FAILURE_RULES.length);
  });
});
