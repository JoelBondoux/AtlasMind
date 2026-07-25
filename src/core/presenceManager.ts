import { spawn, type ChildProcess } from 'node:child_process';
import * as os from 'node:os';
import * as fs from 'node:fs';

/**
 * PresenceManager — cross-platform OS "keep-awake" wake lock so an AtlasMind
 * activity that must stay online (a connected Buzz presence, an active Remote
 * Control gateway session, or a long autonomous Mission Loop run) is not killed
 * by system sleep.
 *
 * A VS Code extension runs in the Node.js extension host, NOT Electron's main
 * process, so it cannot call `powerSaveBlocker`. Instead we spawn an OS-native
 * inhibitor helper and tie the wake lock to that child's lifetime — killing it
 * releases the lock. Mirrors {@link HostSpeechSynthesizer}: injectable `spawn`
 * and `platform`, idempotent kill/dispose, `vscode`-free (unit-testable).
 *
 *  - Windows: PowerShell P/Invoking `SetThreadExecutionState(ES_CONTINUOUS |
 *    ES_SYSTEM_REQUIRED [| ES_DISPLAY_REQUIRED])`, re-asserted on a loop that
 *    self-exits if the extension host dies (orphan guard).
 *  - macOS:   `caffeinate -i [-d] -w <hostPid>` (`-w` ties the assertion to the host).
 *  - Linux:   `systemd-inhibit --what=idle:sleep --mode=block` wrapping a PID-guarded keeper.
 *
 * Safety-first: deny-by-default (holds nothing unless a reason is present),
 * AC-power-gated (suspended on battery unless opted out), and bounded by an
 * auto-releasing backstop. The bound is enforced by three independent layers so
 * a stuck or orphaned helper cannot hold the machine awake for long: the
 * host-side `maxAwakeMinutes` timer, a per-OS parent-PID guard that self-exits
 * when the extension host dies, and a helper-side wall-clock deadline baked into
 * the spawned command. No untrusted input is ever interpolated into a command —
 * only validated integers (flags, host PID, minutes) and fixed literals.
 */

/** Minimal subset of `child_process.spawn` used here; injectable for tests. */
export type SpawnLike = typeof spawn;

