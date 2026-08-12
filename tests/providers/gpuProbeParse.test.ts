import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  parseNvidiaSmiMemoryCsv,
  parseWmicVideoControllerCsv,
  parseWin32VideoControllerJson,
  parseSystemProfilerDisplays,
  parseLspci,
  dedupeGpuDevices,
  hasMeasurableFreeMemory,
  ADAPTER_RAM_DWORD_CEILING_BYTES,
} from '../../src/providers/gpuProbeParse.js';

const MIB = 1024 * 1024;

// Captured verbatim from the machine this was written for (RTX 4090).
const REAL_NVIDIA_SMI = '0, NVIDIA GeForce RTX 4090, 24564, 9432, 14707';
const REAL_CIM_JSON = '{"Name":"NVIDIA GeForce RTX 4090","AdapterRAM":4293918720}';

describe('parseNvidiaSmiMemoryCsv', () => {
  it('reads the real output this feature was measured against', () => {
    const [gpu] = parseNvidiaSmiMemoryCsv(REAL_NVIDIA_SMI);
    expect(gpu).toBeDefined();
    expect(gpu!.index).toBe(0);
    expect(gpu!.name).toBe('NVIDIA GeForce RTX 4090');
    expect(gpu!.totalBytes).toBe(24564 * MIB);
    expect(gpu!.usedBytes).toBe(9432 * MIB);
    expect(gpu!.freeBytes).toBe(14707 * MIB);
  });

  it('records free memory held by everything else on the machine', () => {
    // The number that justifies measuring free rather than subtracting our own
    // loads: 9.2 GB was in use with no LLM loaded at all.
    const [gpu] = parseNvidiaSmiMemoryCsv(REAL_NVIDIA_SMI);
    expect(gpu!.usedBytes! + gpu!.freeBytes!).toBeLessThanOrEqual(gpu!.totalBytes!);
    expect(gpu!.usedBytes).toBeGreaterThan(9_000 * MIB);
  });

  it('reads multiple GPUs', () => {
    const gpus = parseNvidiaSmiMemoryCsv([
      '0, NVIDIA GeForce RTX 4090, 24564, 9432, 14707',
      '1, NVIDIA GeForce RTX 3090, 24576, 1024, 23552',
    ].join('\n'));
    expect(gpus).toHaveLength(2);
    expect(gpus[1]!.index).toBe(1);
    expect(gpus[1]!.freeBytes).toBe(23552 * MIB);
  });

  it('tolerates a MiB suffix when nounits was omitted', () => {
    const [gpu] = parseNvidiaSmiMemoryCsv('0, NVIDIA GeForce RTX 4090, 24564 MiB, 9432 MiB, 14707 MiB');
    expect(gpu!.totalBytes).toBe(24564 * MIB);
    expect(gpu!.freeBytes).toBe(14707 * MIB);
  });

  it('keeps a name when later columns are missing rather than dropping the card', () => {
    const [gpu] = parseNvidiaSmiMemoryCsv('0, NVIDIA GeForce RTX 4090');
    expect(gpu!.name).toBe('NVIDIA GeForce RTX 4090');
    expect(gpu!.totalBytes).toBeUndefined();
    expect(gpu!.freeBytes).toBeUndefined();
  });

  it('distinguishes a full card from an unreadable one', () => {
    // free 0 is a fact: the card is full. An absent column is not that fact.
    const [full] = parseNvidiaSmiMemoryCsv('0, GPU, 24564, 24564, 0');
    expect(full!.freeBytes).toBe(0);
    const [unknown] = parseNvidiaSmiMemoryCsv('0, GPU, 24564');
    expect(unknown!.freeBytes).toBeUndefined();
  });

  it('drops unreadable rows without losing readable ones', () => {
    const gpus = parseNvidiaSmiMemoryCsv(['', '   ', 'garbage', '0, GPU, 8192, 1024, 7168'].join('\n'));
    // 'garbage' has no second column, so it is dropped.
    expect(gpus).toHaveLength(1);
    expect(gpus[0]!.freeBytes).toBe(7168 * MIB);
  });
});

