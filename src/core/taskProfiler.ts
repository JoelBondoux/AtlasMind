import type { ModelCapability, TaskModality, TaskPhase, TaskProfile, TaskReasoning } from '../types.js';
import type { ClassificationResult } from './classifierService.js';

const VISION_HINTS = /\b(image|images|screenshot|screenshots|photo|photos|png|jpg|jpeg|gif|webp|svg|bmp|tiff|diagram|figure|figma|mockup|wireframe|ocr|visual|canvas|draw|render|pixel|icon|logo|chart|graph|plot|infographic|annotation|thumbnail)\b/i;

const CODE_HINTS = /\b(code|source|sourcecode|typescript|javascript|tsx|jsx|python|java|c#|c\+\+|rust|go|golang|ruby|php|swift|kotlin|scala|shell|bash|powershell|sql|html|css|scss|sass|less|vue|svelte|angular|react|node\.?js|deno|bun|webpack|vite|eslint|prettier|stack\s*trace|exception|compile|compiler|transpile|lint|linter|test|tests|unit\s?test|e2e|cypress|playwright|vitest|jest|mocha|refactor|debug|debugger|bug|patch|diff|repository|workspace|function|class|method|module|package|dependency|dependencies|dependabot|import|export|api|endpoint|route|schema|migration|orm|query|mutation|interface|type|enum|generic|template|iterator|async|await|promise|callback|hook|middleware|decorator|annotation|cli|sdk|library|framework|codebase|monorepo|branch|pull\s?request|\bpr\b|merge|rebase|cherry-pick|sidebar|dropdown|scroll(?:ed|ing)?|overflow|viewport|session(?:s)?|panel|webview)\b/i;

const HIGH_REASONING_HINTS = /\b(architecture|architect|design\s?pattern|system\s?design|plan|planning|strategy|strategic|trade-?off|tradeoff|compare|comparison|versus|vs\.?|pros?\s+(and|&)\s+cons?|migration|migrate|root\s?cause|investigate|investigation|security|audit|threat\s?model|pentest|code\s?review|synthesize|synthesis|why|complex|complexity|hard|difficult|challenge|edge\s?case|corner\s?case|race\s?condition|deadlock|optimize|optimise|performance|scalab|bottleneck|latency|throughput|algorithm|data\s?structure|proof|theorem|formal|verify|correctness|invariant|concurrency|parallel|distributed|consensus|replication|shard)\b/i;

const MEDIUM_REASONING_HINTS = /\b(explain|analyze|analysis|summarize|summary|implement|implementation|update|change|fix|repair|resolve|improve|enhancement|document|documentation|describe|evaluate|assess|troubleshoot|diagnose|configure|setup|set\s?up|install|deploy|deployment|release|publish|build|scaffold|generate|create|add|remove|delete|rename|move|extract|inline|wrap|convert|transform|translate|port|upgrade|downgrade|rewrite|restructure|reorganize|format|clean\s?up|tidy|annotate|comment|type|typing|merge|rebase|cherry-pick|dependabot|dependency\s+update|branch|pull\s?request|\bpr\b)\b/i;

const HIGH_IMPORTANCE_HINTS = /\b(important|critical|high[-\s]?stakes|careful|carefully|accurate|accuracy|correct|correctly|production|prod|safest|reliable|reliably|must\s+be\s+right|cannot\s+be\s+wrong|need\s+confidence)\b/i;

const CONTEXTUAL_FOLLOWUP_HINTS = /\b(based\s+on\s+(this|the|our)\s+(chat|thread|conversation|discussion)|from\s+(this|the|our)\s+(chat|thread|conversation|discussion)|using\s+(this|the|our)\s+(chat|thread|conversation|discussion)|given\s+(this|the|our)\s+(chat|thread|conversation|discussion)|given\s+the\s+above|based\s+on\s+the\s+above|from\s+the\s+above|earlier\s+in\s+(the\s+)?(chat|thread|conversation)|previous\s+messages|prior\s+messages|conversation\s+so\s+far|thread\s+so\s+far)\b/i;

// Mechanical git/build operations that stay low-reasoning regardless of prior conversation
// complexity. This prevents the session-context inheritance logic from incorrectly promoting
// bare git ops (commit, push, etc.) that happen to follow a high-reasoning discussion.
const MAINTENANCE_TASK_HINTS = /\b(?:commit|push|stash|git\s+(?:pull|fetch|checkout|reset|amend))\b/i;
const DEICTIC_ACTION_FOLLOWUP_HINTS = /^\s*(?:please\s+)?(?:(?:go\s+ahead(?:\s+and)?|proceed|continue|resume|carry\s+on|do|handle|apply|merge|rebase|ship|run)\s+(?:that|this|it|them|those|these)|take\s+care\s+of\s+(?:that|this|it|them|those|these)|(?:can|could)\s+you\s+(?:do|handle|take\s+care\s+of|apply|merge|rebase|ship|run)\s+(?:that|this|it|them|those|these))(?:\s+for\s+me)?[\s.!?]*$/i;
const ACTIONABLE_SESSION_CONTEXT_HINTS = /\b(?:fix|patch|repair|resolve|implement|update|change|modify|refactor|rename|merge|rebase|cherry-pick|dependabot|dependency|package|lockfile|branch(?:es)?|pull\s+request|\bpr\b|commit|stash|test|build|compile|workspace|repo|repository|extension|bug|issue|regression|layout|sidebar|dropdown|panel|webview|orchestrator|provider)\b/i;

export class TaskProfiler {
  profileTask(input: {
    userMessage: string;
    context?: Record<string, unknown>;
    phase: TaskPhase;
    requiresTools?: boolean;
  }): TaskProfile {
    const combinedText = `${input.userMessage}\n${this.flattenContext(input.context)}`.trim();
    const hasImage = hasImageAttachments(input.context);

    // Use LLM classification when available; fall back to regex.
    const classification = input.context?.['__classification'] as ClassificationResult | undefined;
    const modality: TaskModality = classification?.modality ?? inferModality(combinedText, hasImage);
    const sessionContextText = typeof input.context?.['sessionContext'] === 'string'
      ? input.context['sessionContext']
      : '';
    const hasSessionContext = sessionContextText.trim().length > 0;
    const reasoning: TaskReasoning = (input.phase === 'planning' || input.phase === 'synthesis')
      ? 'high'
      : classification?.reasoning ?? inferReasoning(combinedText, input.userMessage, sessionContextText, input.phase, modality, hasSessionContext);
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

function inferModality(text: string, hasImageAttachment = false): TaskModality {
  const hasVision = hasImageAttachment || VISION_HINTS.test(text);
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

function hasImageAttachments(context: Record<string, unknown> | undefined): boolean {
  const attachments = context?.['imageAttachments'];
  return Array.isArray(attachments)
    && attachments.some(item => {
      if (typeof item !== 'object' || item === null) {
        return false;
      }

      const candidate = item as Record<string, unknown>;
      return typeof candidate['mimeType'] === 'string'
        && candidate['mimeType'].startsWith('image/')
        && typeof candidate['dataBase64'] === 'string'
        && candidate['dataBase64'].length > 0;
    });
}

function inferReasoning(
  text: string,
  userMessage: string,
  sessionContextText: string,
  phase: TaskPhase,
  modality: TaskModality,
  hasSessionContext: boolean,
): TaskReasoning {
  if (phase === 'planning' || phase === 'synthesis') {
    return 'high';
  }
  // Test inherent complexity hints only against the user's current message, not session
  // context. Using the full combinedText here caused simple follow-up tasks (e.g. "commit")
  // to be classified as high-reasoning whenever prior turns mentioned architecture,
  // security, etc., which incorrectly routed them to expensive reasoning models.
  if (HIGH_IMPORTANCE_HINTS.test(userMessage)) {
    return 'high';
  }
  if (HIGH_REASONING_HINTS.test(userMessage)) {
    return 'high';
  }
  if (modality === 'mixed') {
    return 'high';
  }
  // Context-aware follow-up checks still use the full combined text because they
  // need to see session history to detect deictic references ("handle that for me").
  if (hasSessionContext && DEICTIC_ACTION_FOLLOWUP_HINTS.test(text) && ACTIONABLE_SESSION_CONTEXT_HINTS.test(text)) {
    return modality === 'text' ? 'medium' : 'high';
  }
  if (hasSessionContext && CONTEXTUAL_FOLLOWUP_HINTS.test(text)) {
    return modality === 'text' ? 'medium' : 'high';
  }
  if (MEDIUM_REASONING_HINTS.test(userMessage) || modality === 'code' || modality === 'vision') {
    return 'medium';
  }
  // Implicit thematic continuation: if the session contains high-complexity discussion
  // and the current message is very terse (≤8 words) and does not look like a standalone
  // action, inherit medium reasoning from the session context. Capped at 'medium' so
  // follow-ups like "what about the write path?" don't inflate cost to full-reasoning tier.
  const DEICTIC_ACTION_GUARD_HINTS = /\b(?:do|apply|fix|run|try|use|make|add|remove|delete|send|push|pull|set|get|show|list|check|stop|start|restart|refresh|reset|save|load|open|close|create|generate|build|compile|deploy|merge|rebase|ship|execute|proceed|continue|go\s+ahead)\b/i;
  if (
    hasSessionContext
    && HIGH_REASONING_HINTS.test(sessionContextText)
    && userMessage.trim().split(/\s+/).length <= 8
    && !MAINTENANCE_TASK_HINTS.test(userMessage)
    && !DEICTIC_ACTION_GUARD_HINTS.test(userMessage)
  ) {
    return 'medium';
  }
  return 'low';
}