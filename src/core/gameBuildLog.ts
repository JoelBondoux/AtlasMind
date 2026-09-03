/**
 * Bounded, read-only interpretation of a game build log supplied by a caller.
 *
 * This module never finds or runs a build. Logs are hostile input: an
 * incomplete or over-bound record receives no verdict, and the only retained
 * text is control-stripped, secret-redacted, line-capped diagnostic evidence.
 */

import { GAME_ENGINES, type GameEngine } from './gameEngineIdentity.js';
import { redactSecrets } from '../utils/secretRedactor.js';
import { sanitizeTerminalOutput } from '../utils/terminalOutput.js';

export const GAME_BUILD_LOG_SURFACE_VERIFIED_AT = '2026-09-03';
export const GAME_BUILD_LOG_MAX_CHARS = 500_000;
export const GAME_BUILD_LOG_MAX_LINES = 25_000;
export const GAME_BUILD_LOG_MAX_DIAGNOSTICS = 100;
export const GAME_BUILD_LOG_MAX_DIAGNOSTIC_CHARS = 500;
export const GAME_BUILD_LOG_MAX_PATH_CHARS = 512;

export const GAME_BUILD_LOG_SOURCES = Object.freeze({
  unreal: 'https://dev.epicgames.com/documentation/unreal-engine/build-operations-cooking-packaging-deploying-and-running-projects-in-unreal-engine?lang=en-US',
  unity: 'https://docs.unity3d.com/6000.2/Documentation/Manual/EditorCommandLineArguments.html',
  godot: 'https://docs.godotengine.org/en/4.6/tutorials/editor/command_line_tutorial.html',
});

export type GameBuildVerdict = 'succeeded' | 'failed' | 'no-verdict';
export type GameBuildDiagnosticLevel = 'error' | 'warning';
export type GameBuildPhase = 'build' | 'cook' | 'package' | 'export' | 'total';

export interface GameBuildLogEvidence {
  /** Project-relative display path; file I/O belongs to the caller. */
  readonly path: string;
  /** Complete text already read by the bounded caller. */
  readonly content: string;
  /** True when the caller could not supply the whole report. */
  readonly truncated?: boolean;
  /** Optional exit status captured alongside the report. */
  readonly exitCode?: number;
}

export interface ParseGameBuildLogInput {
  readonly engineIdentity: Readonly<{
    engine: GameEngine;
    version?: string;
    confident: boolean;
  }>;
  readonly report?: GameBuildLogEvidence;
}

export interface GameBuildLogGuidance {
  readonly status: 'verified' | 'not-verified' | 'not-available';
  readonly verifiedAt?: string;
  readonly verifiedRange?: string;
  readonly source?: string;
  /** Display-only template. Nothing in this module can execute it. */
  readonly command?: string;
  readonly detail: string;
}

export interface GameBuildLogParserVerification {
  readonly status: 'verified' | 'not-verified' | 'engine-unknown';
  readonly verifiedAt?: string;
  readonly verifiedRange?: string;
  readonly source?: string;
  readonly detail: string;
}

export interface GameBuildDiagnostic {
  readonly level: GameBuildDiagnosticLevel;
  readonly line: number;
  readonly message: string;
}

export interface GameBuildPhaseTiming {
  readonly phase: GameBuildPhase;
  readonly durationMs: number;
  readonly line: number;
}

interface GameBuildLogBase {
  readonly engine: GameEngine;
  readonly engineVersion?: string;
  readonly verdict: GameBuildVerdict;
  readonly guidance: GameBuildLogGuidance;
}

export interface NoGameBuildLogReport extends GameBuildLogBase {
  readonly status: 'no-report';
  readonly verdict: 'no-verdict';
  readonly reason: string;
}

export interface UnreadableGameBuildLogReport extends GameBuildLogBase {
  readonly status: 'unreadable';
  readonly verdict: 'no-verdict';
  readonly reason: string;
}

