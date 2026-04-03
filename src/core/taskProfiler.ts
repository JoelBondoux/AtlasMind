import type { ModelCapability, TaskModality, TaskPhase, TaskProfile, TaskReasoning } from '../types.js';

const VISION_HINTS = /\b(image|images|screenshot|screenshots|photo|photos|png|jpg|jpeg|gif|webp|diagram|figure|figma|mockup|ocr|visual)\b/i;
const CODE_HINTS = /\b(code|source|typescript|javascript|tsx|jsx|python|java|c#|c\+\+|rust|go|stack\s*trace|exception|compile|compiler|lint|test|tests|refactor|debug|bug|patch|diff|repository|workspace|function|class|method|file|files)\b/i;
const HIGH_REASONING_HINTS = /\b(architecture|architect|design|plan|strategy|trade-?off|compare|migration|migrate|root cause|investigate|security|review|synthesize|synthesis|why|complex|hard)\b/i;
const MEDIUM_REASONING_HINTS = /\b(explain|analyze|analysis|summarize|summary|implement|update|change|fix|improve|document)\b/i;

export class TaskProfiler {
  profileTask(input: {
    userMessage: string;
    context?: Record<string, unknown>;
    phase: TaskPhase;
    requiresTools?: boolean;
  }): TaskProfile {
    const combinedText = `${input.userMessage}\n${this.flattenContext(input.context)}`.trim();
    const modality = inferModality(combinedText);
    const reasoning = inferReasoning(combinedText, input.phase, modality);
    const requiredCapabilities = new Set<ModelCapability>();
    const preferredCapabilities = new Set<ModelCapability>(['chat']);

    if (input.requiresTools) {
      requiredCapabilities.add('function_calling');
    }

    if (modality === 'vision' || modality === 'mixed') {
      requiredCapabilities.add('vision');
    }

    if (modality === 'code' || modality === 'mixed') {
      preferredCapabilities.add('code');
    }

    if (reasoning === 'high') {
      preferredCapabilities.add('reasoning');
    }

    if (modality === 'vision' || modality === 'mixed') {
      preferredCapabilities.add('vision');
    }

    return {
      phase: input.phase,
      modality,
      reasoning,
      requiresTools: input.requiresTools ?? false,
      requiredCapabilities: [...requiredCapabilities],
      preferredCapabilities: [...preferredCapabilities],
    };
  }

  private flattenContext(context: Record<string, unknown> | undefined): string {
    if (!context) {
      return '';
    }

    const parts: string[] = [];
    for (const [key, value] of Object.entries(context)) {
      if (typeof value === 'string') {
        parts.push(`${key}: ${value}`);
        continue;
      }
      if (Array.isArray(value)) {
        parts.push(`${key}: ${value.map(item => String(item)).join(' ')}`);
        continue;
      }
      if (typeof value === 'number' || typeof value === 'boolean') {
        parts.push(`${key}: ${String(value)}`);
      }
    }
    return parts.join('\n');
  }
}

function inferModality(text: string): TaskModality {
  const hasVision = VISION_HINTS.test(text);
  const hasCode = CODE_HINTS.test(text);

  if (hasVision && hasCode) {
    return 'mixed';
  }
  if (hasVision) {
    return 'vision';
  }
  if (hasCode) {
    return 'code';
  }
  return 'text';
}

function inferReasoning(text: string, phase: TaskPhase, modality: TaskModality): TaskReasoning {
  if (phase === 'planning' || phase === 'synthesis') {
    return 'high';
  }
  if (HIGH_REASONING_HINTS.test(text)) {
    return 'high';
  }
  if (modality === 'mixed') {
    return 'high';
  }
  if (MEDIUM_REASONING_HINTS.test(text) || modality === 'code' || modality === 'vision') {
    return 'medium';
  }
  return 'low';
}