/** Timer functions, injectable so unit tests never schedule real timers. */
export interface PresenceTimers {
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface PresenceDeps {
  spawn?: SpawnLike;
  platform?: NodeJS.Platform;
  /** PID the OS helper watches so it self-exits if the extension host dies. */
  hostPid?: number;
  timers?: PresenceTimers;
  now?: () => number;
  /** Best-effort AC-power probe; resolves `undefined` when it cannot be determined. */
  detectAcPower?: (platform: NodeJS.Platform, spawnFn: SpawnLike) => Promise<boolean | undefined>;
  /** Diagnostic sink (wired to the extension output channel). */
  onLog?: (message: string) => void;
}

/** Snapshot of the four `atlasmind.presence.*` settings that drive the manager. */
export interface PresenceConfig {
  keepAwake: boolean;
  keepDisplayAwake: boolean;
  acPowerOnly: boolean;
  maxAwakeMinutes: number;
}

export type PresenceSuspendedReason = 'battery' | 'unsupported' | 'backstop';

export interface PresenceState {
  /** Whether a keep-awake backend exists for this platform. */
  supported: boolean;
  /** True when an OS wake lock is currently held. */
  active: boolean;
  /** The activity reasons currently requesting the machine stay awake. */
  reasons: string[];
  /** Why the lock is NOT held despite a reason being present, if applicable. */
  suspended?: PresenceSuspendedReason;
  /** True when the display is also being kept awake (not just the system). */
  displayHeld: boolean;
  /** Epoch ms when the safety backstop will auto-release the lock, if armed. */
  expiresAt?: number;
}

const DEFAULT_CONFIG: PresenceConfig = {
  keepAwake: false,
  keepDisplayAwake: false,
  acPowerOnly: true,
  maxAwakeMinutes: 240,
};

/** Reason contributed by the `atlasmind.presence.keepAwake` master toggle. */
const SETTING_REASON = 'setting';
const RE_ASSERT_SECONDS = 45;
const SLEEP_DETECT_INTERVAL_MS = 15_000;
const AC_POLL_INTERVAL_MS = 120_000;
const RESPAWN_DELAY_MS = 2_000;
/** A helper that lives at least this long is treated as stable (fresh retry budget). */
const STABLE_RUN_MS = 30_000;
const MAX_CONSECUTIVE_FAILURES = 3;
const MAX_AWAKE_MINUTES_CAP = 1440;

// Windows SetThreadExecutionState flags (winbase.h).
const ES_CONTINUOUS = 0x80000000;
const ES_SYSTEM_REQUIRED = 0x00000001;
const ES_DISPLAY_REQUIRED = 0x00000002;

export interface InhibitCommand {
  command: string;
  args: string[];
}

/**
 * Build the OS-native keep-awake command for a platform. Pure and exported so
 * the argv can be unit-tested without spawning anything. Returns `undefined`
 * for unsupported platforms. Only validated integers are interpolated.
 */
export function buildInhibitCommand(
  platform: NodeJS.Platform,
  opts: { keepDisplayAwake?: boolean; hostPid?: number; maxAwakeMinutes?: number } = {},
): InhibitCommand | undefined {
  const hostPid = Number.isInteger(opts.hostPid) && (opts.hostPid as number) > 0
    ? Math.floor(opts.hostPid as number)
    : 0;
  // Optional helper-side hard cap: a self-release deadline baked into the spawned
  // helper so an orphaned helper (host crashed AND its PID was recycled, defeating
  // the PID guard) still self-terminates. 0 = no helper-side cap. This is
  // defence-in-depth beneath the authoritative host-side backstop.
  const maxMin = Number.isFinite(opts.maxAwakeMinutes) && (opts.maxAwakeMinutes as number) > 0
    ? Math.floor(opts.maxAwakeMinutes as number)
    : 0;

  if (platform === 'win32') {
    // ES_CONTINUOUS keeps the assertion in effect until this thread/process exits.
    let flags = ES_CONTINUOUS | ES_SYSTEM_REQUIRED;
    if (opts.keepDisplayAwake) { flags |= ES_DISPLAY_REQUIRED; }
    const flagsU32 = flags >>> 0; // unsigned 32-bit
    // Fixed script: only the validated integers `flagsU32`, `hostPid`, and
    // `maxMin` are interpolated. The parent-PID watch makes the helper self-exit
    // (releasing the lock) if the extension host dies without calling kill(); the
    // fixed deadline caps an orphaned helper's lifetime.
    const script = [
      `$f=[uint32]${flagsU32}`,
      `$hp=${hostPid}`,
      maxMin > 0 ? `$dl=(Get-Date).AddMinutes(${maxMin})` : '$dl=$null',
      `$s='[DllImport("kernel32.dll",SetLastError=true)]public static extern uint SetThreadExecutionState(uint e);'`,
      '$p=Add-Type -MemberDefinition $s -Name PresenceNative -Namespace AtlasMind -PassThru',
      `while(($dl -eq $null) -or ((Get-Date) -lt $dl)){ if($hp -gt 0 -and -not(Get-Process -Id $hp -ErrorAction SilentlyContinue)){break}; [void]$p::SetThreadExecutionState($f); Start-Sleep -Seconds ${RE_ASSERT_SECONDS} }`,
    ].join('; ');
    return {
      command: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    };
  }

  if (platform === 'darwin') {
    // -i prevents idle system sleep (holds on battery too, unlike -s); -w ties
    // the assertion to the extension host; -d also keeps the display on; -t caps
    // an orphaned helper's lifetime.
    const args = opts.keepDisplayAwake ? ['-d', '-i'] : ['-i'];
    if (hostPid > 0) { args.push('-w', String(hostPid)); }
    if (maxMin > 0) { args.push('-t', String(maxMin * 60)); }
    return { command: 'caffeinate', args };
  }

  if (platform === 'linux') {
    // Block only idle→sleep (never shutdown). The lock lives exactly as long as
    // the wrapped command, so wrap a long-lived process we can kill to release.
    // Orphan guard: when we know the host PID, the wrapped command watches it and
    // exits if the extension host dies without calling dispose() — otherwise the
    // inhibitor would be reparented to init and hold the lock until reboot. A
    // bounded iteration count caps an orphaned helper's lifetime. Only the
    // validated integers `hostPid` and `maxMin` are interpolated (no untrusted input).
    const pidGuard = hostPid > 0 ? `kill -0 ${hostPid} 2>/dev/null` : '';
    let keeper: string[];
    if (maxMin > 0) {
      const maxIters = maxMin * 2; // 30s per iteration
      const cond = pidGuard ? `${pidGuard} && [ $i -lt ${maxIters} ]` : `[ $i -lt ${maxIters} ]`;
      keeper = ['sh', '-c', `i=0; while ${cond}; do sleep 30; i=$((i+1)); done`];
    } else if (pidGuard) {
      keeper = ['sh', '-c', `while ${pidGuard}; do sleep 30; done`];
    } else {
      keeper = ['sleep', 'infinity'];
    }
    return {
      command: 'systemd-inhibit',
      args: [
        '--what=idle:sleep',
        '--who=AtlasMind',
        '--why=AtlasMind is keeping the agent online',
        '--mode=block',
        ...keeper,
      ],
    };
  }

  return undefined;
}

/** Pure decision: should the OS wake lock be held right now? */
export function computeDesired(
  reasonCount: number,
  supported: boolean,
  onAcGateOk: boolean,
  backstopFired: boolean,
): boolean {
  return reasonCount > 0 && supported && onAcGateOk && !backstopFired;
}

/** Clamp an untrusted `maxAwakeMinutes` setting into [0, 1440]; NaN → default. */
export function clampMaxAwakeMinutes(value: number): number {
  if (!Number.isFinite(value)) { return DEFAULT_CONFIG.maxAwakeMinutes; }
  return Math.max(0, Math.min(MAX_AWAKE_MINUTES_CAP, Math.floor(value)));
}

const realTimers: PresenceTimers = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as NodeJS.Timeout),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
};