export interface AvailableGameBuildLogReport extends GameBuildLogBase {
  readonly status: 'available';
  readonly reportPath: string;
  readonly exitCode?: number;
  readonly parserVerification: GameBuildLogParserVerification;
  readonly verdictReason: string;
  /** Counts lines matched by the declared rules, not engine-native diagnostic objects. */
  readonly matchedErrorLineCount: number;
  readonly matchedWarningLineCount: number;
  readonly diagnostics: readonly GameBuildDiagnostic[];
  readonly diagnosticsTruncated: boolean;
  readonly redacted: boolean;
  readonly timings: readonly GameBuildPhaseTiming[];
  readonly platform?: string;
  readonly configuration?: string;
  readonly artifactBytes?: number;
  readonly ambiguousFields: readonly ('platform' | 'configuration' | 'artifactBytes')[];
}

export type GameBuildLogReport =
  | NoGameBuildLogReport
  | UnreadableGameBuildLogReport
  | AvailableGameBuildLogReport;

interface NormalizedIdentity {
  readonly engine: GameEngine;
  readonly version?: string;
  readonly confident: boolean;
}

interface NormalizedInput {
  readonly identity: NormalizedIdentity;
  readonly report?: GameBuildLogEvidence;
}

interface EngineLogRules {
  readonly successful: readonly RegExp[];
  readonly failed: readonly RegExp[];
  readonly error: readonly RegExp[];
  readonly warning: readonly RegExp[];
}

const SAFE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+ -]{0,63}$/;
const SAFE_METADATA = /^[A-Za-z0-9][A-Za-z0-9._+ -]{0,63}$/;
const CONTROL_CHAR = /[\u0000-\u001f\u007f]/;

