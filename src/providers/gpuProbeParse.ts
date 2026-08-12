/**
 * The text every GPU probe returns, turned into numbers.
 *
 * Extracted from `settingsPanel.ts`, where these parsers were module-private
 * inside an 8,000-line view that imports `vscode` — so nothing in `src/core/`
 * could read a VRAM figure, which is why AtlasMind could route to a local model
 * without any idea whether it would fit. Parsing is separated from *running* the
 * probe (`gpuProbe.ts`) because the text is the only interesting part: a captured
 * line of `nvidia-smi` output is a complete test case, and spawning a process is
 * not.
 *
 * Two properties every parser here holds:
 *
 * **Total, never throwing.** Probe output is whatever a driver tool decided to
 * print this version. A parser that throws takes out the whole probe chain, and
 * the fallback that would have worked is never reached — so malformed input
 * drops the row and returns what it could read.
 *
 * **A number it could not read is `undefined`, never `0`.** This is the rule the
 * budget depends on: `freeBytes: 0` means "the card is full", `undefined` means
 * "this source cannot tell you", and treating the second as the first would
 * refuse every local request on a machine with no `nvidia-smi`.
 *
 * A worked example of why the source matters, measured on an RTX 4090:
 *
 * ```
 * nvidia-smi  → 24564 MB total     (correct)
 * CIM         →  4293918720 bytes  (4.0 GB — wrong by 6×)
 * ```
 *
 * `Win32_VideoController.AdapterRAM` is a 32-bit DWORD, so it saturates just
 * below 4 GiB and reports the same 4.0 GB for every card above that. It is kept
 * only as a last-resort *name* source, and `totalBytes` from it is deliberately
 * marked untrustworthy by `ADAPTER_RAM_DWORD_CEILING_BYTES` below.
 *
 * Pure — no imports, no I/O, no clock.
 */

/** One GPU as some probe source described it. */
export interface GpuDevice {
  /** Device index where the source provides one (`nvidia-smi` does). */
  index?: number;
  name: string;
  /** Total VRAM. `undefined` when the source did not report a usable figure. */
  totalBytes?: number;
  /** In-use VRAM, aggregate across all processes. Only `nvidia-smi` reports it. */
  usedBytes?: number;
  /** Free VRAM. Only `nvidia-smi` reports it; the budget's primary input. */
  freeBytes?: number;
  /**
   * Whether `totalBytes` came from a source known to truncate. Set by the
   * `AdapterRAM` parsers so a caller can prefer a smaller trustworthy reading
   * over a larger untrustworthy one.
   */
  totalUntrustworthy?: boolean;
}

const BYTES_PER_MIB = 1024 * 1024;

/**
 * The value `Win32_VideoController.AdapterRAM` saturates at (2^32 − 1, rounded
 * down by the driver to 4293918720 on the machine this was measured on).
 *
 * Any reading at or near this is a truncation artefact rather than a card size,
 * and a 4 GB card genuinely reporting 4 GB is indistinguishable from a 24 GB
 * card truncated to it — so both are marked untrustworthy rather than guessed at.
 */
export const ADAPTER_RAM_DWORD_CEILING_BYTES = 4_293_918_720;

function finiteNumber(value: string | undefined): number | undefined {
  if (value === undefined) { return undefined; }
  const trimmed = value.trim();
  if (trimmed.length === 0) { return undefined; }
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function positiveBytes(value: number | undefined): number | undefined {
  return value !== undefined && value > 0 ? value : undefined;
}

/**
 * `nvidia-smi --query-gpu=index,name,memory.total,memory.used,memory.free
 * --format=csv,noheader,nounits`.
 *
 * The only source that reports free VRAM, and therefore the only one that can
 * see memory a *different* application is holding. On the machine this was
 * written for that is ~9 GB of desktop, browser and antivirus with no model
 * loaded at all — which is why a budget derived from "total minus what we
 * loaded" would be wrong by that much.
 *
 * Tolerates a trailing ` MiB` suffix, so it still reads a caller that forgot
 * `nounits`. Rows are accepted with as few as two columns (index, name) so a
 * future column change degrades to names rather than to nothing.
 */
export function parseNvidiaSmiMemoryCsv(stdout: string): GpuDevice[] {
  const devices: GpuDevice[] = [];
  for (const line of stdout.split(/\r?\n/g)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) { continue; }
    const parts = trimmed.split(',').map(part => part.replace(/\s*MiB\s*$/i, '').trim());
    if (parts.length < 2) { continue; }

    const index = finiteNumber(parts[0]);
    const name = (parts[1] ?? '').trim();
    if (name.length === 0) { continue; }

    const totalMib = finiteNumber(parts[2]);
    const usedMib = finiteNumber(parts[3]);
    const freeMib = finiteNumber(parts[4]);

    devices.push({
      ...(index !== undefined ? { index } : {}),
      name,
      ...(positiveBytes(totalMib) !== undefined ? { totalBytes: totalMib! * BYTES_PER_MIB } : {}),
      // Used and free may legitimately be zero, so they are gated on finiteness
      // rather than positivity: a genuinely empty card reports free 0 only when
      // it is full, and used 0 when nothing is running. Both are facts.
      ...(usedMib !== undefined && usedMib >= 0 ? { usedBytes: usedMib * BYTES_PER_MIB } : {}),
      ...(freeMib !== undefined && freeMib >= 0 ? { freeBytes: freeMib * BYTES_PER_MIB } : {}),
    });
  }
  return devices;
}