export class PresenceManager {
  private readonly _spawn: SpawnLike;
  private readonly _platform: NodeJS.Platform;
  private readonly _hostPid: number;
  private readonly _timers: PresenceTimers;
  private readonly _now: () => number;
  private readonly _detectAcPower: (platform: NodeJS.Platform, spawnFn: SpawnLike) => Promise<boolean | undefined>;
  private readonly _log: (message: string) => void;

  private _config: PresenceConfig = { ...DEFAULT_CONFIG };
  private readonly _reasons = new Set<string>();
  private _child: ChildProcess | undefined;
  /** Cached AC-power state; `undefined` means unknown → treated as AC (allow). */
  private _onAc: boolean | undefined;
  private _backstopFired = false;
  private _unavailable = false;
  private _displayHeld = false;
  private _expiresAt: number | undefined;
  /** Absolute epoch-ms backstop deadline, preserved across sleep re-acquires. */
  private _backstopDeadline: number | undefined;
  private _failures = 0;
  private _lastTick = 0;
  private _disposed = false;
  /** Was a reason held at the last reconcile? Distinguishes a fresh session. */
  private _hadReasons = false;
  private _spawnAt = 0;
  /** Has the first AC-power probe completed for the current session? */
  private _acProbed = false;
  /** Monotonic id so an out-of-order AC probe result is ignored. */
  private _acProbeGen = 0;

  private _sleepTimer: unknown;
  private _acTimer: unknown;
  private _backstopTimer: unknown;
  private _respawnTimer: unknown;

  private readonly _listeners = new Set<(state: PresenceState) => void>();

  constructor(deps: PresenceDeps = {}) {
    this._spawn = deps.spawn ?? spawn;
    this._platform = deps.platform ?? os.platform();
    this._hostPid = deps.hostPid ?? process.pid;
    this._timers = deps.timers ?? realTimers;
    this._now = deps.now ?? Date.now;
    this._detectAcPower = deps.detectAcPower ?? defaultDetectAcPower;
    this._log = deps.onLog ?? (() => { /* no-op */ });
  }

  /** Whether a keep-awake backend exists for the current platform. */
  public isSupported(): boolean {
    return buildInhibitCommand(this._platform) !== undefined;
  }

  /** Apply the current `atlasmind.presence.*` settings snapshot. */
  public applyConfig(config: Partial<PresenceConfig>): void {
    const prevDisplay = this._config.keepDisplayAwake;
    const prevMax = this._config.maxAwakeMinutes;
    this._config = {
      keepAwake: config.keepAwake === true,
      keepDisplayAwake: config.keepDisplayAwake === true,
      acPowerOnly: config.acPowerOnly !== false, // default true
      maxAwakeMinutes: clampMaxAwakeMinutes(config.maxAwakeMinutes ?? DEFAULT_CONFIG.maxAwakeMinutes),
    };
    if (this._config.keepAwake) { this._reasons.add(SETTING_REASON); }
    else { this._reasons.delete(SETTING_REASON); }

    // Reconcile a change against an already-held lock: a new backstop value must
    // re-arm (or lift) the cap, and a display change must reach the running
    // helper. Release the child so the following _evaluate() rebuilds it (and the
    // backstop) with the new settings.
    if (this._child !== undefined) {
      const maxChanged = this._config.maxAwakeMinutes !== prevMax;
      const displayChanged = this._config.keepDisplayAwake !== prevDisplay;
      if (maxChanged) { this._backstopDeadline = undefined; }
      if (maxChanged || displayChanged) { this._releaseChild(); }
    }
    this._onReasonsChanged();
  }