const ENGINE_RULES: Readonly<Record<'unreal' | 'unity' | 'godot', EngineLogRules>> = {
  unreal: {
    successful: [
      /\bAutomationTool exiting with ExitCode=0(?:\s|\(|$)/i,
      /\bBUILD SUCCESSFUL\b/i,
    ],
    failed: [
      /\bAutomationTool exiting with ExitCode=[1-9]\d*/i,
      /\bBUILD FAILED\b/i,
      /\b(?:RunUAT|AutomationTool) ERROR:/i,
      /\bERROR:\s+(?:Cook|Package|Build) failed\b/i,
    ],
    error: [
      /(?:^|:\s)(?:fatal\s+)?error:\s/i,
      /\berror\s+(?:C\d{4}|LNK\d{4}|CS\d{4}):/i,
      /\bPackagingResults:\s*Error:/i,
    ],
    warning: [
      /(?:^|:\s)warning:\s/i,
      /\bwarning\s+(?:C\d{4}|CS\d{4}):/i,
      /\bPackagingResults:\s*Warning:/i,
    ],
  },
  unity: {
    successful: [
      /\bBuild completed with (?:a )?result(?: of|:)\s*['"]?Succeeded\b/i,
    ],
    failed: [
      /\bBuild completed with (?:a )?result(?: of|:)\s*['"]?(?:Failed|Cancelled|Unknown)\b/i,
      /\bError building Player\b/i,
      /\bBuildFailedException\b/,
    ],
    error: [
      /(?:^|\s)error\s+(?:CS|BC|IL)\d{4}:/i,
      /^\s*(?:Error|Exception|BuildFailedException)(?::|\s)/i,
      /\bError building Player\b/i,
    ],
    warning: [
      /(?:^|\s)warning\s+(?:CS|BC|IL)\d{4}:/i,
      /^\s*Warning(?::|\s)/i,
    ],
  },
  godot: {
    // Godot documents the command and log destination, but not a stable
    // success/failure footer. Without an exit code, diagnostics are findings
    // and the overall result stays no-verdict.
    successful: [],
    failed: [],
    error: [/^\s*(?:SCRIPT\s+)?ERROR:/i],
    warning: [/^\s*WARNING:/i],
  },
};

/**
 * Interpret one caller-supplied report. This function catches every malformed
 * boundary shape and never throws data from the log back to its caller.
 */
export function parseGameBuildLog(value: unknown): GameBuildLogReport {
  try {
    const normalized = normalizeInput(value);
    if (normalized === undefined) {
      return unavailable('unreadable', unknownIdentity(), 'The build-log input was invalid.');
    }
    const { identity, report } = normalized;
    if (report === undefined) {
      return unavailable(
        'no-report',
        identity,
        'No complete build log was supplied, so AtlasMind has no build verdict.',
      );
    }
    if (report.truncated === true) {
      return unavailable(
        'unreadable',
        identity,
        'The supplied build log was truncated; partial output cannot establish a build verdict.',
      );
    }
    if (report.content.length === 0) {
      return unavailable('unreadable', identity, 'The supplied build log was empty.');
    }
    if (report.content.length > GAME_BUILD_LOG_MAX_CHARS) {
      return unavailable(
        'unreadable',
        identity,
        `The supplied build log exceeded the ${GAME_BUILD_LOG_MAX_CHARS}-character limit.`,
      );
    }

    const cleaned = sanitizeTerminalOutput(report.content);
    const { text, redactedCount } = redactSecrets(cleaned);
    const lines = text.split('\n');
    if (lines.length > GAME_BUILD_LOG_MAX_LINES) {
      return unavailable(
        'unreadable',
        identity,
        `The supplied build log exceeded the ${GAME_BUILD_LOG_MAX_LINES}-line limit.`,
      );
    }
    if (text.trim().length === 0) {
      return unavailable('unreadable', identity, 'The supplied build log contained no readable text.');
    }

    return interpretCompleteLog(identity, report, lines, redactedCount > 0);
  } catch {
    return unavailable('unreadable', unknownIdentity(), 'The build-log input could not be read safely.');
  }
}

function normalizeInput(value: unknown): NormalizedInput | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const identity = normalizeIdentity(record.engineIdentity);
  if (identity === undefined) {
    return undefined;
  }
  if (record.report === undefined) {
    return { identity };
  }
  if (typeof record.report !== 'object' || record.report === null || Array.isArray(record.report)) {
    return undefined;
  }
  const candidate = record.report as Record<string, unknown>;
  const reportPath = normalizeReportPath(candidate.path);
  if (reportPath === undefined || typeof candidate.content !== 'string') {
    return undefined;
  }
  if (candidate.truncated !== undefined && typeof candidate.truncated !== 'boolean') {
    return undefined;
  }
  if (candidate.exitCode !== undefined
    && (typeof candidate.exitCode !== 'number'
      || !Number.isSafeInteger(candidate.exitCode)
      || candidate.exitCode < 0
      || candidate.exitCode > 2_147_483_647)) {
    return undefined;
  }
  return {
    identity,
    report: {
      path: reportPath,
      content: candidate.content,
      ...(candidate.truncated === undefined ? {} : { truncated: candidate.truncated }),
      ...(candidate.exitCode === undefined ? {} : { exitCode: candidate.exitCode }),
    },
  };
}

function normalizeIdentity(value: unknown): NormalizedIdentity | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.engine !== 'string'
    || !(GAME_ENGINES as readonly string[]).includes(record.engine)
    || typeof record.confident !== 'boolean') {
    return undefined;
  }
  if (record.version !== undefined
    && (typeof record.version !== 'string'
      || !SAFE_VERSION.test(record.version)
      || CONTROL_CHAR.test(record.version))) {
    return undefined;
  }
  return {
    engine: record.engine as GameEngine,
    ...(record.version === undefined ? {} : { version: record.version }),
    confident: record.confident,
  };
}

function normalizeReportPath(value: unknown): string | undefined {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > GAME_BUILD_LOG_MAX_PATH_CHARS
    || CONTROL_CHAR.test(value)) {
    return undefined;
  }
  const normalized = value.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    return undefined;
  }
  const segments = normalized.split('/');
  return segments.some(segment => !segment || segment === '.' || segment === '..')
    ? undefined
    : normalized;
}

function unknownIdentity(): NormalizedIdentity {
  return { engine: 'unknown', confident: false };
}

function unavailable(
  status: 'no-report' | 'unreadable',
  identity: NormalizedIdentity,
  reason: string,
): NoGameBuildLogReport | UnreadableGameBuildLogReport {
  return {
    status,
    engine: identity.engine,
    ...(identity.version === undefined ? {} : { engineVersion: identity.version }),
    verdict: 'no-verdict',
    reason,
    guidance: guidanceFor(identity),
  } as NoGameBuildLogReport | UnreadableGameBuildLogReport;
}

