import { describe, it, expect } from 'vitest';
import {
  probeGpuDevices,
  createCachedGpuProbe,
  GPU_PROBE_CACHE_TTL_MS,
  type ExecFileLike,
} from '../../src/providers/gpuProbe.js';

const MIB = 1024 * 1024;
const REAL_NVIDIA_SMI = '0, NVIDIA GeForce RTX 4090, 24564, 9432, 14707\n';
const REAL_CIM_JSON = '{"Name":"NVIDIA GeForce RTX 4090","AdapterRAM":4293918720}';

/** An execFile that answers only the commands it was given. */
function fakeExec(script: Record<string, string>): ExecFileLike & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (command: string) => {
    calls.push(command);
    if (!(command in script)) { throw new Error(`ENOENT: ${command}`); }
    return { stdout: script[command]! };
  }) as ExecFileLike & { calls: string[] };
  fn.calls = calls;
  return fn;
}

describe('probeGpuDevices', () => {
  it('asks nvidia-smi for free memory, not just the total', async () => {
    const execFile = fakeExec({ 'nvidia-smi': REAL_NVIDIA_SMI });
    const devices = await probeGpuDevices({ execFile, platform: 'win32' });
    expect(devices).toHaveLength(1);
    expect(devices[0]!.freeBytes).toBe(14707 * MIB);
    expect(devices[0]!.usedBytes).toBe(9432 * MIB);
  });

  it('prefers nvidia-smi over CIM, which reports a 24 GB card as 4 GB', async () => {
    // Measured on the reference machine. Taking CIM first would set the budget
    // six times too low and refuse everything.
    const execFile = fakeExec({ 'nvidia-smi': REAL_NVIDIA_SMI, powershell: REAL_CIM_JSON });
    const devices = await probeGpuDevices({ execFile, platform: 'win32' });
    expect(execFile.calls[0]).toBe('nvidia-smi');
    expect(devices[0]!.totalBytes).toBe(24564 * MIB);
    expect(devices[0]!.totalUntrustworthy).toBeUndefined();
  });

  it('falls through to CIM when nvidia-smi is absent, and marks it untrustworthy', async () => {
    const execFile = fakeExec({ powershell: REAL_CIM_JSON });
    const devices = await probeGpuDevices({ execFile, platform: 'win32' });
    expect(execFile.calls).toEqual(['nvidia-smi', 'wmic', 'powershell']);
    expect(devices[0]!.totalUntrustworthy).toBe(true);
    expect(devices[0]!.freeBytes).toBeUndefined();
  });

  it('returns nothing rather than throwing when every probe is missing', async () => {
    // Empty is read by the budget as unmeasurable, never as plenty.
    const devices = await probeGpuDevices({ execFile: fakeExec({}), platform: 'win32' });
    expect(devices).toEqual([]);
  });

  it('uses the platform-appropriate chain', async () => {
    const mac = fakeExec({});
    await probeGpuDevices({ execFile: mac, platform: 'darwin' });
    expect(mac.calls).toEqual(['system_profiler']);

    const linux = fakeExec({});
    await probeGpuDevices({ execFile: linux, platform: 'linux' });
    expect(linux.calls).toEqual(['nvidia-smi', 'lspci']);
  });

  it('bounds every probe so a hung tool cannot hang an admission', async () => {
    let observedTimeout: number | undefined;
    const execFile: ExecFileLike = async (_command, _args, options) => {
      observedTimeout = options.timeout;
      return { stdout: REAL_NVIDIA_SMI };
    };
    await probeGpuDevices({ execFile, platform: 'win32' });
    expect(observedTimeout).toBeGreaterThan(0);
  });

  it('skips a probe that answers with nothing usable', async () => {
    const execFile = fakeExec({ 'nvidia-smi': '   \n', powershell: REAL_CIM_JSON });
    const devices = await probeGpuDevices({ execFile, platform: 'win32' });
    expect(devices).toHaveLength(1);
    expect(devices[0]!.totalUntrustworthy).toBe(true);
  });
});

describe('createCachedGpuProbe', () => {
  it('reuses a recent reading instead of spawning a process per admission', async () => {
    let clock = 1_000;
    const execFile = fakeExec({ 'nvidia-smi': REAL_NVIDIA_SMI });
    const probe = createCachedGpuProbe({ execFile, platform: 'win32', now: () => clock });

    await probe();
    await probe();
    await probe();
    expect(execFile.calls).toEqual(['nvidia-smi']);
  });

  it('asks again once the reading is stale', async () => {
    let clock = 1_000;
    const execFile = fakeExec({ 'nvidia-smi': REAL_NVIDIA_SMI });
    const probe = createCachedGpuProbe({ execFile, platform: 'win32', now: () => clock });

    await probe();
    clock += GPU_PROBE_CACHE_TTL_MS + 1;
    await probe();
    expect(execFile.calls).toEqual(['nvidia-smi', 'nvidia-smi']);
  });

  it('coalesces a burst of simultaneous admissions into one probe', async () => {
    const execFile = fakeExec({ 'nvidia-smi': REAL_NVIDIA_SMI });
    const probe = createCachedGpuProbe({ execFile, platform: 'win32', now: () => 1_000 });

    const readings = await Promise.all([probe(), probe(), probe(), probe()]);
    expect(execFile.calls).toEqual(['nvidia-smi']);
    for (const reading of readings) {
      expect(reading[0]!.freeBytes).toBe(14707 * MIB);
    }
  });

  it('degrades to an empty reading rather than rejecting', async () => {
    const exploding: ExecFileLike = async () => { throw new Error('boom'); };
    const probe = createCachedGpuProbe({ execFile: exploding, platform: 'win32' });
    await expect(probe()).resolves.toEqual([]);
  });
});
