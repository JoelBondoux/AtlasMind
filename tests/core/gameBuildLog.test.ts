import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GAME_BUILD_LOG_MAX_CHARS,
  GAME_BUILD_LOG_MAX_DIAGNOSTICS,
  GAME_BUILD_LOG_MAX_LINES,
  parseGameBuildLog,
} from '../../src/core/gameBuildLog.js';
import type { GameEngine } from '../../src/core/gameEngineIdentity.js';

function input(
  content: string | undefined,
  overrides: {
    engine?: GameEngine;
    version?: string;
    confident?: boolean;
    path?: string;
    truncated?: boolean;
    exitCode?: number;
  } = {},
): unknown {
  const engine = overrides.engine ?? 'unreal';
  const version = Object.prototype.hasOwnProperty.call(overrides, 'version')
    ? overrides.version
    : engine === 'unreal' ? '5.8' : engine === 'unity' ? '6000.2.0b4' : engine === 'godot' ? '4.6' : undefined;
  return {
    engineIdentity: {
      engine,
      ...(version === undefined ? {} : { version }),
      confident: overrides.confident ?? engine !== 'unknown',
    },
    ...(content === undefined ? {} : {
      report: {
        path: overrides.path ?? 'artifacts/build.log',
        content,
        ...(overrides.truncated === undefined ? {} : { truncated: overrides.truncated }),
        ...(overrides.exitCode === undefined ? {} : { exitCode: overrides.exitCode }),
      },
    }),
  };
}