  /** Register an activity that needs the machine awake (e.g. 'buzz', 'mission-loop', 'remote'). */
  public hold(reason: string): void {
    if (!reason) { return; }
    if (this._reasons.has(reason)) { return; }
    this._reasons.add(reason);
    this._onReasonsChanged();
  }

  /** Release a previously-held activity. The lock drops when no reasons remain. */
  public release(reason: string): void {
    if (!this._reasons.delete(reason)) { return; }
    this._onReasonsChanged();
  }

  public isAwake(): boolean {
    return this._child !== undefined;
  }

  public getState(): PresenceState {
    const supported = this.isSupported();
    const active = this._child !== undefined;
    let suspended: PresenceSuspendedReason | undefined;
    if (this._reasons.size > 0 && !active) {
      if (!supported || this._unavailable) { suspended = 'unsupported'; }
      else if (this._backstopFired) { suspended = 'backstop'; }
      else if (!this._acGateOk()) { suspended = 'battery'; }
    }
    return {
      supported,
      active,
      reasons: [...this._reasons],
      suspended,
      displayHeld: this._displayHeld,
      expiresAt: this._expiresAt,
    };
  }

  public onDidChange(listener: (state: PresenceState) => void): { dispose(): void } {
    this._listeners.add(listener);
    return { dispose: () => { this._listeners.delete(listener); } };
  }

