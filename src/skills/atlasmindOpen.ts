import * as vscode from 'vscode';

import { CAPABILITY_PAGES, findCapabilityPages, type CapabilityPage } from '../core/capabilityIndex.js';
import type { SkillDefinition } from '../types.js';

/**
 * Take the operator to the page that answers their question.
 *
 * Chat could describe all 35 addressable pages and open two of them, and every
 * navigational answer it gave was prose: "that's under Settings → Safety", which
 * the operator then has to find. Both panels have taken a page id since they
 * were written, and `SettingsPanelTarget` additionally carries `section` and
 * `query` while the dashboard carries a focused record — an anchor space that
 * existed and was never once used from chat.
 *
 * Three properties make this safe to hand to a model.
 *
 * **The destination is chosen from a declared list, never composed.** `page` is
 * matched against {@link CAPABILITY_PAGES}; anything unrecognised is refused
 * with the candidates rather than passed through. A model cannot name a surface
 * that does not exist, and cannot reach a VS Code command that is not one of the
 * two openers below — this is not a general `executeCommand` bridge, and giving
 * a model one of those would be remote code execution with extra steps.
 *
 * **It is a `read`.** Opening a panel changes nothing, so gating it behind a
 * write prompt would be friction with no risk behind it — and a navigation tool
 * that prompts is one the model learns not to use.
 *
 * **The anchor is passed as data, never as a second command.** `section` reaches
 * `SettingsPanelTarget.section` and nothing else.
 */

const SURFACE_COMMANDS: Readonly<Record<CapabilityPage['surface'], string>> = {
  settings: 'atlasmind.openSettings',
  dashboard: 'atlasmind.openProjectDashboard',
};

/** How the refusal lists what the operator could have meant. */
function describeCandidates(candidates: readonly CapabilityPage[]): string {
  return candidates
    .slice(0, 8)
    .map(page => `- \`${page.surface}:${page.id}\` — ${page.title}: ${page.answers}`)
    .join('\n');
}

export const atlasmindOpenSkill: SkillDefinition = {
  id: 'atlasmind-open',
  name: 'Open an AtlasMind page',
  builtIn: true,
  description:
    'Open one of AtlasMind\'s own pages for the operator, optionally scrolled to a section. '
    + 'Use this instead of describing where a setting or view lives. '
    + 'The page must be one of the declared ids from the surface index.',
  parameters: {
    type: 'object',
    properties: {
      page: {
        type: 'string',
        description:
          'The page id, either bare ("debt") or qualified ("dashboard:debt"). '
          + 'Qualify it when the same id exists on both surfaces, such as "testing".',
      },
      section: {
        type: 'string',
        description: 'Optional card or section on that page to scroll to. Settings pages only.',
      },
    },
    required: ['page'],
  },
  async execute(params) {
    const page = params['page'];
    if (typeof page !== 'string' || page.trim().length === 0) {
      return 'Error: "page" is required. Use one of the ids from the AtlasMind surface index.';
    }
    const section = params['section'];
    if (section !== undefined && typeof section !== 'string') {
      return 'Error: "section" must be a string when provided.';
    }

    const matches = findCapabilityPages(page);
    if (matches.length === 0) {
      return `Error: "${page}" is not an AtlasMind page. Available pages:\n${describeCandidates(CAPABILITY_PAGES)}`;
    }
    if (matches.length > 1) {
      // Reported rather than resolved: `testing` exists on both surfaces, and
      // silently picking one sends the operator somewhere they did not ask for
      // while telling them they arrived.
      return `"${page}" matches more than one page. Qualify it with the surface:\n${describeCandidates(matches)}`;
    }

    const target = matches[0]!;
    const command = SURFACE_COMMANDS[target.surface];

    try {
      if (target.surface === 'settings') {
        await vscode.commands.executeCommand(command, {
          page: target.id,
          ...(typeof section === 'string' && section.trim().length > 0 ? { section: section.trim() } : {}),
        });
      } else {
        await vscode.commands.executeCommand(command, target.id);
      }
    } catch (error) {
      return `Error: could not open ${target.title}. ${error instanceof Error ? error.message : String(error)}`;
    }

    const anchor = target.surface === 'settings' && typeof section === 'string' && section.trim().length > 0
      ? `, at "${section.trim()}"`
      : '';
    return `Opened ${target.title}${anchor}. It covers: ${target.answers}.`;
  },
};