/**
 * `wmic path win32_VideoController get Name,AdapterRAM /format:csv`.
 *
 * Retained for older Windows only — `wmic` is deprecated and absent from a
 * current Windows 11 install, where the PowerShell CIM parser below is the real
 * fallback. Reports a truncated total and no free memory.
 */
export function parseWmicVideoControllerCsv(stdout: string): GpuDevice[] {
  const devices: GpuDevice[] = [];
  for (const line of stdout.split(/\r?\n/g)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.toLowerCase().startsWith('node,')) { continue; }
    const parts = trimmed.split(',');
    const adapterRam = finiteNumber(parts[1]);
    const name = (parts[2] ?? '').trim();
    if (name.length === 0) { continue; }
    devices.push(adapterRamDevice(name, adapterRam));
  }
  return devices;
}

/**
 * `powershell -NoProfile -Command "Get-CimInstance Win32_VideoController |
 * Select-Object Name,AdapterRAM | ConvertTo-Json -Compress"`.
 *
 * `ConvertTo-Json` emits a bare object for a single GPU and an array for
 * several, so both shapes are accepted.
 */
export function parseWin32VideoControllerJson(stdout: string): GpuDevice[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const devices: GpuDevice[] = [];
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) { continue; }
    const record = entry as Record<string, unknown>;
    const name = typeof record['Name'] === 'string' ? record['Name'].trim() : '';
    if (name.length === 0) { continue; }
    const raw = record['AdapterRAM'];
    const adapterRam = typeof raw === 'number' ? raw : finiteNumber(String(raw ?? ''));
    devices.push(adapterRamDevice(name, adapterRam));
  }
  return devices;
}

function adapterRamDevice(name: string, adapterRam: number | undefined): GpuDevice {
  const total = positiveBytes(adapterRam);
  if (total === undefined) {
    return { name };
  }
  // At or above the DWORD ceiling the figure says nothing about the card. Below
  // it the figure may be right, but this source has no way to prove it, so the
  // whole source is marked rather than only its saturated readings.
  return { name, totalBytes: total, totalUntrustworthy: true };
}

/** `system_profiler SPDisplaysDataType -json`. */
export function parseSystemProfilerDisplays(stdout: string): GpuDevice[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) { return []; }
  const list = (parsed as Record<string, unknown>)['SPDisplaysDataType'];
  if (!Array.isArray(list)) { return []; }

  const devices: GpuDevice[] = [];
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) { continue; }
    const record = entry as Record<string, unknown>;
    const name = typeof record['sppci_model'] === 'string'
      ? record['sppci_model'].trim()
      : typeof record['_name'] === 'string' ? record['_name'].trim() : '';
    if (name.length === 0) { continue; }

    const vramText = typeof record['spdisplays_vram'] === 'string'
      ? record['spdisplays_vram']
      : typeof record['spdisplays_vram_shared'] === 'string' ? record['spdisplays_vram_shared'] : '';
    const match = /(\d+(?:\.\d+)?)\s*(GB|MB)/i.exec(vramText);
    if (!match) {
      devices.push({ name });
      continue;
    }
    const value = Number.parseFloat(match[1]!);
    const multiplier = match[2]!.toUpperCase() === 'GB' ? 1024 * BYTES_PER_MIB : BYTES_PER_MIB;
    devices.push({
      name,
      ...(Number.isFinite(value) && value > 0 ? { totalBytes: value * multiplier } : {}),
    });
  }
  return devices;
}

/** `lspci` — names only. No memory figure exists on this path. */
export function parseLspci(stdout: string): GpuDevice[] {
  const devices: GpuDevice[] = [];
  for (const line of stdout.split(/\r?\n/g)) {
    if (!/(vga|3d|display)/i.test(line)) { continue; }
    const cleaned = line.replace(/^\S+\s+/, '').trim();
    if (cleaned.length === 0) { continue; }
    devices.push({ name: cleaned });
  }
  return devices;
}

/**
 * Collapse duplicate entries for one physical card.
 *
 * Several sources list the same GPU twice (one per attached display). The
 * richest reading wins: a device carrying free memory beats one carrying only a
 * total, and a trustworthy total beats an untrustworthy one — otherwise a CIM
 * row could overwrite an `nvidia-smi` row for the same card and throw away the
 * only free-memory figure available.
 */
export function dedupeGpuDevices(devices: readonly GpuDevice[]): GpuDevice[] {
  const byName = new Map<string, GpuDevice>();
  for (const device of devices) {
    const key = device.name.trim().toLowerCase();
    if (key.length === 0) { continue; }
    const existing = byName.get(key);
    if (!existing || deviceRichness(device) > deviceRichness(existing)) {
      byName.set(key, { ...device, name: device.name.trim() });
    }
  }
  return [...byName.values()];
}

function deviceRichness(device: GpuDevice): number {
  let score = 0;
  if (device.freeBytes !== undefined) { score += 4; }
  if (device.usedBytes !== undefined) { score += 2; }
  if (device.totalBytes !== undefined) { score += device.totalUntrustworthy ? 1 : 2; }
  return score;
}

/**
 * Whether this set of readings can answer "how much room is there right now".
 *
 * Requires at least one device with a free figure. A machine reporting only
 * totals is not a machine with plenty free — it is a machine that cannot say,
 * and the arbiter degrades rather than guessing.
 */
export function hasMeasurableFreeMemory(devices: readonly GpuDevice[]): boolean {
  return devices.some(device => device.freeBytes !== undefined);
}