  public dispose(): void {
    this._disposed = true;
    this._reasons.clear();
    this._stopTimers();
    this._releaseChild();
    this._listeners.clear();
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private _acGateOk(): boolean {
    if (!this._config.acPowerOnly) { return true; }
    // Don't acquire optimistically before the first probe: an unknown state at
    // startup must not hold the lock on battery. Once probed, only block when we
    // KNOW we are on battery (unknown thereafter is treated as AC).
    if (!this._acProbed) { return false; }
    return this._onAc !== false;
  }

  private _onReasonsChanged(): void {
    const has = this._reasons.size > 0;
    if (has && !this._hadReasons) {
      // Fresh session: reset per-session state so a re-enable gets a clean slate
      // (new failure budget, fresh AC probe, and a fresh backstop deadline).
      this._backstopFired = false;
      this._unavailable = false;
      this._failures = 0;
      this._acProbed = false;
      this._backstopDeadline = undefined;
      this._cancelRespawn();
    }
    this._hadReasons = has;
    if (has) {
      this._startTimers();
      if (this._config.acPowerOnly) { void this._refreshAcPower(); }
    } else {
      this._stopTimers();
    }
    this._evaluate();
  }

  private _evaluate(): void {
    if (this._disposed) { return; }
    // Enforce the absolute backstop deadline even across sleep/wake re-acquires.
    if (this._backstopDeadline !== undefined && this._now() >= this._backstopDeadline) {
      this._backstopFired = true;
    }
    const desired = computeDesired(
      this._reasons.size,
      this.isSupported() && !this._unavailable,
      this._acGateOk(),
      this._backstopFired,
    );
    if (desired && !this._child) { this._acquire(); }
    else if (!desired && this._child) { this._releaseChild(); }
    this._emit();
  }

  private _acquire(): void {
    if (this._disposed) { return; }
    const plan = buildInhibitCommand(this._platform, {
      keepDisplayAwake: this._config.keepDisplayAwake,
      hostPid: this._hostPid,
      maxAwakeMinutes: this._config.maxAwakeMinutes,
    });
    if (!plan) { this._unavailable = true; return; }
    let child: ChildProcess;
    try {
      child = this._spawn(plan.command, plan.args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    } catch (err) {
      this._handleSpawnFailure(err);
      return;
    }
    this._child = child;
    this._spawnAt = this._now();
    this._displayHeld = this._config.keepDisplayAwake && this._platform !== 'linux';
    this._armBackstop();

    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 4096) { stderr += chunk.toString(); }
    });
    child.on('error', (err) => {
      if (this._child !== child) { return; } // superseded/old child — ignore its late error
      this._child = undefined;
      this._handleSpawnFailure(err);
    });
    child.on('close', (code, signal) => {
      if (this._child !== child) { return; } // superseded by a newer child
      this._child = undefined;
      this._displayHeld = false;
      if (signal) { return; } // killed by us → clean release
      // A helper that ran stably before dying earns a fresh retry budget; one
      // that dies almost immediately accumulates toward the give-up cap so a
      // start-then-exit helper can never spin-loop forever.
      if (this._now() - this._spawnAt >= STABLE_RUN_MS) { this._failures = 0; }
      this._log(`presence: keep-awake helper exited unexpectedly (code ${code})${stderr ? `: ${stderr.trim()}` : ''}`);
      this._retryAfterFailure();
    });
  }

  private _handleSpawnFailure(err: unknown): void {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT') {
      // The OS helper (e.g. systemd-inhibit) is not installed on this machine.
      this._unavailable = true;
      this._log(`presence: keep-awake helper not available on this system (${code}).`);
      this._emit();
      return;
    }
    this._log(`presence: failed to start keep-awake helper: ${err instanceof Error ? err.message : String(err)}`);
    this._retryAfterFailure();
  }

  private _retryAfterFailure(): void {
    if (this._disposed) { return; }
    this._failures += 1;
    if (this._failures > MAX_CONSECUTIVE_FAILURES) {
      this._unavailable = true;
      this._log('presence: keep-awake helper failed repeatedly; giving up until re-enabled.');
      this._emit();
      return;
    }
    // Throttled respawn so a helper that dies instantly cannot spin-loop. Stored
    // so it can be cancelled on stop/dispose (never re-acquires after teardown).
    this._cancelRespawn();
    const handle = this._timers.setTimeout(() => { this._respawnTimer = undefined; this._evaluate(); }, RESPAWN_DELAY_MS);
    unref(handle);
    this._respawnTimer = handle;
    this._emit();
  }

  private _cancelRespawn(): void {
    if (this._respawnTimer !== undefined) {
      this._timers.clearTimeout(this._respawnTimer);
      this._respawnTimer = undefined;
    }
  }

  private _releaseChild(): void {
    this._clearBackstop();
    this._displayHeld = false;
    this._expiresAt = undefined;
    if (this._child) {
      try { this._child.kill(); } catch { /* ignore */ }
      this._child = undefined;
    }
  }

  private _armBackstop(): void {
    this._clearBackstop();
    const minutes = this._config.maxAwakeMinutes;
    if (minutes <= 0) { this._expiresAt = undefined; this._backstopDeadline = undefined; return; }
    // The deadline is absolute and set once per session, so repeated sleep/wake
    // re-acquires cannot push it forward past maxAwakeMinutes of real time.
    if (this._backstopDeadline === undefined) {
      this._backstopDeadline = this._now() + minutes * 60_000;
    }
    this._expiresAt = this._backstopDeadline;
    const remaining = this._backstopDeadline - this._now();
    if (remaining <= 0) {
      // Deadline already passed (e.g. across a long sleep); _evaluate() enforces
      // this before re-acquiring, so this is a defensive fallback.
      this._backstopFired = true;
      this._expiresAt = undefined;
      return;
    }
    const handle = this._timers.setTimeout(() => {
      this._backstopTimer = undefined;
      this._backstopFired = true;
      this._log(`presence: keep-awake auto-released after the ${minutes}-minute backstop.`);
      this._evaluate();
    }, remaining);
    unref(handle);
    this._backstopTimer = handle;
  }

  private _clearBackstop(): void {
    if (this._backstopTimer !== undefined) {
      this._timers.clearTimeout(this._backstopTimer);
      this._backstopTimer = undefined;
    }
  }

  private _startTimers(): void {
    if (this._sleepTimer === undefined) {
      this._lastTick = this._now();
      const handle = this._timers.setInterval(() => this._onSleepTick(), SLEEP_DETECT_INTERVAL_MS);
      unref(handle);
      this._sleepTimer = handle;
    }
    if (this._config.acPowerOnly) {
      if (this._acTimer === undefined) {
        const handle = this._timers.setInterval(() => { void this._refreshAcPower(); }, AC_POLL_INTERVAL_MS);
        unref(handle);
        this._acTimer = handle;
      }
    } else if (this._acTimer !== undefined) {
      // acPowerOnly was turned off mid-session — stop polling power.
      this._timers.clearInterval(this._acTimer);
      this._acTimer = undefined;
    }
  }

  private _stopTimers(): void {
    if (this._sleepTimer !== undefined) { this._timers.clearInterval(this._sleepTimer); this._sleepTimer = undefined; }
    if (this._acTimer !== undefined) { this._timers.clearInterval(this._acTimer); this._acTimer = undefined; }
    this._clearBackstop();
    this._cancelRespawn();
  }

  private _onSleepTick(): void {
    if (this._disposed) { return; }
    const now = this._now();
    const drift = now - this._lastTick - SLEEP_DETECT_INTERVAL_MS;
    this._lastTick = now;
    // A large gap between ticks means timers were frozen → the machine slept.
    if (drift > SLEEP_DETECT_INTERVAL_MS + 5_000) {
      this._log(`presence: system likely slept (~${Math.round(drift / 1000)}s gap); re-asserting keep-awake.`);
      if (this._config.acPowerOnly) { void this._refreshAcPower(); }
      // Re-acquire a fresh assertion in case the OS cleared ours on wake.
      if (this._child) { this._releaseChild(); }
      this._evaluate();
    }
  }

  private async _refreshAcPower(): Promise<void> {
    const gen = ++this._acProbeGen;
    let ac: boolean | undefined;
    try {
      ac = await this._detectAcPower(this._platform, this._spawn);
    } catch {
      ac = undefined;
    }
    if (this._disposed) { return; }
    if (gen !== this._acProbeGen) { return; } // a newer probe superseded this one
    const firstProbe = !this._acProbed;
    this._acProbed = true;
    // Always re-evaluate on the first probe (even if the value is unchanged/unknown)
    // so a deferred acquire can proceed once the AC gate is resolved.
    if (firstProbe || ac !== this._onAc) {
      this._onAc = ac;
      this._evaluate();
    } else {
      this._onAc = ac;
    }
  }

  private _emit(): void {
    const state = this.getState();
    for (const listener of [...this._listeners]) {
      try { listener(state); } catch { /* ignore listener errors */ }
    }
  }
}

