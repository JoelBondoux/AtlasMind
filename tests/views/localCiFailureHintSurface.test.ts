import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCAL_CI_FAILURE_RULES } from '../../src/core/localCiFailureHints.ts';

const ROOT = process.cwd();
const read = (file: string): string => readFileSync(path.join(ROOT, file), 'utf8');
const dashboard = read('media/projectDashboard.js');
const host = read('src/views/projectDashboardPanel.ts');
const runner = read('src/core/localCiRunner.ts');
const guide = read('docs/local-ci-and-safe-runners.md');

/**
 * The runner card used to show an exit code and a stack trace in an output
 * channel; the fix for the commonest failure (antivirus re-signing HTTPS) lived
 * in a doc nothing linked to. The card now names the cause from the runner's
 * declared rule table and opens the right door.
 */
describe('local CI failure hints on the runner card', () => {
  it('classifies the redacted tail on a non-zero exit and clears it when a new container starts', () => {
    expect(runner).toContain('classifyLocalCiFailure(this.recentOutput, code)');
    expect(runner).toContain('this.recentOutput = [];');
    expect(runner).toContain('failureHint?: LocalCiFailureHint;');
    // The tail is remembered after redaction, never before.
    const consume = runner.slice(runner.indexOf('private consumeRunnerLine('), runner.indexOf('private rememberOutputLine('));
    expect(consume.indexOf('redactSecrets')).toBeLessThan(consume.indexOf('this.rememberOutputLine(line)'));
  });

  it('renders the hint only for a failed lifecycle, with host-owned help and setting actions', () => {
    expect(dashboard).toContain("const failureHint = runner.lifecycle === 'failed' ? runner.failureHint : undefined;");
    expect(dashboard).toContain('data-action="pipeline-setup-help" data-payload="${escapeAttr(failureHint.helpId)}"');
    expect(dashboard).toContain('data-action="setting" data-payload="${escapeAttr(failureHint.settingKey)}"');
    expect(dashboard).toContain('Open runner output');
    // The image is on the header line, so a pro can see whether the derived tag is in use.
    expect(dashboard).toContain("image <code title=\"${escapeAttr(runner.image || '')}\">${escapeHtml(shortenMiddle(runner.image || '—', 40))}</code>");
  });

  it('resolves every help id a rule names through the host allowlist, which points at a real heading', () => {
    const table = host.slice(host.indexOf('const LOCAL_CI_SETUP_HELP_URLS'), host.indexOf('};', host.indexOf('const LOCAL_CI_SETUP_HELP_URLS')));
    for (const rule of LOCAL_CI_FAILURE_RULES) {
      expect(table, rule.id).toContain(`'${rule.helpId}':`);
    }
    expect(host).toContain("| 'tls-derived-image'");
    expect(host).toContain("| 'runner-troubleshooting'");
    expect(guide).toContain('#### Troubleshooting: the runner container cannot reach GitHub (TLS inspection)');
    expect(guide).toContain('### Troubleshooting the runner container');
    expect(table).toContain('#troubleshooting-the-runner-container-cannot-reach-github-tls-inspection');
  });
});