describe('parseWin32VideoControllerJson', () => {
  it('marks the real CIM reading untrustworthy — it reports 4 GB for a 24 GB card', () => {
    // Measured: AdapterRAM is a 32-bit DWORD and saturates. This is the whole
    // reason nvidia-smi is tried first, and why this source can never feed a
    // budget.
    const [gpu] = parseWin32VideoControllerJson(REAL_CIM_JSON);
    expect(gpu!.name).toBe('NVIDIA GeForce RTX 4090');
    expect(gpu!.totalBytes).toBe(ADAPTER_RAM_DWORD_CEILING_BYTES);
    expect(gpu!.totalUntrustworthy).toBe(true);
    expect(gpu!.freeBytes).toBeUndefined();
  });

  it('accepts both the single-object and array shapes ConvertTo-Json emits', () => {
    expect(parseWin32VideoControllerJson(REAL_CIM_JSON)).toHaveLength(1);
    expect(parseWin32VideoControllerJson(`[${REAL_CIM_JSON},${REAL_CIM_JSON}]`)).toHaveLength(2);
  });

  it('returns nothing rather than throwing on malformed JSON', () => {
    expect(parseWin32VideoControllerJson('not json')).toEqual([]);
    expect(parseWin32VideoControllerJson('')).toEqual([]);
  });
});

describe('parseWmicVideoControllerCsv', () => {
  it('skips the CSV header row and marks totals untrustworthy', () => {
    const gpus = parseWmicVideoControllerCsv([
      'Node,AdapterRAM,Name',
      'DESKTOP,4293918720,NVIDIA GeForce RTX 4090',
    ].join('\n'));
    expect(gpus).toHaveLength(1);
    expect(gpus[0]!.name).toBe('NVIDIA GeForce RTX 4090');
    expect(gpus[0]!.totalUntrustworthy).toBe(true);
  });
});

describe('parseSystemProfilerDisplays', () => {
  it('reads an Apple GPU with shared VRAM', () => {
    const [gpu] = parseSystemProfilerDisplays(JSON.stringify({
      SPDisplaysDataType: [{ sppci_model: 'Apple M3 Max', spdisplays_vram_shared: '48 GB' }],
    }));
    expect(gpu!.name).toBe('Apple M3 Max');
    expect(gpu!.totalBytes).toBe(48 * 1024 * MIB);
    expect(gpu!.freeBytes).toBeUndefined();
  });

  it('keeps the card when the VRAM string is unparseable', () => {
    const [gpu] = parseSystemProfilerDisplays(JSON.stringify({
      SPDisplaysDataType: [{ _name: 'Some GPU', spdisplays_vram: 'lots' }],
    }));
    expect(gpu!.name).toBe('Some GPU');
    expect(gpu!.totalBytes).toBeUndefined();
  });

  it('returns nothing rather than throwing on malformed input', () => {
    expect(parseSystemProfilerDisplays('{')).toEqual([]);
    expect(parseSystemProfilerDisplays(JSON.stringify({ SPDisplaysDataType: 'nope' }))).toEqual([]);
  });
});

describe('parseLspci', () => {
  it('keeps only display controllers and strips the bus id', () => {
    const gpus = parseLspci([
      '00:02.0 VGA compatible controller: Intel Corporation UHD Graphics 770',
      '00:1f.3 Audio device: Intel Corporation Alder Lake',
      '01:00.0 3D controller: NVIDIA Corporation GA104M',
    ].join('\n'));
    expect(gpus).toHaveLength(2);
    expect(gpus[0]!.name).toContain('UHD Graphics 770');
    expect(gpus[0]!.totalBytes).toBeUndefined();
  });
});

