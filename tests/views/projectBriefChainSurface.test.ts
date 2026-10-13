import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The chain from the brief to the roadmap, as the surfaces wire it. The planner
 * is unit-tested on its own; these pin the properties that live in the wiring,
 * where a mistake would leave the planner intact and route around it.
 */

const read = (...parts: string[]): string => readFileSync(path.join(process.cwd(), ...parts), 'utf8').replace(/\r\n/g, '\n');
const PANEL = read('src', 'views', 'projectIdeationPanel.ts');
const WEBVIEW = read('media', 'projectIdeation.js');
const DASHBOARD = read('src', 'views', 'projectDashboardPanel.ts');
const BOOTSTRAP = read('src', 'bootstrap', 'bootstrapper.ts');
const COMMANDS = read('src', 'commands.ts');
const MANIFEST = JSON.parse(read('package.json')) as {
  contributes: {
    commands: Array<{ command: string; title: string }>;
    walkthroughs: Array<{ id: string; steps: Array<{ id: string; description: string; completionEvents?: string[]; media?: { markdown?: string } }> }>;
  };
};

function slice(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  expect(start, from).toBeGreaterThan(-1);
  const end = source.indexOf(to, start + from.length);
  expect(end, to).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('the webview can only ask for a step', () => {
  it('posts a step id and nothing else', () => {
    const handler = slice(WEBVIEW, "action === 'ideation-brief-chain'", "action === 'ideation-brief-chain-rules'");
    expect(handler).toContain("vscode.postMessage({ type: 'advanceBriefChain', payload });");
  });

  it('accepts only a declared step id at the boundary', () => {
    const validator = slice(PANEL, "candidate['type'] === 'advanceBriefChain'", "candidate['type'] === 'archiveCard'");
    expect(validator).toContain('BRIEF_CHAIN_STEP_IDS');
    expect(validator).toContain("typeof candidate['payload'] === 'string'");
  });

  it('re-plans from the files and runs only a step the files say is ready', () => {
    const handler = slice(PANEL, 'private async advanceBriefChain', 'private async captureBriefFromChain');
    expect(handler).toContain('await this.planBriefChainFromFiles(workspaceRoot, ssotPath)');
    expect(handler).toContain("step.state !== 'ready'");
    expect(handler.indexOf("step.state !== 'ready'")).toBeLessThan(handler.indexOf('switch (stepId)'));
  });

  it('renders the chain from the snapshot, with a button only for a step that can run', () => {
    const render = slice(WEBVIEW, 'function renderBriefChain(', 'function renderStarterFrames(');
    expect(render).toContain("chain.steps.filter(step => step.state === 'ready')");
    expect(render).toContain('escapeHtml(step.says)');
    expect(render).toContain('escapeHtml(chain.nextSays)');
    expect(render).not.toContain('<details');
    expect(WEBVIEW).toContain('briefChainRulesOpen: false');
  });

  it('shows the chain on a board with cards, and the brief composer on an empty one', () => {
    const rail = slice(WEBVIEW, 'function renderRail(', '\n  }');
    expect(rail).toContain("(boardIsEmpty ? '' : renderBriefChain(snapshot))");
  });
});

describe('the state is derived, never stored', () => {
  it('plans from the brief, every board, the roadmap and the soul as they are on disk', () => {
    const planner = slice(PANEL, 'private async planBriefChainFromFiles', 'private async advanceBriefChain');
    expect(planner).toContain('await this.readProjectBrief(workspaceRoot)');
    expect(planner).toContain('for (const workspace of registry.workspaces)');
    expect(planner).toContain('await readRoadmapItemsForExternalSurface()');
    expect(planner).toContain("'project_soul.md'");
    // No progress record of its own: nothing in the panel writes chain state.
    expect(PANEL).not.toMatch(/briefChain[A-Za-z]*\s*=\s*await\s+this\.context/);
    expect(PANEL).not.toContain("workspaceState.update('atlasmind.briefChain");
  });

  it('marks a seeded brief card so the chain finds it from the board file', () => {
    expect(PANEL).toContain("tags: template.id === BRIEF_TEMPLATE_ID ? ['starter-frame', BRIEF_CARD_TAG] : ['starter-frame']");
  });
});

describe('each write is shown before it happens', () => {
  it('raises only picked, grounded cards, confirms the exact lines, re-plans, then writes through the one roadmap writer', () => {
    const handler = slice(PANEL, 'private async raiseBriefCardsAsWork', 'private async fileBriefRoadmapPlans');
    expect(handler).toContain('plan.raise.map(');
    expect(handler).toContain('picked: false');
    expect(handler).toContain('Quoting your brief:');
    expect(handler).toContain('modal: true');
    const confirm = handler.indexOf('modal: true');
    const replan = handler.indexOf('const fresh = await this.planBriefChainFromFiles');
    const write = handler.indexOf('addRoadmapItemFromExternalSurface(this.atlas, proposal.text)');
    const record = handler.indexOf('card.derived = derived');
    expect(confirm).toBeGreaterThan(-1);
    expect(replan).toBeGreaterThan(confirm);
    expect(write).toBeGreaterThan(replan);
    // A card claims what it became only after the line exists.
    expect(record).toBeGreaterThan(write);
    expect(handler).toContain('if (!written) {');
  });

  it('files plans create-only through the dashboard, after listing every path', () => {
    const handler = slice(PANEL, 'private async fileBriefRoadmapPlans', 'private async quoteBriefInSoul');
    expect(handler).toContain('proposal.relPath');
    expect(handler.indexOf('modal: true')).toBeLessThan(handler.indexOf('fileRoadmapPlansFromExternalSurface('));
    const filer = slice(DASHBOARD, 'export async function fileRoadmapPlansFromExternalSurface', 'async function readExternalRoadmapContext');
    expect(filer).toContain("flag: 'wx'");
    expect(filer).toContain('EEXIST');
    expect(filer).toContain('buildRoadmapPlanScaffold(');
    expect(filer).toContain('read.preserveExisting');
  });

  it('reads the roadmap without writing, using the one id resolution', () => {
    const reader = slice(DASHBOARD, 'export async function readRoadmapItemsForExternalSurface', 'export async function fileRoadmapPlansFromExternalSurface');
    expect(reader).not.toMatch(/writeFile|writeRoadmapGraph/);
    const context = slice(DASHBOARD, 'async function readExternalRoadmapContext', '\n}\n');
    expect(context).toContain('resolveRoadmapItemIds(');
    expect(context).toContain("!== 'ENOENT'");
  });

  it('shows the soul insertion, refuses if the soul moved, and only creates or appends', () => {
    const handler = slice(PANEL, 'private async quoteBriefInSoul', 'private async seedBoardTemplate');
    expect(handler).toContain('clampForDialog(proposal.insertion)');
    expect(handler).toContain("'Preview first'");
    expect(handler).toContain('if (current !== proposal.basis)');
    expect(handler).toContain("flag: 'wx'");
    expect(handler).toContain('fs.appendFile(soulPath, proposal.insertion');
    expect(handler.indexOf('if (current !== proposal.basis)')).toBeLessThan(handler.indexOf('fs.appendFile('));
    // Never a whole-file write over an existing soul.
    expect(handler.match(/fs\.writeFile\(/g)?.length ?? 0).toBe(1);
  });

  it('takes the brief step through the one capture path, which confirms a replacement', () => {
    const handler = slice(PANEL, 'private async captureBriefFromChain', 'private async raiseBriefCardsAsWork');
    expect(handler).toContain('await promptForProjectBrief()');
    expect(handler).toContain('await this.captureProjectBrief(outcome.text)');
  });
});

describe('onboarding asks', () => {
  it('asks /bootstrap for the brief before the product questions, and keeps it out of the model context', () => {
    const intake = slice(BOOTSTRAP, 'async function collectBootstrapIntake(', 'interface BootstrapGeneratedContent');
    expect(intake.indexOf('await promptForProjectBrief()')).toBeGreaterThan(-1);
    expect(intake.indexOf('await promptForProjectBrief()')).toBeLessThan(intake.indexOf('#### Product Brief'));
    expect(intake).toContain("intake.ownWordsBriefStatus = 'not-given'");
    const context = slice(BOOTSTRAP, 'function buildBootstrapIntakeContext(', 'async function generateBootstrapContent(');
    expect(context).not.toContain('ownWordsBrief');
  });

  it('writes the bootstrap brief create-only', () => {
    const writer = slice(BOOTSTRAP, 'async function writeBootstrapOwnWordsBrief(', 'function describeOwnWordsBrief(');
    expect(writer).toContain('{ replace: false }');
  });

  it('puts the question in the Get Started walkthrough, backed by a registered command', () => {
    const steps = MANIFEST.contributes.walkthroughs.find(entry => entry.id === 'atlasmind.getStarted')?.steps ?? [];
    const ids = steps.map(step => step.id);
    expect(ids.indexOf('describeProject')).toBe(ids.indexOf('bootstrapOrImport') + 1);
    const step = steps.find(entry => entry.id === 'describeProject');
    expect(step?.description).toContain('(command:atlasmind.describeProject)');
    expect(step?.completionEvents).toContain('onCommand:atlasmind.describeProject');
    expect(step?.media?.markdown).toBe('media/walkthrough/describe-project.md');
    expect(read('media', 'walkthrough', 'describe-project.md')).toContain('exactly as you wrote it');
    expect(MANIFEST.contributes.commands.find(entry => entry.command === 'atlasmind.describeProject')?.title)
      .toBe('AtlasMind: Describe the Project in Your Own Words');
    expect(COMMANDS).toContain("registerCommand('atlasmind.describeProject'");
  });
});