function guidanceFor(identity: NormalizedIdentity): GameBuildLogGuidance {
  const verification = verificationFor(identity);
  if (verification.status !== 'verified' || !isKnownEngine(identity.engine)) {
    return {
      status: verification.status === 'not-verified' ? 'not-verified' : 'not-available',
      ...(verification.verifiedAt === undefined ? {} : { verifiedAt: verification.verifiedAt }),
      ...(verification.verifiedRange === undefined ? {} : { verifiedRange: verification.verifiedRange }),
      ...(verification.source === undefined ? {} : { source: verification.source }),
      detail: verification.status === 'not-verified'
        ? `${verification.detail} AtlasMind does not suggest an unverified build command.`
        : 'No verified build-log command is available for this engine identity; declare a project-owned command.',
    };
  }

  const commands: Readonly<Record<'unreal' | 'unity' | 'godot', string>> = {
    unreal: '<UNREAL_ROOT>/Engine/Build/BatchFiles/RunUAT BuildCookRun -project=<PROJECT>.uproject -clientconfig=<CONFIGURATION> -platform=<PLATFORM> -build -cook -stage -package',
    unity: '"<UNITY_EDITOR>" -batchmode -quit -projectPath "<PROJECT>" -executeMethod <BUILD_METHOD> -logFile "<LOG>"',
    godot: 'godot --headless --path "<PROJECT>" --log-file "<LOG>" --export-release "<PRESET>" "<OUTPUT>"',
  };
  return {
    status: 'verified',
    verifiedAt: verification.verifiedAt,
    verifiedRange: verification.verifiedRange,
    source: verification.source,
    command: commands[identity.engine],
    detail: identity.engine === 'unreal'
      ? 'Run this yourself with project values and capture stdout/stderr into a project-owned log.'
      : 'Run this yourself with project values; the command names the project-owned log destination.',
  };
}

function verificationFor(identity: NormalizedIdentity): GameBuildLogParserVerification {
  if (!identity.confident || !isKnownEngine(identity.engine)) {
    return {
      status: 'engine-unknown',
      detail: 'The engine family is not confirmed or has no AtlasMind-defined log format.',
    };
  }
  const facts = {
    unreal: { verifiedRange: '5.8', source: GAME_BUILD_LOG_SOURCES.unreal },
    unity: { verifiedRange: '6000.2', source: GAME_BUILD_LOG_SOURCES.unity },
    godot: { verifiedRange: '4.6', source: GAME_BUILD_LOG_SOURCES.godot },
  } as const;
  const fact = facts[identity.engine];
  const common = {
    verifiedAt: GAME_BUILD_LOG_SURFACE_VERIFIED_AT,
    verifiedRange: fact.verifiedRange,
    source: fact.source,
  };
  if (identity.version === undefined || !verifiedVersion(identity.engine, identity.version)) {
    return {
      ...common,
      status: 'not-verified',
      detail: identity.version === undefined
        ? `The ${identity.engine} version is unknown; log rules are not applied.`
        : `The ${identity.engine} log surface is not verified against version ${identity.version}.`,
    };
  }
  return {
    ...common,
    status: 'verified',
    detail: `Log rules are verified against ${identity.engine} ${fact.verifiedRange}.`,
  };
}

function isKnownEngine(engine: GameEngine): engine is 'unreal' | 'unity' | 'godot' {
  return engine === 'unreal' || engine === 'unity' || engine === 'godot';
}

function verifiedVersion(engine: 'unreal' | 'unity' | 'godot', version: string): boolean {
  if (engine === 'unreal') return version === '5.8';
  if (engine === 'unity') return version === '6000.2' || version.startsWith('6000.2.');
  return version === '4.6' || version.startsWith('4.6.');
}

