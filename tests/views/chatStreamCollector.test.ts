import { describe, expect, it } from 'vitest';
import { ChatStreamCollector, renderCollectedResponse } from '../../src/views/chatStreamCollector.ts';

describe('ChatStreamCollector — the four methods the handlers actually use', () => {
  it('joins markdown in the order it was written', () => {
    const collector = new ChatStreamCollector();
    collector.markdown('### Agents');
    collector.markdown('- planner\n- reviewer');

    expect(collector.collect().markdown).toBe('### Agents\n\n- planner\n- reviewer');
  });

  it('reads a MarkdownString as well as a plain string', () => {
    const collector = new ChatStreamCollector();
    collector.markdown({ value: '**bold**' } as never);
    expect(collector.collect().markdown).toBe('**bold**');
  });

  it('keeps buttons as data, never as something the webview could execute', () => {
    const collector = new ChatStreamCollector();
    collector.button({ command: 'atlasmind.openSetupGuide', title: 'Open the guide', arguments: ['acp'] } as never);

    const [button] = collector.collect().buttons;
    expect(button).toMatchObject({ title: 'Open the guide', command: 'atlasmind.openSetupGuide', args: ['acp'] });
    // The id is what crosses to the webview; the command stays extension-side.
    expect(button!.id).toMatch(/^chat-action-\d+$/);
  });

  it('de-duplicates a button a handler offered twice', () => {
    // Handlers legitimately offer a step's primary action and then repeat it as
    // "do this next". Two identical chips side by side is not a reply.
    const collector = new ChatStreamCollector();
    for (let index = 0; index < 3; index += 1) {
      collector.button({ command: 'atlasmind.openChatPanel', title: 'Open chat', arguments: [] } as never);
    }
    expect(collector.collect().buttons).toHaveLength(1);
  });

  it('treats the same command with different arguments as different buttons', () => {
    const collector = new ChatStreamCollector();
    collector.button({ command: 'atlasmind.openSetupGuide', title: 'ACP', arguments: ['acp'] } as never);
    collector.button({ command: 'atlasmind.openSetupGuide', title: 'Buzz', arguments: ['buzz'] } as never);
    expect(collector.collect().buttons).toHaveLength(2);
  });

  it('ignores a button with no command rather than making an unclickable chip', () => {
    const collector = new ChatStreamCollector();
    collector.button({ title: 'Nowhere' } as never);
    expect(collector.collect().buttons).toEqual([]);
  });

  it('keeps only the last progress line', () => {
    const collector = new ChatStreamCollector();
    collector.progress('Reading agents…');
    collector.progress('Sorting…');
    expect(collector.collect().progress).toBe('Sorting…');
  });

  it('records references once, by path', () => {
    const collector = new ChatStreamCollector();
    const uri = { fsPath: 'c:\\work\\README.md', path: '/work/README.md' };
    collector.reference(uri as never);
    collector.reference(uri as never);
    expect(collector.collect().references).toEqual(['c:\\work\\README.md']);
  });
});

describe('ChatStreamCollector — features it cannot draw', () => {
  /**
   * Stubs rather than throws, on purpose.
   *
   * A handler that starts using `anchor` should lose an anchor, not lose the
   * whole command. But the loss is recorded, because a silently truncated answer
   * is the failure this whole path replaces.
   */
  it('degrades rather than failing, and says what it dropped', () => {
    const collector = new ChatStreamCollector();
    collector.markdown('Here is the plan.');
    collector.anchor({} as never, 'somewhere');
    collector.filetree([] as never, {} as never);

    const collected = collector.collect();
    expect(collected.markdown).toBe('Here is the plan.');
    expect(collected.unsupported).toEqual(['anchor', 'filetree']);
    expect(renderCollectedResponse(collected)).toMatch(/cannot draw \(anchor, filetree\)/);
  });

  it('renders a warning as content, because it is content', () => {
    const collector = new ChatStreamCollector();
    collector.warning('This will overwrite two files.');
    expect(collector.collect().markdown).toContain('This will overwrite two files.');
    expect(collector.collect().unsupported).toEqual([]);
  });
});

describe('renderCollectedResponse', () => {
  it('drops the progress line, which described work that has finished', () => {
    const collector = new ChatStreamCollector();
    collector.progress('Checking…');
    collector.markdown('Done.');
    // A transcript reading "Checking…" beneath a finished answer describes a
    // state that no longer exists.
    expect(renderCollectedResponse(collector.collect())).toBe('Done.');
  });

  it('lists references under the answer', () => {
    const collector = new ChatStreamCollector();
    collector.markdown('See the config.');
    collector.reference({ fsPath: 'c:\\work\\tsconfig.json' } as never);
    expect(renderCollectedResponse(collector.collect())).toContain('`c:\\work\\tsconfig.json`');
  });

  it('reports an empty response as a bug rather than showing nothing', () => {
    // Showing nothing would look exactly like the panel swallowing the command,
    // which is the symptom this path exists to remove.
    expect(renderCollectedResponse(new ChatStreamCollector().collect())).toMatch(/AtlasMind bug/);
  });
});