describe('gameBuildLog', () => {
  it('reports no verdict and a verified command when no Unreal report exists', () => {
    expect(parseGameBuildLog(input(undefined))).toMatchObject({
      status: 'no-report',
      engine: 'unreal',
      verdict: 'no-verdict',
      guidance: {
        status: 'verified',
        verifiedRange: '5.8',
        command: expect.stringContaining('RunUAT BuildCookRun'),
      },
    });
  });

  it.each([
    ['unity', '6000.2.0b4', '-batchmode'],
    ['godot', '4.6', '--export-release'],
  ] as const)('names the verified %s command that can produce a log', (engine, version, fragment) => {
    expect(parseGameBuildLog(input(undefined, { engine, version }))).toMatchObject({
      status: 'no-report',
      guidance: { status: 'verified', command: expect.stringContaining(fragment) },
    });
  });

  it('withholds commands for custom, unknown, and unverified engines', () => {
    for (const options of [
      { engine: 'custom' as const, version: 'studio-1' },
      { engine: 'unknown' as const, version: undefined, confident: false },
      { engine: 'unreal' as const, version: '5.9' },
    ]) {
      const result = parseGameBuildLog(input(undefined, options));
      expect(result.guidance.command).toBeUndefined();
      expect(result.guidance.status).not.toBe('verified');
    }
  });

  it('never turns an empty report into zero errors or success', () => {
    const result = parseGameBuildLog(input(''));
    expect(result).toMatchObject({ status: 'unreadable', verdict: 'no-verdict' });
    expect(result).not.toHaveProperty('matchedErrorLineCount');
  });

  it.each([
    input('ok', { path: '../outside.log' }),
    input('ok', { path: 'C:/private/build.log' }),
    input('ok', { truncated: true }),
    input('x'.repeat(GAME_BUILD_LOG_MAX_CHARS + 1)),
    input(Array.from({ length: GAME_BUILD_LOG_MAX_LINES + 1 }, () => 'line').join('\n')),
  ])('refuses unsafe, incomplete, or over-bound evidence', value => {
    expect(parseGameBuildLog(value)).toMatchObject({ status: 'unreadable', verdict: 'no-verdict' });
  });

  it('never throws on hostile boundary shapes, including throwing property access', () => {
    const hostile = new Proxy({}, { get: () => { throw new Error('secret'); } });
    for (const value of [undefined, null, [], hostile, { engineIdentity: null }]) {
      expect(() => parseGameBuildLog(value)).not.toThrow();
      expect(parseGameBuildLog(value)).toMatchObject({ status: 'unreadable', verdict: 'no-verdict' });
    }
  });

  it('strips controls and redacts secrets before retaining Unreal diagnostics', () => {
    const secret = 'sk-abcdefghijklmnopqrstuvwxyz012345';
    const result = parseGameBuildLog(input(
      `\u001b[31mLogCook: Error: failed with ${secret}\u001b[0m\u0000\nAutomationTool exiting with ExitCode=25`,
    ));

    expect(result).toMatchObject({
      status: 'available',
      verdict: 'failed',
      matchedErrorLineCount: 1,
      redacted: true,
    });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f]/);
  });

  it('caps retained diagnostics while preserving matched-line counts', () => {
    const count = GAME_BUILD_LOG_MAX_DIAGNOSTICS + 7;
    const result = parseGameBuildLog(input(
      Array.from({ length: count }, (_, index) => `LogCook: Error: failure ${index}`).join('\n'),
    ));

    expect(result).toMatchObject({
      status: 'available',
      verdict: 'no-verdict',
      matchedErrorLineCount: count,
      diagnosticsTruncated: true,
    });
    if (result.status === 'available') expect(result.diagnostics).toHaveLength(GAME_BUILD_LOG_MAX_DIAGNOSTICS);
  });

  it.each([
    ['unreal', '5.8', 'AutomationTool exiting with ExitCode=0 (Success)', 'succeeded'],
    ['unreal', '5.8', 'AutomationTool exiting with ExitCode=6 (Error_Unknown)', 'failed'],
    ['unity', '6000.2.0b4', "Build completed with a result of 'Succeeded'", 'succeeded'],
    ['unity', '6000.2.0b4', 'Build completed with result: Failed', 'failed'],
  ] as const)('recognises pinned %s completion evidence', (engine, version, content, verdict) => {
    expect(parseGameBuildLog(input(content, { engine, version }))).toMatchObject({
      status: 'available', verdict,
    });
  });

  it('uses a captured exit code for Godot and does not infer success from silence', () => {
    expect(parseGameBuildLog(input('Godot Engine v4.6', { engine: 'godot' }))).toMatchObject({
      status: 'available', verdict: 'no-verdict',
    });
    expect(parseGameBuildLog(input('Godot Engine v4.6', { engine: 'godot', exitCode: 0 }))).toMatchObject({
      status: 'available', verdict: 'succeeded', exitCode: 0,
    });
    expect(parseGameBuildLog(input('ERROR: Export template missing', { engine: 'godot', exitCode: 1 }))).toMatchObject({
      status: 'available', verdict: 'failed', matchedErrorLineCount: 1,
    });
  });

  it('withholds a verdict when exit status and completion marker conflict', () => {
    expect(parseGameBuildLog(input(
      'AutomationTool exiting with ExitCode=0 (Success)\nBUILD FAILED',
    ))).toMatchObject({ status: 'available', verdict: 'no-verdict' });
  });

  it('does not turn a clean or unrecognized complete log into success', () => {
    const result = parseGameBuildLog(input('Build started\n0 errors\nDone'));
    expect(result).toMatchObject({
      status: 'available',
      verdict: 'no-verdict',
      matchedErrorLineCount: 0,
      matchedWarningLineCount: 0,
    });
  });

  it('withholds version-specific log rules outside their verified range', () => {
    expect(parseGameBuildLog(input(
      'AutomationTool exiting with ExitCode=0 (Success)',
      { version: '5.9' },
    ))).toMatchObject({
      status: 'available',
      verdict: 'no-verdict',
      parserVerification: { status: 'not-verified' },
      matchedErrorLineCount: 0,
      diagnostics: [],
    });
  });

  it('reads bounded Unreal stage timings and declared command coordinates', () => {
    const result = parseGameBuildLog(input([
      'Automation.ParseCommandLine: BuildCookRun -platform=Win64 -clientconfig=Development',
      'Completed Launch On Stage: Cook Task, Time: 12.345',
      'AutomationTool executed for 0h 1m 2.5s',
    ].join('\n')));

    expect(result).toMatchObject({
      status: 'available',
      platform: 'Win64',
      configuration: 'Development',
      timings: [
        { phase: 'cook', durationMs: 12_345, line: 2 },
        { phase: 'total', durationMs: 62_500, line: 3 },
      ],
    });
  });

  it('reads Unity BuildReport metadata only when unambiguous', () => {
    const result = parseGameBuildLog(input([
      'Target: StandaloneWindows64',
      'Total size in bytes: 123456',
      'Build duration: 2.5 seconds',
    ].join('\n'), { engine: 'unity' }));
    const ambiguous = parseGameBuildLog(input([
      'Target: Android',
      'Target: StandaloneWindows64',
      'Total size in bytes: 1',
      'Total size in bytes: 2',
    ].join('\n'), { engine: 'unity' }));

    expect(result).toMatchObject({
      status: 'available',
      platform: 'StandaloneWindows64',
      artifactBytes: 123456,
      timings: [{ phase: 'build', durationMs: 2500 }],
      ambiguousFields: [],
    });
    expect(ambiguous).toMatchObject({
      status: 'available',
      ambiguousFields: ['platform', 'artifactBytes'],
    });
    expect(ambiguous).not.toHaveProperty('platform');
    expect(ambiguous).not.toHaveProperty('artifactBytes');
  });

  it('retains no raw log and keeps the parser free of file/process APIs', () => {
    const marker = 'RAW-LOG-MARKER';
    const result = parseGameBuildLog(input(`starting ${marker}\nBUILD SUCCESSFUL`));
    const source = readFileSync(path.resolve(__dirname, '../../src/core/gameBuildLog.ts'), 'utf8');

    expect(JSON.stringify(result)).not.toContain(marker);
    expect(source).not.toMatch(/from ['"](?:node:fs|node:child_process|vscode)['"]/);
    expect(source).not.toMatch(/execFile|spawn|readFile|writeFile|fetch\s*\(/);
  });
});