function interpretCompleteLog(
  identity: NormalizedIdentity,
  report: GameBuildLogEvidence,
  lines: readonly string[],
  redacted: boolean,
): AvailableGameBuildLogReport {
  const parserVerification = verificationFor(identity);
  const verifiedEngine = parserVerification.status === 'verified' && isKnownEngine(identity.engine)
    ? identity.engine
    : undefined;
  const rules = verifiedEngine === undefined
    ? undefined
    : ENGINE_RULES[verifiedEngine];
  const diagnostics = rules === undefined
    ? { errors: 0, warnings: 0, records: [] as GameBuildDiagnostic[] }
    : collectDiagnostics(lines, rules);
  const markerOutcome = rules === undefined
    ? { successful: false, failed: false }
    : collectOutcome(lines, rules);
  const outcome = deriveVerdict(report.exitCode, markerOutcome);
  const metadata = verifiedEngine === undefined
    ? emptyMetadata()
    : collectMetadata(verifiedEngine, lines);

  return {
    status: 'available',
    engine: identity.engine,
    ...(identity.version === undefined ? {} : { engineVersion: identity.version }),
    verdict: outcome.verdict,
    verdictReason: outcome.reason,
    guidance: guidanceFor(identity),
    reportPath: report.path,
    ...(report.exitCode === undefined ? {} : { exitCode: report.exitCode }),
    parserVerification,
    matchedErrorLineCount: diagnostics.errors,
    matchedWarningLineCount: diagnostics.warnings,
    diagnostics: diagnostics.records,
    diagnosticsTruncated: diagnostics.errors + diagnostics.warnings > diagnostics.records.length,
    redacted,
    timings: metadata.timings,
    ...(metadata.platform === undefined ? {} : { platform: metadata.platform }),
    ...(metadata.configuration === undefined ? {} : { configuration: metadata.configuration }),
    ...(metadata.artifactBytes === undefined ? {} : { artifactBytes: metadata.artifactBytes }),
    ambiguousFields: metadata.ambiguousFields,
  };
}

function collectDiagnostics(lines: readonly string[], rules: EngineLogRules): {
  errors: number;
  warnings: number;
  records: GameBuildDiagnostic[];
} {
  let errors = 0;
  let warnings = 0;
  const records: GameBuildDiagnostic[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const level = matchesAny(line, rules.error)
      ? 'error'
      : matchesAny(line, rules.warning) ? 'warning' : undefined;
    if (level === undefined) continue;
    if (level === 'error') errors += 1;
    else warnings += 1;
    if (records.length < GAME_BUILD_LOG_MAX_DIAGNOSTICS) {
      records.push({
        level,
        line: index + 1,
        message: line.trim().slice(0, GAME_BUILD_LOG_MAX_DIAGNOSTIC_CHARS),
      });
    }
  }
  return { errors, warnings, records };
}

function collectOutcome(lines: readonly string[], rules: EngineLogRules): {
  successful: boolean;
  failed: boolean;
} {
  return {
    successful: lines.some(line => matchesAny(line, rules.successful)),
    failed: lines.some(line => matchesAny(line, rules.failed)),
  };
}

function matchesAny(line: string, patterns: readonly RegExp[]): boolean {
  return patterns.some(pattern => {
    pattern.lastIndex = 0;
    return pattern.test(line);
  });
}

function deriveVerdict(
  exitCode: number | undefined,
  markers: { successful: boolean; failed: boolean },
): { verdict: GameBuildVerdict; reason: string } {
  const successful = exitCode === 0 || markers.successful;
  const failed = (exitCode !== undefined && exitCode !== 0) || markers.failed;
  if (successful && failed) {
    return {
      verdict: 'no-verdict',
      reason: 'The report contains conflicting completion evidence, so AtlasMind withholds the verdict.',
    };
  }
  if (failed) {
    return { verdict: 'failed', reason: 'A captured non-zero exit code or verified failure marker reports failure.' };
  }
  if (successful) {
    return { verdict: 'succeeded', reason: 'A captured zero exit code or verified success marker reports success.' };
  }
  return {
    verdict: 'no-verdict',
    reason: 'No captured exit code or verified completion marker established the build result.',
  };
}

interface ParsedMetadata {
  timings: GameBuildPhaseTiming[];
  platform?: string;
  configuration?: string;
  artifactBytes?: number;
  ambiguousFields: Array<'platform' | 'configuration' | 'artifactBytes'>;
}

