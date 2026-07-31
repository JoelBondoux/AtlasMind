import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { subscriptionButtonLabel } from '../../src/views/modelProviderPanel';

/**
 * The routes that have to be *visible*, not merely contributed.
 *
 * v0.202.0 capped each titlebar at five slots — correctly, since VS Code
 * collapses the rest behind `...` — and the settings route was the item
 * demoted to make room. Two things then made it invisible rather than merely
 * deprioritised: it sat in a non-`navigation` group, which VS Code only ever
 * renders inside the overflow menu, **and** four of the five settings commands
 * had no `icon` at all, so promoting them alone would still have drawn nothing.
 *
 * A contributed command nobody can see is the same failure this repository has
 * hit repeatedly under other names: live, working, and undiscoverable.
 */

const manifest = JSON.parse(
  readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
) as {
  contributes?: {
    commands?: Array<{ command: string; icon?: string; title?: string }>;
    menus?: Record<string, Array<{ command: string; when?: string; group?: string }>>;
  };
};

const commands = manifest.contributes?.commands ?? [];
const viewTitle = manifest.contributes?.menus?.['view/title'] ?? [];
const itemContext = manifest.contributes?.menus?.['view/item/context'] ?? [];

const sidebarViews = [...new Set(
  viewTitle.map(entry => /^view == ([\w.]+)/.exec(entry.when ?? '')?.[1]).filter((v): v is string => Boolean(v)),
)];

const navigationFor = (view: string) => viewTitle
  .filter(entry => (entry.when ?? '').startsWith(`view == ${view}`))
  .filter(entry => (entry.group ?? '').startsWith('navigation'));

describe('every settings route can actually be drawn', () => {
  it('gives each settings command an icon', () => {
    // Without one, a navigation-group entry renders nothing useful — which is
    // why promoting the group alone would not have fixed the report.
    const settings = commands.filter(entry => /^atlasmind\.openSettings/.test(entry.command));
    expect(settings.length).toBeGreaterThanOrEqual(5);
    for (const entry of settings) {
      expect(entry.icon, entry.command).toBeTruthy();
    }
  });

  it('shows a settings icon on every sidebar view that has room for one', () => {
    const missing: string[] = [];
    for (const view of sidebarViews) {
      const nav = navigationFor(view);
      const slots = new Set(nav.map(entry => entry.group));
      const hasSettings = nav.some(entry => /^atlasmind\.openSettings/.test(entry.command));
      // A full titlebar is allowed to keep its settings route in the overflow;
      // there is nowhere else for it to go.
      if (!hasSettings && slots.size < 5) {
        missing.push(view);
      }
    }
    expect(missing, 'these views have a free slot and no visible settings route').toEqual([]);
  });

  it('reserves the Chat titlebar’s fifth visible slot for the Settings cog', () => {
    // Chat is the AtlasMind home and had a full titlebar, so its Settings
    // command was deliberately put into an overflow-only group. That made the
    // most general configuration route much harder to find than any of the
    // dashboard shortcuts. Project-memory maintenance remains available in the
    // overflow; Settings is the visible fifth action.
    const chatNavigation = navigationFor('atlasmind.chatView');
    expect(chatNavigation).toContainEqual(expect.objectContaining({
      command: 'atlasmind.openSettings',
      group: 'navigation@5',
    }));

    const chatMemory = viewTitle.filter(entry =>
      (entry.when ?? '').startsWith('view == atlasmind.chatView')
      && ['atlasmind.importProject', 'atlasmind.updateProjectMemory'].includes(entry.command));
    expect(chatMemory).toHaveLength(2);
    expect(new Set(chatMemory.map(entry => entry.group))).toEqual(new Set(['5_memory@1']));
  });

  it('still respects the five-slot ceiling everywhere', () => {
    // The rule the promotion had to work within, not around.
    for (const view of sidebarViews) {
      const slots = new Set(navigationFor(view).map(entry => entry.group));
      expect(slots.size, view).toBeLessThanOrEqual(5);
    }
  });

  it('gives the Models titlebar a refresh', () => {
    // The refresh existed only as a per-row action, and already refreshed every
    // provider regardless of the row it was invoked from.
    expect(navigationFor('atlasmind.modelsView').map(entry => entry.command))
      .toContain('atlasmind.models.refreshProvider');
  });
});

