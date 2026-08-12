import { describe, it, expect } from 'vitest';
import {
  classifyModelRole,
  isConversationalModel,
  describeModelRoleExclusion,
  MODEL_ROLE_RULES,
} from '../../src/providers/modelRole.js';

describe('classifyModelRole — the failure this exists to prevent', () => {
  it('refuses the safety classifier that broke a real turn', () => {
    // v0.300.0: `local/endpoint-94xdvd48@@llama-guard-3-1b` was routed as a chat
    // model and answered with a Jinja template error, spending the last failover
    // attempt of the turn. A guard model cannot hold a conversation at all.
    const assessment = classifyModelRole('local/endpoint-94xdvd48@@llama-guard-3-1b');
    expect(assessment.role).toBe('safety-classifier');
    expect(assessment.conversational).toBe(false);
    expect(assessment.rule).toBe('safety-classifier-family');
  });

  it('names the rule that decided, so the exclusion is explainable', () => {
    const assessment = classifyModelRole('nomic-embed-text');
    expect(assessment.role).toBe('embedding');
    expect(MODEL_ROLE_RULES.some(rule => rule.id === assessment.rule)).toBe(true);
    expect(describeModelRoleExclusion('nomic-embed-text')).toContain('embedding');
  });

  it('offers no exclusion line for a model it is not excluding', () => {
    expect(describeModelRoleExclusion('qwen3:14b')).toBeUndefined();
  });
});

describe('classifyModelRole — id normalization', () => {
  it('reads through the provider prefix and the endpoint segment', () => {
    for (const id of [
      'llama-guard-3-1b',
      'local/llama-guard-3-1b',
      'endpoint-94xdvd48@@llama-guard-3-1b',
      'local/endpoint-94xdvd48@@llama-guard-3-1b',
      'local/ollama@@llama-guard3:8b',
    ]) {
      expect(classifyModelRole(id).conversational, id).toBe(false);
    }
  });

  it('is case-insensitive', () => {
    expect(classifyModelRole('Llama-Guard-3-1B').conversational).toBe(false);
  });

  it('treats an empty or unusable id as conversational rather than guessing', () => {
    // Withholding a model on no evidence would hide working capacity. Absence of
    // a marker is not evidence of a non-chat role.
    expect(classifyModelRole('').conversational).toBe(true);
    expect(classifyModelRole('   ').conversational).toBe(true);
    expect(classifyModelRole(undefined as unknown as string).conversational).toBe(true);
  });
});

describe('classifyModelRole — non-conversational families', () => {
  const cases: Array<[string, string]> = [
    // Local runtimes
    ['llama-guard-3-1b', 'safety-classifier'],
    ['llamaguard-7b', 'safety-classifier'],
    ['shieldgemma-2b', 'safety-classifier'],
    ['granite3-guardian:8b', 'safety-classifier'],
    ['prompt-guard-86m', 'safety-classifier'],
    ['nemoguard-8b', 'safety-classifier'],
    ['wildguard', 'safety-classifier'],
    ['nomic-embed-text:latest', 'embedding'],
    ['mxbai-embed-large', 'embedding'],
    ['bge-m3', 'embedding'],
    ['all-minilm:l6-v2', 'embedding'],
    ['snowflake-arctic-embed2', 'embedding'],
    ['bge-reranker-v2-m3', 'reranker'],
    ['jina-reranker-v2', 'reranker'],
    ['mxbai-rerank-large-v1', 'reranker'],
    ['faster-whisper-medium', 'transcription'],
    ['parakeet-tdt-0.6b', 'transcription'],
    ['stable-diffusion-3.5', 'image-generation'],
    ['sdxl-turbo', 'image-generation'],
    // Cloud providers list these from /v1/models alongside their chat models.
    ['openai/text-embedding-3-large', 'embedding'],
    ['openai/whisper-1', 'transcription'],
    ['openai/tts-1-hd', 'speech-synthesis'],
    ['openai/dall-e-3', 'image-generation'],
    ['openai/omni-moderation-latest', 'safety-classifier'],
  ];

  for (const [modelId, role] of cases) {
    it(`classifies ${modelId} as ${role}`, () => {
      const assessment = classifyModelRole(modelId);
      expect(assessment.role).toBe(role);
      expect(assessment.conversational).toBe(false);
    });
  }
});

describe('classifyModelRole — models that must stay routable', () => {
  // A false positive here hides capacity the user paid for and installed. Every
  // id below is a real conversational model whose name brushes against a marker.
  const conversational = [
    'qwen3:14b',
    'qwen2.5-coder:32b',
    'llama3.3:70b',
    'tinyllama-1b',
    'mistral-small3.2',
    'deepseek-r1:32b',
    'gemma3:27b',
    'phi4-reasoning',
    'devstral-small',
    'gpt-oss:20b',
    'command-r-plus',
    'nemotron-mini',
    'granite3.3:8b',
    'hermes3:8b',
    'codestral',
    'starcoder2:15b',
    'magistral-small',
    'olmo2:13b',
    'exaone-deep',
    'smollm2:1.7b',
    'openai/gpt-5.1',
    'openai/gpt-4o-audio-preview',
    'anthropic/claude-opus-4-5',
    'google/gemini-3-pro',
    'acp/claude@opus#high',
  ];

  for (const modelId of conversational) {
    it(`keeps ${modelId} routable`, () => {
      const assessment = classifyModelRole(modelId);
      expect(assessment.role, `${modelId} was excluded by rule ${assessment.rule}`).toBe('conversational');
      expect(isConversationalModel(modelId)).toBe(true);
    });
  }
});

describe('MODEL_ROLE_RULES', () => {
  it('publishes a rule table with unique ids and stated reasons', () => {
    const ids = MODEL_ROLE_RULES.map(rule => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const rule of MODEL_ROLE_RULES) {
      expect(rule.reason.length).toBeGreaterThan(0);
      expect(rule.role).not.toBe('conversational');
      expect(rule.markers.length).toBeGreaterThan(0);
    }
  });

  it('ranks reranker above embedding, which decides bge-reranker', () => {
    const order = MODEL_ROLE_RULES.map(rule => rule.role);
    expect(order.indexOf('reranker')).toBeLessThan(order.indexOf('embedding'));
  });

  it('matches markers on name segments, never on a bare substring', () => {
    // `bge`, `gte` and `dall` are short enough that substring matching would
    // sweep up ordinary chat models. The tokeniser is what keeps them safe to
    // declare.
    expect(classifyModelRole('bge-m3').conversational).toBe(false);
    expect(classifyModelRole('bgem3-chat').conversational).toBe(true);
    expect(classifyModelRole('embedded-reasoner').conversational).toBe(true);
    expect(classifyModelRole('guardrails-tuned-chat').conversational).toBe(true);
  });
});