function emptyMetadata(): ParsedMetadata {
  return { timings: [], ambiguousFields: [] };
}

function collectMetadata(engine: 'unreal' | 'unity' | 'godot', lines: readonly string[]): ParsedMetadata {
  const timings = new Map<GameBuildPhase, GameBuildPhaseTiming>();
  const platforms = new Set<string>();
  const configurations = new Set<string>();
  const artifactSizes = new Set<number>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const timing = parseTiming(engine, line, index + 1);
    if (timing !== undefined) timings.set(timing.phase, timing);

    if (engine === 'unreal') {
      addSafeMatch(platforms, /(?:^|\s)-platform=([A-Za-z0-9._+-]{1,64})(?:\s|$)/i, line);
      addSafeMatch(configurations, /(?:^|\s)-clientconfig=([A-Za-z0-9._+-]{1,64})(?:\s|$)/i, line);
    } else if (engine === 'unity') {
      addSafeMatch(platforms, /^\s*Target:\s*([A-Za-z0-9._+ -]{1,64})\s*$/i, line);
    }

    const size = /^\s*Total size in bytes:\s*(\d+)\s*$/i.exec(line)?.[1];
    if (size !== undefined) {
      const parsed = Number(size);
      if (Number.isSafeInteger(parsed) && parsed >= 0) artifactSizes.add(parsed);
    }
  }

  const ambiguousFields: ParsedMetadata['ambiguousFields'] = [];
  if (platforms.size > 1) ambiguousFields.push('platform');
  if (configurations.size > 1) ambiguousFields.push('configuration');
  if (artifactSizes.size > 1) ambiguousFields.push('artifactBytes');
  return {
    timings: [...timings.values()],
    ...(platforms.size === 1 ? { platform: [...platforms][0] } : {}),
    ...(configurations.size === 1 ? { configuration: [...configurations][0] } : {}),
    ...(artifactSizes.size === 1 ? { artifactBytes: [...artifactSizes][0] } : {}),
    ambiguousFields,
  };
}

function addSafeMatch(target: Set<string>, pattern: RegExp, line: string): void {
  pattern.lastIndex = 0;
  const value = pattern.exec(line)?.[1]?.trim();
  if (value !== undefined && SAFE_METADATA.test(value)) target.add(value);
}

function parseTiming(
  engine: 'unreal' | 'unity' | 'godot',
  line: string,
  lineNumber: number,
): GameBuildPhaseTiming | undefined {
  if (engine === 'unreal') {
    const total = /\bAutomationTool executed for\s+(\d+)h\s+(\d+)m\s+(\d+(?:\.\d+)?)s\b/i.exec(line);
    if (total !== null) {
      return timing('total', ((Number(total[1]) * 60 + Number(total[2])) * 60 + Number(total[3])) * 1000, lineNumber);
    }
    const stage = /\bCompleted(?:\s+Launch On)?\s+Stage:\s*(Build|Cook|Package)\b[^\n]*?\bTime:\s*(\d+(?:\.\d+)?)/i.exec(line);
    if (stage !== null) {
      return timing(stage[1].toLowerCase() as GameBuildPhase, Number(stage[2]) * 1000, lineNumber);
    }
  }

  const generic = /^\s*(Build|Cook|Package|Export|Total)(?:\s+(?:duration|time))?\s*[:=]\s*(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|seconds?|m|minutes?)\s*$/i.exec(line);
  if (generic === null) return undefined;
  const value = Number(generic[2]);
  const unit = generic[3].toLowerCase();
  const multiplier = unit.startsWith('m') && unit !== 'ms' && !unit.startsWith('milli')
    ? 60_000
    : unit.startsWith('s') ? 1000 : 1;
  return timing(generic[1].toLowerCase() as GameBuildPhase, value * multiplier, lineNumber);
}

function timing(
  phase: GameBuildPhase,
  durationMs: number,
  line: number,
): GameBuildPhaseTiming | undefined {
  return Number.isSafeInteger(Math.round(durationMs)) && durationMs >= 0
    ? { phase, durationMs: Math.round(durationMs), line }
    : undefined;
}
