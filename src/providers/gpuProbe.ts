/**
 * Asking the machine how much graphics memory is free.
 *
 * The probe chain per platform, with the parsing in `gpuProbeParse.ts`. Order is
 * the policy: the only source that reports *free* memory is tried first, because
 * everything else can report a total and none of them can tell you what is left.
 *
 * **`nvidia-smi` first on Windows, for a measured reason.** `Win32_VideoController.AdapterRAM`
 * is a 32-bit DWORD. On the reference machine it reports 4,293,918,720 bytes for
 * a 24 GB card — wrong by six times, and wrong in the direction that would let
 * the arbiter refuse everything. The CIM and `wmic` sources are kept only as
 * name sources for a machine with no NVIDIA tooling. (`wmic` itself is absent
 * from a current Windows 11 install; CIM is the real fallback.)
 *
 * **Every probe is bounded and every failure is silent.** A probe that hangs
 * would hang an admission decision, and a probe that throws would take out the
 * chain before the fallback that would have worked. A chain that finds nothing
 * returns an empty list, which the budget reads as *unmeasurable* — never as
 * plenty.
 *
 * **Cached for a few seconds.** Admission asks on every cold request and the
 * previous implementation spawned a process per call. The window is short enough
 * that a model finishing its load is noticed promptly, and long enough that a
 * burst of admissions costs one process rather than twenty.
 *
 * `execFile` and the clock are injected, so this is unit-tested without spawning
 * anything.
 */
import { execFile } from 'node:child_process';
import { platform as osPlatform } from 'node:os';
import {
  parseNvidiaSmiMemoryCsv,
  parseWmicVideoControllerCsv,
  parseWin32VideoControllerJson,
  parseSystemProfilerDisplays,
  parseLspci,
  dedupeGpuDevices,
  type GpuDevice,
} from './gpuProbeParse.js';

/** Minimal `execFile`, injected for tests. */
export type ExecFileLike = (
  command: string,
  args: readonly string[],
  options: { windowsHide?: boolean; maxBuffer?: number; timeout?: number },
) => Promise<{ stdout: string }>;

export interface GpuProbeDeps {
  execFile?: ExecFileLike;
  platform?: NodeJS.Platform;
  now?: () => number;
}

/** How long a single probe command may take before it is abandoned. */
export const GPU_PROBE_TIMEOUT_MS = 5_000;

/** How long a reading is reused before the machine is asked again. */
export const GPU_PROBE_CACHE_TTL_MS = 4_000;

const NVIDIA_SMI_ARGS = [
  '--query-gpu=index,name,memory.total,memory.used,memory.free',
  '--format=csv,noheader,nounits',
] as const;

function defaultExecFile(): ExecFileLike {
  return (command, args, options) => new Promise((resolve, reject) => {
    execFile(command, [...args], options, (error, stdout) => {
      if (error) { reject(error); return; }
      resolve({ stdout: String(stdout) });
    });
  });
}

/** One step of a platform's probe chain. */
interface ProbeStep {
  command: string;
  args: readonly string[];
  parse: (stdout: string) => GpuDevice[];
  maxBuffer: number;
}

function stepsFor(platform: NodeJS.Platform): ProbeStep[] {
  if (platform === 'win32') {
    return [
      { command: 'nvidia-smi', args: NVIDIA_SMI_ARGS, parse: parseNvidiaSmiMemoryCsv, maxBuffer: 512 * 1024 },
      {
        command: 'wmic',
        args: ['path', 'win32_VideoController', 'get', 'Name,AdapterRAM', '/format:csv'],
        parse: parseWmicVideoControllerCsv,
        maxBuffer: 1024 * 1024,
      },
      {
        command: 'powershell',
        args: ['-NoProfile', '-Command', 'Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress'],
        parse: parseWin32VideoControllerJson,
        maxBuffer: 1024 * 1024,
      },
    ];
  }
  if (platform === 'darwin') {
    return [
      {
        command: 'system_profiler',
        args: ['SPDisplaysDataType', '-json'],
        parse: parseSystemProfilerDisplays,
        maxBuffer: 2 * 1024 * 1024,
      },
    ];
  }
  return [
    { command: 'nvidia-smi', args: NVIDIA_SMI_ARGS, parse: parseNvidiaSmiMemoryCsv, maxBuffer: 512 * 1024 },
    { command: 'lspci', args: [], parse: parseLspci, maxBuffer: 512 * 1024 },
  ];
}

/**
 * Read every GPU this machine will admit to having.
 *
 * Runs the chain until a step yields at least one device. Later steps are
 * *not* merged into an earlier success: a CIM row for the same card would only
 * add an untrustworthy total beside a trustworthy one, and `dedupeGpuDevices`
 * would have to discard it again.
 */
export async function probeGpuDevices(deps?: GpuProbeDeps): Promise<GpuDevice[]> {
  const run = deps?.execFile ?? defaultExecFile();
  const platform = deps?.platform ?? osPlatform();

  for (const step of stepsFor(platform)) {
    try {
      const { stdout } = await run(step.command, step.args, {
        windowsHide: true,
        maxBuffer: step.maxBuffer,
        timeout: GPU_PROBE_TIMEOUT_MS,
      });
      const devices = dedupeGpuDevices(step.parse(stdout));
      if (devices.length > 0) {
        return devices;
      }
    } catch {
      // This tool is absent or refused. Try the next.
    }
  }
  return [];
}

/**
 * A probe that reuses a recent reading.
 *
 * Returned as a closure rather than a class because the only thing worth
 * sharing is the cache, and the arbiter holds exactly one.
 */
export function createCachedGpuProbe(deps?: GpuProbeDeps): () => Promise<GpuDevice[]> {
  const now = deps?.now ?? Date.now;
  let cachedAtMs = 0;
  let cached: GpuDevice[] = [];
  let inFlight: Promise<GpuDevice[]> | undefined;

  return async () => {
    if (cachedAtMs > 0 && now() - cachedAtMs < GPU_PROBE_CACHE_TTL_MS) {
      return cached;
    }
    // Coalesce a burst: several admissions arriving together share one probe
    // rather than spawning a process each.
    inFlight ??= probeGpuDevices(deps).then(devices => {
      cached = devices;
      cachedAtMs = now();
      inFlight = undefined;
      return devices;
    }).catch(() => {
      inFlight = undefined;
      return [];
    });
    return inFlight;
  };
}
