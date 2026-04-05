import type { ModelCapability, TaskModality, TaskPhase, TaskProfile, TaskReasoning } from '../types.js';

const VISION_HINTS = /\b(image|images|screenshot|screenshots|photo|photos|png|jpg|jpeg|gif|webp|svg|bmp|tiff|diagram|figure|figma|mockup|wireframe|ocr|visual|ui|ux|layout|canvas|draw|render|pixel|icon|logo|chart|graph|plot|infographic|annotation|colour|color|palette|thumbnail)\b/i;

const CODE_HINTS = /\b(code|source|sourcecode|typescript|javascript|tsx|jsx|python|java|c#|c\+\+|rust|go|golang|ruby|php|swift|kotlin|scala|shell|bash|powershell|sql|html|css|scss|sass|less|vue|svelte|angular|react|node\.?js|deno|bun|webpack|vite|eslint|prettier|stack\s*trace|exception|compile|compiler|transpile|lint|linter|test|tests|unit\s?test|e2e|cypress|playwright|vitest|jest|mocha|refactor|debug|debugger|bug|patch|diff|repository|workspace|function|class|method|module|package|dependency|dependencies|import|export|api|endpoint|route|schema|migration|orm|query|mutation|interface|type|enum|generic|template|iterator|async|await|promise|callback|hook|middleware|decorator|annotation|cli|sdk|library|framework|codebase|monorepo)\b/i;

const HIGH_REASONING_HINTS = /\b(architecture|architect|design\s?pattern|system\s?design|plan|planning|strategy|strategic|trade-?off|tradeoff|compare|comparison|versus|vs\.?|pros?\s+(and|&)\s+cons?|migration|migrate|root\s?cause|investigate|investigation|security|audit|threat\s?model|pentest|review|code\s?review|synthesize|synthesis|why|complex|complexity|hard|difficult|challenge|edge\s?case|corner\s?case|race\s?condition|deadlock|optimize|optimise|performance|scalab|bottleneck|latency|throughput|algorithm|data\s?structure|proof|theorem|formal|verify|correctness|invariant|concurrency|parallel|distributed|consensus|replication|shard)\b/i;

const MEDIUM_REASONING_HINTS = /\b(explain|analyze|analysis|summarize|summary|implement|implementation|update|change|fix|repair|resolve|improve|enhancement|document|documentation|describe|evaluate|assess|troubleshoot|diagnose|configure|setup|set\s?up|install|deploy|deployment|release|publish|build|scaffold|generate|create|add|remove|delete|rename|move|extract|inline|wrap|convert|transform|translate|port|upgrade|downgrade|rewrite|restructure|reorganize|format|clean\s?up|tidy|annotate|comment|type|typing)\b/i;

const HIGH_IMPORTANCE_HINTS = /\b(important|critical|high[-\s]?stakes|careful|carefully|accurate|accuracy|correct|correctly|production|prod|safest|reliable|reliably|must\s+be\s+right|cannot\s+be\s+wrong|need\s+confidence)\b/i;

const CONTEXTUAL_FOLLOWUP_HINTS = /\b(based\s+on\s+(this|the|our)\s+(chat|thread|conversation|discussion)|from\s+(this|the|our)\s+(chat|thread|conversation|discussion)|using\s+(this|the|our)\s+(chat|thread|conversation|discussion)|given\s+(this|the|our)\s+(chat|thread|conversation|discussion)|given\s+the\s+above|based\s+on\s+the\s+above|from\s+the\s+above|earlier\s+in\s+(the\s+)?(chat|thread|conversation)|previous\s+messages|prior\s+messages|conversation\s+so\s+far|thread\s+so\s+far)\b/i;

export class TaskProfiler {
  profileTask(input: {
    userMessage: string;
    context?: Record<string, unknown>;
    phase: TaskPhase;
    requiresTools?: boolean;
  }): TaskProfile {
    const combinedText = `${input.userMessage}\n${this.flattenContext(input.context)}`.trim();
    const modality = inferModality(combinedText);
    const hasSessionContext = typeof input.context?.['sessionContext'] === 'string'
      && input.context['sessionContext'].trim().length > 0;
    const reasoning = inferReasoning(combinedText, input.phase, modality, hasSessionContext);
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

function inferReasoning(
  text: string,
  phase: TaskPhase,
  modality: TaskModality,
  hasSessionContext: boolean,
): TaskReasoning {
  if (phase === 'planning' || phase === 'synthesis') {
    return 'high';
  }
  if (HIGH_IMPORTANCE_HINTS.test(text)) {
    return 'high';
  }
  if (HIGH_REASONING_HINTS.test(text)) {
    return 'high';
  }
  if (modality === 'mixed') {
    return 'high';
  }
  if (hasSessionContext && CONTEXTUAL_FOLLOWUP_HINTS.test(text)) {
    return modality === 'text' ? 'medium' : 'high';
  }
  if (MEDIUM_REASONING_HINTS.test(text) || modality === 'code' || modality === 'vision') {
    return 'medium';
  }
  return 'low';
}