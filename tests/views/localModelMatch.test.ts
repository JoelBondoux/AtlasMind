import { describe, it, expect } from 'vitest';
import {
  localModelMatchKey,
  findInstalledLocalMatch,
  interpretOllamaPullLine,
  formatByteCount,
} from '../../src/views/settingsPanel.js';

describe('localModelMatchKey', () => {
  it('collapses an Ollama tag, an HF candidate tag, and an HF-pulled id to the same key', () => {
    const fromOllama = localModelMatchKey('deepseek-v4:latest');
    const fromHfCandidate = localModelMatchKey('hf:antirez/DeepSeek-V4-GGUF');
    const fromHfPull = localModelMatchKey('hf.co/antirez/DeepSeek-V4-GGUF:Q4_K_M');
    expect(fromOllama).toBe('deepseekv4');
    expect(fromHfCandidate).toBe('deepseekv4');
    expect(fromHfPull).toBe('deepseekv4');
  });

  it('preserves the parameter size but drops quant/tag noise', () => {
    expect(localModelMatchKey('qwen3:14b')).toBe('qwen314b');
    expect(localModelMatchKey('hf:bartowski/Qwen3-14B-GGUF')).toBe('qwen314b');
    expect(localModelMatchKey('Qwen3-14B-Instruct:Q5_K_M')).toBe('qwen314b');
  });

  it('strips the owner path and the huggingface.co prefix', () => {
    expect(localModelMatchKey('huggingface.co/owner/Phi-4-GGUF')).toBe('phi4');
    expect(localModelMatchKey('phi4:latest')).toBe('phi4');
  });

  it('keeps distinct families distinct', () => {
    expect(localModelMatchKey('qwen3:14b')).not.toBe(localModelMatchKey('qwen3:30b'));
  });
});

describe('findInstalledLocalMatch', () => {
  it('matches an HF-sourced candidate to an installed Ollama HF pull', () => {
    const candidate = { recommendedTag: 'hf:antirez/DeepSeek-V4-GGUF', modelFamily: 'Deepseek V4' };
    const installed = [{ id: 'hf.co/antirez/DeepSeek-V4-GGUF:Q4_K_M', runtime: 'ollama' as const }];
    const match = findInstalledLocalMatch(candidate, installed);
    expect(match?.id).toBe('hf.co/antirez/DeepSeek-V4-GGUF:Q4_K_M');
    expect(match?.runtime).toBe('ollama');
  });

  it('matches a curated default candidate via the normalized key', () => {
    const candidate = { recommendedTag: 'qwen3:14b', modelFamily: 'Qwen 3 14B' };
    const installed = [{ id: 'qwen3:14b', runtime: 'lmstudio' as const }];
    expect(findInstalledLocalMatch(candidate, installed)?.runtime).toBe('lmstudio');
  });

  it('falls back to the canonical family name when keys differ', () => {
    // inferLocalModelFamily maps a bare "qwen3" id to the "Qwen 3 14B" family.
    const candidate = { recommendedTag: 'qwen3:14b', modelFamily: 'Qwen 3 14B' };
    const installed = [{ id: 'qwen3', runtime: 'ollama' as const }];
    expect(findInstalledLocalMatch(candidate, installed)).toBeDefined();
  });

  it('returns undefined when nothing installed matches', () => {
    const candidate = { recommendedTag: 'hf:bartowski/Gemma-3-12B-GGUF', modelFamily: 'Gemma 3 12B' };
    const installed = [{ id: 'llama3.3:70b', runtime: 'ollama' as const }];
    expect(findInstalledLocalMatch(candidate, installed)).toBeUndefined();
  });
});

describe('interpretOllamaPullLine', () => {
  it('renders a percentage and byte counts when a download is in progress', () => {
    const line = JSON.stringify({ status: 'pulling manifest', completed: 524288000, total: 1048576000 });
    expect(interpretOllamaPullLine(line)).toEqual({ text: 'pulling manifest — 50% (500.0 MB/1000.0 MB)' });
  });

  it('returns the bare status when there is no byte progress', () => {
    expect(interpretOllamaPullLine(JSON.stringify({ status: 'verifying sha256 digest' }))).toEqual({
      text: 'verifying sha256 digest',
    });
  });

  it('surfaces an error object as an error', () => {
    expect(interpretOllamaPullLine(JSON.stringify({ error: 'model not found' }))).toEqual({ error: 'model not found' });
  });

  it('ignores blank and non-JSON keep-alive lines', () => {
    expect(interpretOllamaPullLine('')).toEqual({});
    expect(interpretOllamaPullLine('   ')).toEqual({});
    expect(interpretOllamaPullLine('not json')).toEqual({});
  });
});

describe('formatByteCount', () => {
  it('scales units from bytes to gigabytes', () => {
    expect(formatByteCount(512)).toBe('512 B');
    expect(formatByteCount(2048)).toBe('2.0 KB');
    expect(formatByteCount(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatByteCount(3 * 1024 * 1024 * 1024)).toBe('3.00 GB');
  });
});