/** `.unref()` a timer handle when available so it never keeps the host alive. */
function unref(handle: unknown): void {
  if (handle && typeof (handle as { unref?: () => void }).unref === 'function') {
    (handle as { unref: () => void }).unref();
  }
}

/** Run a short-lived probe command and resolve its stdout (or `undefined`). */
function runProbe(spawnFn: SpawnLike, command: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const finish = (value: string | undefined): void => { if (!done) { done = true; resolve(value); } };
    let child: ChildProcess;
    try {
      child = spawnFn(command, args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    } catch {
      finish(undefined);
      return;
    }
    child.stdout?.on('data', (chunk: Buffer) => { if (out.length < 4096) { out += chunk.toString(); } });
    child.on('error', () => finish(undefined));
    child.on('close', () => finish(out));
    const timeout = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } finish(undefined); }, 5_000);
    unref(timeout);
  });
}

/**
 * Best-effort AC-power detection. Resolves `true` on AC/mains, `false` on
 * battery, `undefined` when it cannot be determined (treated as AC by the
 * caller so keep-awake still works where detection is unavailable).
 */
export async function defaultDetectAcPower(
  platform: NodeJS.Platform,
  spawnFn: SpawnLike,
): Promise<boolean | undefined> {
  try {
    if (platform === 'linux') {
      const base = '/sys/class/power_supply';
      const entries = fs.readdirSync(base);
      let sawBattery = false;
      for (const entry of entries) {
        if (/^(AC|ADP|ACAD)/i.test(entry)) {
          try {
            const online = fs.readFileSync(`${base}/${entry}/online`, 'utf8').trim();
            if (online === '1') { return true; }
            if (online === '0') { return false; }
          } catch { /* keep scanning */ }
        } else if (/^BAT/i.test(entry)) {
          sawBattery = true;
        }
      }
      return sawBattery ? undefined : true; // no battery at all → desktop → AC
    }
    if (platform === 'darwin') {
      const out = await runProbe(spawnFn, 'pmset', ['-g', 'batt']);
      if (out == null) { return undefined; }
      if (/AC Power/i.test(out)) { return true; }
      if (/Battery Power/i.test(out)) { return false; }
      return undefined;
    }
    if (platform === 'win32') {
      const out = await runProbe(spawnFn, 'powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_Battery).BatteryStatus',
      ]);
      if (out == null) { return undefined; }
      const trimmed = out.trim();
      if (trimmed === '') { return true; } // no Win32_Battery → desktop → AC
      const status = parseInt(trimmed.split(/\s+/)[0], 10);
      if (Number.isNaN(status)) { return undefined; }
      return status !== 1; // 1 = discharging (battery); anything else = plugged in
    }
  } catch {
    return undefined;
  }
  return undefined;
}
