export enum CriticalityLevel {
  UNKNOWN = 'UNKNOWN',
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export interface Task {
  description: string;
  files: string[];
}

const CRITICALITY_KEYWORDS: { [level in CriticalityLevel]?: string[] } = {
  [CriticalityLevel.CRITICAL]: ['deploy', 'migration', 'production'],
  [CriticalityLevel.HIGH]: ['auth', 'security', 'payment', 'billing', 'credentials'],
  [CriticalityLevel.MEDIUM]: ['refactor', 'performance', 'optimization'],
};

const CRITICALITY_FILES: { [level in CriticalityLevel]?: RegExp[] } = {
  [CriticalityLevel.CRITICAL]: [/deploy\/prod\.json/i, /migration/i],
  [CriticalityLevel.HIGH]: [/package\.json/i, /auth/i, /security/i],
  [CriticalityLevel.MEDIUM]: [/src\/core\//i],
};

/**
 * Assesses task criticality from the user request and touched paths.
 */
export function assessCriticality(task: Task): CriticalityLevel {
  const description = String(task.description || '').toLowerCase();
  const files = Array.isArray(task.files) ? task.files : [];

  if (!description && files.length === 0) {
    return CriticalityLevel.UNKNOWN;
  }

  let level = CriticalityLevel.LOW;

  for (const [candidate, keywords] of Object.entries(CRITICALITY_KEYWORDS)) {
    if (keywords?.some(keyword => description.includes(keyword))) {
      level = higherCriticality(level, candidate as CriticalityLevel);
    }
  }

  for (const [candidate, filePatterns] of Object.entries(CRITICALITY_FILES)) {
    if (files.some(file => filePatterns?.some(pattern => pattern.test(file)))) {
      level = higherCriticality(level, candidate as CriticalityLevel);
    }
  }

  return level;
}

function higherCriticality(a: CriticalityLevel, b: CriticalityLevel): CriticalityLevel {
  const levels = Object.values(CriticalityLevel);
  return levels.indexOf(a) > levels.indexOf(b) ? a : b;
}

