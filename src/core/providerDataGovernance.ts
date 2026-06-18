/**
 * Static data-governance reference for model providers.
 *
 * Surfaced on the Project Dashboard → Privacy page for the providers that own a
 * trusted model, so an operator handling confidential or regulated data can
 * quickly reach the provider's privacy controls — data-subject / GDPR request
 * portals, data processing agreements, and retention / training policies.
 *
 * This is operator-facing reference material, not legal advice. URLs and
 * policies change; treat the provider's own documentation as authoritative.
 */

export interface ProviderDataGovernance {
  /** One-line summary of default data retention. */
  retentionSummary: string;
  /** Whether the provider trains on API data by default. */
  trainsOnDataByDefault: boolean | 'unknown';
  /** Privacy policy / trust center. */
  privacyPolicyUrl?: string;
  /** Where a data-subject (GDPR/CCPA) request is submitted. */
  dataRequestUrl?: string;
  /** Data Processing Addendum, if published. */
  dpaUrl?: string;
  /** Free-form note (e.g. on-device, zero-retention options). */
  notes?: string;
}

const ON_DEVICE: ProviderDataGovernance = {
  retentionSummary: 'Runs on your machine — no data leaves the device.',
  trainsOnDataByDefault: false,
  notes: 'Local inference (Ollama / LM Studio / llama.cpp). No provider-side data handling applies.',
};

const PROVIDER_DATA_GOVERNANCE: Record<string, ProviderDataGovernance> = {
  anthropic: {
    retentionSummary: 'API inputs/outputs retained up to 30 days (longer if flagged for trust & safety).',
    trainsOnDataByDefault: false,
    privacyPolicyUrl: 'https://www.anthropic.com/legal/privacy',
    dataRequestUrl: 'https://privacy.anthropic.com/',
    dpaUrl: 'https://www.anthropic.com/legal/commercial-terms',
    notes: 'Commercial API data is not used to train models by default.',
  },
  openai: {
    retentionSummary: 'API data retained up to 30 days for abuse monitoring, then deleted.',
    trainsOnDataByDefault: false,
    privacyPolicyUrl: 'https://openai.com/policies/privacy-policy',
    dataRequestUrl: 'https://privacy.openai.com/',
    dpaUrl: 'https://openai.com/policies/data-processing-addendum',
    notes: 'API data is not used to train models by default; Zero Data Retention available on approval.',
  },
  google: {
    retentionSummary: 'Gemini API (paid tier) data is not used to improve products; retention per Cloud terms.',
    trainsOnDataByDefault: false,
    privacyPolicyUrl: 'https://policies.google.com/privacy',
    dataRequestUrl: 'https://support.google.com/policies/contact/general_privacy_form',
    dpaUrl: 'https://cloud.google.com/terms/data-processing-addendum',
    notes: 'Free-tier / AI Studio data handling differs from paid Vertex/Gemini API — verify your tier.',
  },
  mistral: {
    retentionSummary: 'API data retention governed by Mistral terms; no training on API data by default.',
    trainsOnDataByDefault: false,
    privacyPolicyUrl: 'https://mistral.ai/terms/#privacy-policy',
    dataRequestUrl: 'https://mistral.ai/terms/#privacy-policy',
    dpaUrl: 'https://mistral.ai/terms/#data-processing-agreement',
  },
  deepseek: {
    retentionSummary: 'Data may be stored on servers in the PRC; review residency before sending regulated data.',
    trainsOnDataByDefault: 'unknown',
    privacyPolicyUrl: 'https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html',
    notes: 'Data residency and training policy warrant scrutiny for GDPR/HIPAA workloads.',
  },
  xai: {
    retentionSummary: 'Retention governed by xAI terms; review before sending regulated data.',
    trainsOnDataByDefault: 'unknown',
    privacyPolicyUrl: 'https://x.ai/legal/privacy-policy',
    dataRequestUrl: 'https://x.ai/legal/privacy-policy',
  },
  groq: {
    retentionSummary: 'GroqCloud does not retain prompts/outputs after the request by default.',
    trainsOnDataByDefault: false,
    privacyPolicyUrl: 'https://groq.com/privacy-policy/',
    dpaUrl: 'https://groq.com/data-processing-addendum/',
  },
  copilot: {
    retentionSummary: 'GitHub Copilot: prompts/suggestions not retained for business/enterprise; not used for training.',
    trainsOnDataByDefault: false,
    privacyPolicyUrl: 'https://docs.github.com/en/site-policy/privacy-policies/github-copilot-privacy-statement',
    dataRequestUrl: 'https://privacy.github.com/',
    dpaUrl: 'https://github.com/customer-terms/github-data-protection-agreement',
  },
  bedrock: {
    retentionSummary: 'AWS Bedrock: prompts/outputs are not stored by AWS and not used to train base models.',
    trainsOnDataByDefault: false,
    privacyPolicyUrl: 'https://aws.amazon.com/privacy/',
    dataRequestUrl: 'https://aws.amazon.com/compliance/gdpr-center/',
    dpaUrl: 'https://aws.amazon.com/service-terms/',
    notes: 'Data stays within your selected AWS Region; inherits your AWS DPA.',
  },
  openrouter: {
    retentionSummary: 'Routing layer — actual retention depends on the downstream provider serving the model.',
    trainsOnDataByDefault: 'unknown',
    privacyPolicyUrl: 'https://openrouter.ai/privacy',
    notes: 'Per-request you can restrict which downstream providers may serve traffic; verify each.',
  },
  local: ON_DEVICE,
};

const GENERIC: ProviderDataGovernance = {
  retentionSummary: 'No governance reference on file — consult the provider\'s privacy documentation.',
  trainsOnDataByDefault: 'unknown',
};

/** Returns governance metadata for a provider id, or a generic fallback. */
export function getProviderDataGovernance(providerId: string): ProviderDataGovernance {
  return PROVIDER_DATA_GOVERNANCE[providerId] ?? GENERIC;
}

/** Whether a curated (non-generic) governance entry exists for the provider. */
export function hasProviderDataGovernance(providerId: string): boolean {
  return providerId in PROVIDER_DATA_GOVERNANCE;
}