describe('the subscription plan action', () => {
  /**
   * `atlasmind.models.configureSubscription` was registered in `commands.ts`,
   * declared in no manifest entry, and contributed to no menu — so it could not
   * be reached from the palette or from any surface. Registered and unreachable.
   */
  it('is declared, iconed, and attached to subscription rows', () => {
    const declared = commands.find(entry => entry.command === 'atlasmind.models.configureSubscription');
    expect(declared, 'the command is registered in code but not declared').toBeTruthy();
    expect(declared?.icon).toBeTruthy();

    const inline = itemContext.filter(entry => entry.command === 'atlasmind.models.configureSubscription');
    expect(inline).toHaveLength(1);
    expect(inline[0]?.when).toContain('-subscription');
    expect(inline[0]?.group).toMatch(/^inline/);
  });

  it('does not collide with another inline action on the same rows', () => {
    // Subscription rows also match `/^model-/`, so they receive that group's
    // actions too. Two entries sharing a group have unspecified order.
    const plan = itemContext.find(entry => entry.command === 'atlasmind.models.configureSubscription');
    const clashing = itemContext.filter(entry =>
      entry.command !== 'atlasmind.models.configureSubscription'
      && entry.group === plan?.group
      && (entry.when ?? '').includes('atlasmind.modelsView'));
    expect(clashing.map(entry => entry.command), 'shares an inline slot').toEqual([]);
  });

  it('stays out of the palette, because it needs a row to act on', () => {
    const palette = (manifest.contributes?.menus?.commandPalette ?? [])
      .find(entry => entry.command === 'atlasmind.models.configureSubscription');
    expect(palette?.when).toBe('false');
  });
});

describe('provider copy that names a settings page routes to it', () => {
  const source = readFileSync(path.join(process.cwd(), 'src', 'views', 'modelProviderPanel.ts'), 'utf8');

  it('names the provider in the plan button', () => {
    // Three subscription providers can be on screen at once, and every one of
    // these buttons read "$ Configure plan".
    expect(subscriptionButtonLabel('copilot', 'GitHub Copilot')).toBe('$ Configure GitHub Copilot plan');
  });

  it('does not name ACP after the protocol, because the plan belongs to an agent', () => {
    // "$ Configure ACP Agents (subscription) plan" named a thing nobody sells.
    // The agents behind `acp` are billed against separate subscriptions, so the
    // button promises a plan and the flow's first step asks which agent's.
    const label = subscriptionButtonLabel('acp', 'ACP Agents (subscription)');
    expect(label).toBe('$ Configure agent plan');
    expect(label).not.toContain('ACP Agents (subscription)');
  });

  it('renders the copy through the linking renderer, not raw escapeHtml', () => {
    expect(source).toContain('${renderProviderCopy(notes)}');
  });

  it('maps page ids to commands rather than building a command id', () => {
    // A command name interpolated from a webview string would let the webview
    // choose what runs.
    expect(source).toContain('SETTINGS_PAGE_COMMANDS[message.payload]');
    expect(source).not.toMatch(/executeCommand\(`atlasmind\.openSettings\$\{/);
  });

  it('links a page only where a command exists behind it', () => {
    // A phrase that matched with no page behind it would draw a button that
    // goes nowhere — worse than the plain text it replaced.
    // Anchored on the declarations: an unanchored match found the *usage*
    // first, and passed vacuously against a block containing no page ids.
    const linkBlock = /const SETTINGS_PAGE_LINKS[\s\S]*?\];/.exec(source)?.[0] ?? '';
    const commandBlock = /const SETTINGS_PAGE_COMMANDS[\s\S]*?\};/.exec(source)?.[0] ?? '';
    expect(linkBlock, 'link table not found').not.toBe('');
    expect(commandBlock, 'command map not found').not.toBe('');
    for (const page of [...linkBlock.matchAll(/'([a-z]+)'\]/g)].map(match => match[1]!)) {
      expect(commandBlock, `no command for page "${page}"`).toContain(`${page}:`);
    }
  });

  it('still tells the ACP reader where the switch is', () => {
    // The sentence is the thing being linked; losing it would remove the point.
    expect(source).toContain('Settings → Safety');
    expect(source).toContain('no separate AtlasMind API key is needed');
  });
});
