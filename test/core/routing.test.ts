import { describe, it, expect } from 'vitest';
import { createAtlasRuntime } from '../../src/runtime/core';
import type { Orchestrator } from '../../src/core/orchestrator';

describe('Task Routing', () => {
    const runtime = createAtlasRuntime({
        memoryStore: {
            queryRelevant: async () => [],
            getWarnedEntries: async () => [],
            getBlockedEntries: async () => [],
            redactSnippet: (snippet) => snippet,
            upsert: async () => {},
        },
        costTracker: {
            record: async () => {},
            getDailyBudgetStatus: async () => ({ limit: 0, spent: 0, currency: 'USD' }),
        },
        skillContext: {} as any,
    });

    const orchestrator: Orchestrator = runtime.orchestrator;

    it('should route a code review request to the code-reviewer agent', async () => {
        const message = "Review this change for bugs, regressions, and missing tests before we merge it.";
        const result = await orchestrator.routeTask(message);
        expect(result.agent.id).toBe('code-reviewer');
    });

    it('should route a security analysis request to the security-reviewer agent', async () => {
        const message = "Run a security gap analysis of this workspace and identify missing runtime protections.";
        const result = await orchestrator.routeTask(message);
        expect(result.agent.id).toBe('security-reviewer');
    });

    it('should route a regression coverage request to the test-developer agent', async () => {
        const message = "Primary review finding: Missing regression coverage for milestone tracking - no tests validate that roadmap items can be marked complete with evidence, and no failing-to-passing test demonstrates the milestone completion workflow.";
        const result = await orchestrator.routeTask(message);
        expect(result.agent.id).toBe('test-developer');
    });

    it('should route a license compatibility question to the legal-oversight agent', async () => {
        const message = "Is the MIT licence on this dependency compatible with shipping our extension commercially?";
        const result = await orchestrator.routeTask(message);
        expect(result.agent.id).toBe('legal-oversight');
    });

    it('should route a dark-pattern ethics question to the ethics-oversight agent', async () => {
        const message = "Does this onboarding flow use dark patterns to push users into the paid tier?";
        const result = await orchestrator.routeTask(message);
        expect(result.agent.id).toBe('ethics-oversight');
    });

    it('should route a pricing strategy question to the commercial-oversight agent', async () => {
        const message = "Should we charge per-seat or per-workspace, and how do competitors price this?";
        const result = await orchestrator.routeTask(message);
        expect(result.agent.id).toBe('commercial-oversight');
    });

    it('should route an ordinary prose request to the default agent', async () => {
        const message = "Hello, can you help me?";
        const result = await orchestrator.routeTask(message);
        expect(result.agent.id).toBe('default');
    });

    it('should route a file-read request to the default agent', async () => {
        const message = "Read the file and tell me what is in it.";
        const result = await orchestrator.routeTask(message);
        expect(result.agent.id).toBe('default');
    });

    it('should route an ambiguous security/code review request to the security-reviewer agent', async () => {
        const message = "Review this code for security vulnerabilities.";
        const result = await orchestrator.routeTask(message);
        expect(result.agent.id).toBe('security-reviewer');
    });
});
