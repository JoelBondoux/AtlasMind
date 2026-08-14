import { describe, expect, it } from 'vitest';
import { classifyToolInvocation, requiresToolApproval } from '../../src/core/toolPolicy.ts';

describe('classifyToolInvocation terminal safety', () => {
  it('classifies node inline execution as terminal-write', () => {
    const policy = classifyToolInvocation('terminal-run', {
      command: 'node',
      args: ['-e', 'console.log(1)'],
    });

    expect(policy.category).toBe('terminal-write');
    expect(policy.risk).toBe('high');
  });

  it('classifies node version checks as terminal-read', () => {
    const policy = classifyToolInvocation('terminal-run', {
      command: 'node',
      args: ['--version'],
    });

    expect(policy.category).toBe('terminal-read');
  });

  it('keeps npm run test classified as terminal-read', () => {
    const policy = classifyToolInvocation('terminal-run', {
      command: 'npm',
      args: ['run', 'test'],
    });

    expect(policy.category).toBe('terminal-read');
  });

  it('classifies docker compose logs as terminal-read', () => {
    const policy = classifyToolInvocation('docker-cli', {
      args: ['compose', 'logs', 'api', '--tail', '100'],
    });

    expect(policy.category).toBe('terminal-read');
  });

  it('classifies docker compose up as terminal-write', () => {
    const policy = classifyToolInvocation('docker-cli', {
      args: ['compose', 'up', '-d'],
    });

    expect(policy.category).toBe('terminal-write');
    expect(policy.risk).toBe('high');
  });

  it('classifies in-memory specialist guidance as a low-risk read', () => {
    const policy = classifyToolInvocation('specialist-guidance', {
      topic: 'accessibility',
    });

    expect(policy.category).toBe('read');
    expect(policy.risk).toBe('low');
  });
});

describe('gh is graded by verb, as git is', () => {
  const gh = (...args: string[]) => classifyToolInvocation('terminal-run', { command: 'gh', args });

  it('treats reads as reads', () => {
    for (const args of [['pr', 'list'], ['pr', 'view', '42'], ['issue', 'list'], ['run', 'view'], ['pr', 'checks'], ['repo', 'view'], ['auth', 'status']]) {
      expect(gh(...args).category, args.join(' ')).toBe('terminal-read');
    }
  });

  it('treats writes as writes', () => {
    for (const args of [['pr', 'create'], ['pr', 'merge', '42'], ['pr', 'comment', '42'], ['issue', 'close', '7'], ['release', 'create'], ['pr', 'edit']]) {
      expect(gh(...args).category, args.join(' ')).toBe('terminal-write');
    }
  });

  it('grades an unrecognised verb as a write', () => {
    // gh adds subcommands regularly; guessing "probably a read" is the
    // expensive direction to be wrong in.
    expect(gh('pr', 'somethingnew').category).toBe('terminal-write');
    expect(gh('brandnewnamespace', 'list').category).toBe('terminal-write');
  });

  it('always grades gh api as a write', () => {
    // Arbitrary by design — `gh api -X DELETE …` is an ordinary invocation.
    expect(gh('api', 'repos/o/n').category).toBe('terminal-write');
    expect(gh('api', '--method', 'GET', 'repos/o/n').category).toBe('terminal-write');
  });

  it('is not fooled by a global flag that takes a value', () => {
    // `--hostname github.com` shifts every positional along, so index-based
    // parsing read the namespace as "github.com" and fell through — in the
    // permissive direction, which is the one that matters.
    expect(gh('--hostname', 'github.com', 'pr', 'merge', '1').category).toBe('terminal-write');
    expect(gh('--hostname', 'github.com', 'pr', 'list').category).toBe('terminal-read');
  });

  it('does not mistake a flag value for the namespace', () => {
    expect(gh('issue', 'create', '--title', 'pr', '--body', 'list').category).toBe('terminal-write');
  });

  it('names what will run, so an approval prompt can be read', () => {
    expect(gh('pr', 'merge', '42').summary).toContain('gh pr merge');
  });
});

describe('MCP tools are graded for what they do, not for their namespace', () => {
  // Every MCP tool arrives as `mcp:<server>:<tool>`, and READ_LIKE_PREFIXES
  // matches with startsWith — so the read list was unreachable for exactly the
  // tools it was written for, and `mcp:supabase:list_tables` graded network/high,
  // identically to a delete. With a couple of servers connected a single question
  // became a wall of dialogs, which is how an approval mode stops meaning
  // anything.
  it.each([
    'mcp:supabase:list_tables',
    'mcp:github:get_issue',
    'mcp:learn:microsoft_docs_search',
    'mcp:m365:outlook_email_search',
  ])('grades %s as network-read', name => {
    const policy = classifyToolInvocation(name, {});
    expect(policy.category).toBe('network-read');
    expect(policy.risk).toBe('low');
  });

  it('never grades a remote read as a plain local read', () => {
    // The distinction is the point: it mutates nothing, but it always leaves the
    // machine and may be carrying the operator's data out with it.
    expect(classifyToolInvocation('mcp:gmail:get_message', {}).category).not.toBe('read');
  });

  it.each([
    'mcp:gmail:send_message',
    'mcp:supabase:apply_migration',
    'mcp:shopify:create-product',
    'mcp:supabase:execute_sql',
  ])('keeps %s at high risk', name => {
    expect(classifyToolInvocation(name, {}).risk).toBe('high');
  });

  it('keeps the segment rule away from local tools', () => {
    // `web-fetch` contains "fetch". Matching a read verb anywhere in a *local*
    // tool name would make it a plain read — and the CLI gate, which permits
    // read-only tooling without opt-in, would start permitting network calls.
    expect(classifyToolInvocation('web-fetch', { url: 'https://example.com' }).category).toBe('network');
    expect(classifyToolInvocation('http-request', {}).category).toBe('network');
  });

  it('lets a remote read through ask-on-write but not ask-on-external', () => {
    // The two modes ask different questions, and this category has different
    // answers for them: it changes nothing, and it left the machine.
    const policy = classifyToolInvocation('mcp:github:get_issue', {});
    expect(requiresToolApproval('ask-on-write', policy)).toBe(false);
    expect(requiresToolApproval('ask-on-external', policy)).toBe(true);
    expect(requiresToolApproval('always-ask', policy)).toBe(true);
  });
});
