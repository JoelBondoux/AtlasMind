import { CriticalityLevel } from '../core/criticality';

export interface CriticalityConfig {
  keywords: Partial<Record<CriticalityLevel, string[]>>;
  filePatterns: Partial<Record<CriticalityLevel, RegExp[]>>;
  modelFloors: Partial<Record<CriticalityLevel, number>>;
  defaultCriticality: CriticalityLevel;
}

export const defaultCriticalityConfig: CriticalityConfig = {
  keywords: {
    [CriticalityLevel.CRITICAL]: ['deploy', 'migration', 'production'],
    [CriticalityLevel.HIGH]: ['auth', 'security', 'payment', 'billing', 'credentials'],
    [CriticalityLevel.MEDIUM]: ['refactor', 'performance', 'optimization'],
  },
  filePatterns: {
    [CriticalityLevel.CRITICAL]: [/deploy\/prod\.json/i, /migration/i],
    [CriticalityLevel.HIGH]: [/package\.json/i, /auth/i, /security/i],
    [CriticalityLevel.MEDIUM]: [/src\/core\//i],
  },
  modelFloors: {
    [CriticalityLevel.UNKNOWN]: 0,
    [CriticalityLevel.LOW]: 1,
    [CriticalityLevel.MEDIUM]: 2,
    [CriticalityLevel.HIGH]: 3,
    [CriticalityLevel.CRITICAL]: 4,
  },
  defaultCriticality: CriticalityLevel.LOW,
};