describe('dedupeGpuDevices', () => {
  it('keeps the richest reading for one card', () => {
    // The failure this prevents: a CIM row overwriting an nvidia-smi row and
    // discarding the only free-memory figure on the machine.
    const merged = dedupeGpuDevices([
      { name: 'NVIDIA GeForce RTX 4090', totalBytes: 24564 * MIB, usedBytes: 9432 * MIB, freeBytes: 14707 * MIB },
      { name: 'nvidia geforce rtx 4090', totalBytes: ADAPTER_RAM_DWORD_CEILING_BYTES, totalUntrustworthy: true },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.freeBytes).toBe(14707 * MIB);
    expect(merged[0]!.totalUntrustworthy).toBeUndefined();
  });

  it('prefers a trustworthy total over an untrustworthy one of any size', () => {
    const merged = dedupeGpuDevices([
      { name: 'GPU', totalBytes: ADAPTER_RAM_DWORD_CEILING_BYTES, totalUntrustworthy: true },
      { name: 'GPU', totalBytes: 8 * 1024 * MIB },
    ]);
    expect(merged[0]!.totalBytes).toBe(8 * 1024 * MIB);
  });

  it('keeps genuinely distinct cards apart', () => {
    expect(dedupeGpuDevices([{ name: 'RTX 4090' }, { name: 'RTX 3090' }])).toHaveLength(2);
  });
});

describe('hasMeasurableFreeMemory', () => {
  it('is false when no source reported free memory', () => {
    // A machine reporting only totals is one that cannot say how much room
    // there is — not one with plenty. Treating these the same would let the
    // arbiter admit against a number nobody measured.
    expect(hasMeasurableFreeMemory([{ name: 'GPU', totalBytes: 24564 * MIB }])).toBe(false);
    expect(hasMeasurableFreeMemory([])).toBe(false);
  });

  it('is true when at least one card reported free memory, including zero', () => {
    expect(hasMeasurableFreeMemory([{ name: 'GPU', freeBytes: 0 }])).toBe(true);
  });
});

describe('robustness', () => {
  const parsers = [
    parseNvidiaSmiMemoryCsv,
    parseWmicVideoControllerCsv,
    parseWin32VideoControllerJson,
    parseSystemProfilerDisplays,
    parseLspci,
  ];

  it('never throws on arbitrary probe output', () => {
    // A parser that throws takes out the whole probe chain, so the fallback
    // that would have worked is never reached.
    fc.assert(fc.property(fc.string(), text => {
      for (const parse of parsers) {
        expect(Array.isArray(parse(text))).toBe(true);
      }
    }), { numRuns: 300 });
  });

  it('never invents a memory figure it did not read', () => {
    fc.assert(fc.property(fc.string(), text => {
      for (const parse of parsers) {
        for (const device of parse(text)) {
          for (const value of [device.totalBytes, device.usedBytes, device.freeBytes]) {
            // Every figure is either absent or a finite non-negative number.
            // Never NaN, never negative, never Infinity — each of which would
            // propagate into the budget arithmetic as a silent wrong answer.
            expect(value === undefined || (Number.isFinite(value) && value >= 0)).toBe(true);
          }
        }
      }
    }), { numRuns: 300 });
  });

  it('dedupe never grows the list and never loses a free reading that was present', () => {
    const arbitraryDevice = fc.record({
      name: fc.constantFrom('a', 'b', 'A', ' a '),
      totalBytes: fc.option(fc.nat(), { nil: undefined }),
      freeBytes: fc.option(fc.nat(), { nil: undefined }),
    });
    fc.assert(fc.property(fc.array(arbitraryDevice, { maxLength: 12 }), devices => {
      const merged = dedupeGpuDevices(devices);
      expect(merged.length).toBeLessThanOrEqual(devices.length);
      if (devices.some(d => d.freeBytes !== undefined && d.name.trim().length > 0)) {
        expect(hasMeasurableFreeMemory(merged)).toBe(true);
      }
    }), { numRuns: 250 });
  });
});
