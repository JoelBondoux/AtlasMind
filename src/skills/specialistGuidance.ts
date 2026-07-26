import type { SkillDefinition } from '../types.js';
import { requireString } from './validation.js';

const GUIDANCE_TOPICS = [
  'technical-seo',
  'structured-data',
  'content-discoverability',
  'platform-listing',
  'accessibility',
  'responsive-layout',
  'interaction-design',
  'ui-implementation',
] as const;

type GuidanceTopic = typeof GUIDANCE_TOPICS[number];

const GUIDANCE: Record<GuidanceTopic, readonly string[]> = {
  'technical-seo': [
    'Identify the public, indexable surfaces and their intended queries before proposing changes.',
    'Inspect rendered HTML, status codes, redirects, canonicalization, robots directives, sitemap coverage, internal links, and client-only rendering from repository or live evidence.',
    'Check that titles and descriptions are unique and useful; avoid fixed character-count guarantees because display behavior varies by query and platform.',
    'Treat performance thresholds, crawler behavior, and search-product features as time-sensitive. Verify them against current primary documentation before making a numeric or platform-specific claim.',
    'Validate the resulting pages with the project build plus an appropriate crawler, performance tool, or search-platform validator when available.',
  ],
  'structured-data': [
    'Select vocabulary that matches content visibly present on the page and an outcome the target consumer currently supports.',
    'Populate only truthful values backed by page or project data. Never invent ratings, reviews, prices, authorship, availability, or organizational facts.',
    'Keep structured data consistent with visible content, canonical URLs, locale, and entity identifiers.',
    'Verify current required and recommended fields in Schema.org plus the target platform\'s primary documentation, then run its validator when available.',
    'Treat validation success as syntax/eligibility evidence, not a guarantee of enhanced search presentation.',
  ],
  'content-discoverability': [
    'Map the audience\'s concrete questions and decision needs before editing headings or copy.',
    'Make important answers explicit, self-contained, and easy to attribute; support material claims with named primary sources and dates.',
    'Preserve human usefulness and editorial voice. Do not add keyword repetition, generic filler, synthetic quotations, or unsupported statistics for search or AI systems.',
    'Keep entity names, product facts, authorship, and canonical source pages consistent across the site and external profiles.',
    'Verify current crawler controls, answer-engine behavior, and opt-out mechanisms from primary sources; do not assume one crawler directive controls every system.',
  ],
  'platform-listing': [
    'Identify the actual discovery surfaces, such as a marketplace listing, repository, package registry, or documentation portal.',
    'Align the product name, concise purpose statement, categories, keywords, screenshots, compatibility claims, and support links with the shipped artifact.',
    'Use only accurate, specific terms a user would search for; avoid duplicated generic tags or capabilities the product does not provide.',
    'Check the target platform\'s current field limits and ranking guidance in its primary documentation instead of relying on remembered limits.',
    'Verify links, version/compatibility metadata, release notes, and install instructions before publishing.',
  ],
  accessibility: [
    'Use native semantics first and verify each control\'s accessible name, role, state, value, and error relationship.',
    'Exercise the complete flow with keyboard-only input, logical focus order, visible focus, Escape behavior, and focus restoration for transient surfaces.',
    'Ensure dynamic status and validation changes are announced appropriately without producing noisy or duplicated live-region output.',
    'Check text and non-text contrast, color-independent meaning, zoom/reflow, reduced motion, target size, and forced/high-contrast modes against the project\'s declared standard.',
    'Verify current conformance requirements from the applicable WCAG and platform documentation; automated checks complement but do not replace manual interaction testing.',
  ],
  'responsive-layout': [
    'Use the project\'s existing breakpoints and container rules; derive new breakpoints from content failure rather than imposing a device taxonomy.',
    'Test representative narrow, intermediate, wide, zoomed, and long-content states for overflow, clipping, overlap, unreachable controls, and lost hierarchy.',
    'Preserve reading order and interaction semantics when regions stack, collapse, scroll, or move.',
    'Keep line length and density appropriate without stretching content merely because more viewport space exists.',
    'Document any intentionally fixed-size or two-dimensional region and provide an accessible overflow strategy.',
  ],
  'interaction-design': [
    'Trace the user\'s goal through entry, progress, success, empty, loading, error, cancellation, and recovery states.',
    'Prefer recognition over recall, clear affordances, progressive disclosure, error prevention, and reversible actions where the domain permits.',
    'Use the component whose semantics match the interaction; do not substitute visual similarity for correct behavior.',
    'Distinguish a verified usability or accessibility failure from a preference, and explain the user impact of each recommendation.',
    'Preserve escape routes, user control, and state continuity across interruptions and failures.',
  ],
  'ui-implementation': [
    'Inspect the framework, component library, design tokens, and nearby implementation before editing.',
    'Reuse existing primitives, dependency choices, naming, spacing, typography, and state patterns unless the task explicitly calls for a system-level change.',
    'Implement complete behavior and states without placeholder controls, dead affordances, inline event-handler shortcuts, or hard-coded theme colors.',
    'Keep the change proportional to the user problem and avoid introducing a new UI dependency for behavior the existing stack supports.',
    'Run the smallest relevant component, interaction, accessibility, and build checks; add focused regression coverage when practical.',
  ],
};

export const specialistGuidanceSkill: SkillDefinition = {
  id: 'specialist-guidance',
  name: 'Specialist Guidance',
  builtIn: true,
  description:
    'Load a focused, evidence-oriented checklist for SEO, structured data, content discoverability, ' +
    'platform listings, accessibility, responsive layout, interaction design, or UI implementation. ' +
    'Use it when detailed specialist guidance is needed; verify time-sensitive rules with current primary sources.',
  routingHints: [
    'load seo checklist',
    'load accessibility checklist',
    'review responsive layout',
    'review interaction design',
    'platform listing guidance',
  ],
  parameters: {
    type: 'object',
    required: ['topic'],
    properties: {
      topic: {
        type: 'string',
        enum: [...GUIDANCE_TOPICS],
        description: 'The focused guidance topic to load.',
      },
    },
  },
  async execute(params, _context) {
    const topicError = requireString(params, 'topic');
    if (topicError) {
      return topicError;
    }

    const topic = (params['topic'] as string).trim();
    if (!isGuidanceTopic(topic)) {
      return `Error: "topic" must be one of: ${GUIDANCE_TOPICS.join(', ')}.`;
    }

    return [
      `Specialist guidance — ${topic}:`,
      ...GUIDANCE[topic].map((item, index) => `${index + 1}. ${item}`),
      '',
      'Apply only the items relevant to the user\'s requested outcome and the inspected project. This is a baseline checklist, not evidence that any current platform rule or standard has been verified.',
    ].join('\n');
  },
};

function isGuidanceTopic(value: string): value is GuidanceTopic {
  return (GUIDANCE_TOPICS as readonly string[]).includes(value);
}
