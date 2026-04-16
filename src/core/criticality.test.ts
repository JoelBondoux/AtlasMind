import { describe, it, expect } from 'vitest';
import { assessCriticality, CriticalityLevel, Task } from './criticality';

describe('assessCriticality', () => {
  it('should return UNKNOWN for an empty task', () => {
    const task: Task = {
      description: '',
      files: [],
    };
    expect(assessCriticality(task)).toBe(CriticalityLevel.UNKNOWN);
  });

  it('should return LOW for a simple task with no sensitive keywords or files', () => {
    const task: Task = {
        description: 'Update the UI with new colors',
        files: ['src/ui/styles.css'],
    };
    expect(assessCriticality(task)).toBe(CriticalityLevel.LOW);
  });

  it('should return MEDIUM for a task touching core modules', () => {
    const task: Task = {
        description: 'Refactor the main orchestrator loop',
        files: ['src/core/orchestrator.ts'],
    };
    expect(assessCriticality(task)).toBe(CriticalityLevel.MEDIUM);
  });

  it('should return HIGH for a task with "auth" keyword', () => {
    const task: Task = {
        description: 'Fix a bug in the authentication flow',
        files: ['src/login.ts'],
    };
    expect(assessCriticality(task)).toBe(CriticalityLevel.HIGH);
  });

    it('should return HIGH for a task with "security" keyword', () => {
    const task: Task = {
        description: 'Address security vulnerability',
        files: ['src/utils.ts'],
    };
    expect(assessCriticality(task)).toBe(CriticalityLevel.HIGH);
  });

  it('should return CRITICAL for a task with "deploy" and "config" keywords', () => {
    const task: Task = {
        description: 'Update production deployment config',
        files: ['deploy/prod.json'],
    };
    expect(assessCriticality(task)).toBe(CriticalityLevel.CRITICAL);
  });

    it('should return CRITICAL for a task with "migration" keyword', () => {
    const task: Task = {
        description: 'Run database schema migration',
        files: ['scripts/migrate.ts'],
    };
    expect(assessCriticality(task)).toBe(CriticalityLevel.CRITICAL);
  });

  it('should return HIGH for a task modifying package.json dependencies', () => {
    const task: Task = {
        description: 'Update dependencies',
        files: ['package.json'],
    };
    expect(assessCriticality(task)).toBe(CriticalityLevel.HIGH);
  });

  it('should prioritize higher criticality levels', () => {
    const task: Task = {
        description: 'Refactor auth module for deployment',
        files: ['src/core/auth.ts', 'deploy/prod.json'],
    };
    expect(assessCriticality(task)).toBe(CriticalityLevel.CRITICAL);
  });
});
