/** Game-shaped debt from declared policy and observed evidence. No inferred magic numbers. */
import { redactSecrets } from '../utils/secretRedactor.js';
import { scanGameAssetInventory, type GameAssetInventoryReport } from './gameAssetInventory.js';
import { GAME_FORK_DEBT_METRICS, type GameProfile } from './gameProfile.js';
import type { ProjectComposition } from './projectComposition.js';
import { collectUpstreamDivergence, type UpstreamDivergenceGitRunner, type UpstreamDivergenceReport } from './upstreamDivergence.js';
import { debtEntryId, debtRule, normalizeEvidencePath, scanForDebtMarkers, type DebtEntry, type DebtScanCandidate, type DebtScanFile } from './debtRegister.js';

export interface GameDebtSourceFile extends DebtScanFile { componentId: string; }
export interface GameDebtInput {
  composition?: ProjectComposition;
  profile?: GameProfile;
  inventory?: GameAssetInventoryReport;
  divergence?: readonly UpstreamDivergenceReport[];
  sourceFiles?: readonly GameDebtSourceFile[];
  previous?: readonly DebtEntry[];
  profilePath?: string;
}
export interface GameDebtResult {
  candidates: DebtScanCandidate[];
  /** Only these exact findings were actually re-assessed. Never a whole file authority. */
  assessedIds: string[];
  notes: string[];
}
export const GAME_DEBT_MAX_CANDIDATES = 500;
const MAX_SOURCE_CHARS = 4 * 1024 * 1024;

function safePath(value: string): boolean {
  return normalizeEvidencePath(value) === value && !/[\u0000-\u001f\u007f]/.test(value)
    && redactSecrets(value).text === value;
}
function under(path: string, root: string): boolean { return root === '.' || path === root || path.startsWith(root + '/'); }

export function deriveGameDebt(input: GameDebtInput): GameDebtResult {
  const candidates: DebtScanCandidate[] = [];
  const assessed = new Set<string>();
  const notes: string[] = [];
  const components = input.composition?.components ?? [];
  const profile = input.profile;
  if (!profile || components.length === 0) {
    return { candidates, assessedIds: [], notes: ['Game signals not assessed: a usable game profile and declared composition are required.'] };
  }
  let capped = false;
  const add = (candidate: DebtScanCandidate): void => {
    if (candidates.length >= GAME_DEBT_MAX_CANDIDATES) {
      capped = true;
      const rank = { high: 0, medium: 1, low: 2 };
      let worst = 0;
      for (let index = 1; index < candidates.length; index += 1) {
        if (rank[candidates[index].severity] >= rank[candidates[worst].severity]) { worst = index; }
      }
      if (rank[candidate.severity] < rank[candidates[worst].severity]) { candidates[worst] = candidate; }
      return;
    }
    candidates.push(candidate);
  };
  const make = (ruleId: string, componentId: string, title: string, evidencePath: string, evidenceLine?: number, evidenceDetail?: string): DebtScanCandidate => {
    const rule = debtRule(ruleId)!;
    return { rule: ruleId, domain: rule.domain, severity: rule.severity, componentId,
      componentLabel: components.find(c => c.id === componentId)?.label ?? componentId,
      title, evidencePath, ...(evidenceLine === undefined ? {} : { evidenceLine }),
      ...(evidenceDetail === undefined ? {} : { evidenceDetail }) };
  };
  if (!input.inventory?.confirmed) { notes.push('Assets and import markers not assessed: no confirmed inventory was supplied.'); }
  for (const inventory of input.inventory?.confirmed ? input.inventory.components : []) {
    const component = components.find(c => c.id === inventory.componentId);
    if (!component) { notes.push('An asset inventory could not be matched to the declared composition.'); continue; }
    if (inventory.status !== 'available') { notes.push(`Assets for ${component.id}: not-visible or unreadable; existing findings retained.`); continue; }
    const declaredRoots = profile.contentRoots?.filter(root => (root.componentId ?? components.find(c => c.home)?.id) === component.id).map(root => root.location) ?? [];
    if (inventory.contentRoots.length === 0 || inventory.contentRoots.some(root => !declaredRoots.includes(root))) {
      notes.push(`Assets for ${component.id}: inventory roots do not match the current profile.`); continue;
    }
    const lfsKnown = component.vcs === 'git' && (inventory.lfs.status === 'assessed' || inventory.lfs.status === 'partial');
    if (lfsKnown) {
      const binaries = new Set(inventory.assets.filter(asset => asset.binary).map(asset => asset.path));
      for (const assetPath of inventory.lfs.uncoveredPaths ?? []) {
        if (candidates.length >= GAME_DEBT_MAX_CANDIDATES) { capped = true; break; }
        if (safePath(assetPath) && binaries.has(assetPath)) {
          add(make('game-asset-outside-lfs', component.id, 'Binary asset outside declared Git LFS coverage', assetPath));
        }
      }
    } else { notes.push(`LFS for ${component.id}: not-visible or unreadable; no clean result inferred.`); }
    for (const marker of inventory.importErrorMarkers) {
      if (safePath(marker.path) && Number.isSafeInteger(marker.line) && marker.line > 0) {
        add(make('game-import-error', component.id, marker.kind === 'import-error' ? 'Import-error marker in asset metadata' : 'Missing-reference marker in asset metadata', marker.path, marker.line));
      }
    }
    const complete = !inventory.truncated && inventory.withheldPathCount === 0 && inventory.excludedDirectoryCount === 0;
    for (const previous of input.previous ?? []) {
      if (previous.componentId !== component.id || !safePath(previous.evidencePath)
        || !inventory.contentRoots.some(root => under(previous.evidencePath, root))) { continue; }
      if (complete && ((previous.rule === 'game-asset-outside-lfs' && inventory.lfs.status === 'assessed' && component.vcs === 'git')
        || (previous.rule === 'game-import-error' && inventory.importMarkerAssessment === 'complete'))) {
        assessed.add(previous.id);
      }
    }
    if (!complete || inventory.importMarkerAssessment !== 'complete') {
      notes.push(`Assets for ${component.id}: partial inventory; absence does not clear previous findings.`);
    }
  }
  let sourceChars = 0;
  let sourceCount = 0;
  for (const source of (input.sourceFiles ?? []).slice(0, 3000)) {
    const component = components.find(c => c.id === source.componentId);
    if (component?.archetype?.archetype !== 'game' || !safePath(source.path)) { continue; }
    if (source.content.length > 512 * 1024 || sourceChars + source.content.length > MAX_SOURCE_CHARS) {
      notes.push('Tuning markers: source-reading limit reached; unexamined findings retained.'); break;
    }
    sourceChars += source.content.length;
    sourceCount += 1;
    for (const marker of scanForDebtMarkers([source], [{ marker: 'TUNING', severity: 'low' }])) {
      const name = /^TUNING:\s*([A-Za-z][A-Za-z0-9_.-]{0,63})(?:\s|$)/.exec(marker.title)?.[1];
      if (!name || redactSecrets(name).text !== name) { continue; }
      const rule = marker.rule === 'security-marker' ? 'game-sensitive-tuning' : 'game-tuning-in-code';
      add(make(rule, component.id, `Author-marked tuning value in code: ${name}`, source.path, marker.evidenceLine));
    }
    for (const previous of input.previous ?? []) {
      if ((previous.rule === 'game-tuning-in-code' || previous.rule === 'game-sensitive-tuning') && previous.componentId === component.id && previous.evidencePath === source.path) { assessed.add(previous.id); }
    }
  }
  if (sourceCount === 0) { notes.push('Tuning values: no game source files assessed; numeric literals are never guessed to be debt.'); }
  const home = components.find(c => c.home);
  const profilePath = input.profilePath ?? 'project_memory/domain/game.json';
  if (!profile.forkDebtThresholds?.length) { notes.push('Engine-fork debt not assessed: no project threshold is declared.'); }
  for (const threshold of profile.forkDebtThresholds ?? []) {
    const component = components.find(c => c.id === threshold.componentId);
    const report = input.divergence?.find(r => r.componentId === threshold.componentId);
    if (!home || !safePath(profilePath) || component?.role !== 'engine' || component.vcs !== 'git' || !component.upstream
      || report?.status !== 'available' || report.upstream.remote !== component.upstream.remote || report.upstream.ref !== component.upstream.ref
      || !(GAME_FORK_DEBT_METRICS as readonly string[]).includes(threshold.metric)
      || !Number.isSafeInteger(threshold.maximum) || threshold.maximum < 0) {
      notes.push('Engine-fork threshold not assessed: missing, unsupported or mismatched component/upstream evidence.'); continue;
    }
    const actual = report[threshold.metric];
    if (!Number.isSafeInteger(actual) || actual < 0) { notes.push('Engine-fork distance was not an exact non-negative count.'); continue; }
    const candidate = make('game-fork-threshold', home.id, `Engine ${component.id} exceeds declared ${threshold.metric} maximum`, profilePath, undefined,
      `${threshold.metric}: ${actual}; declared maximum: ${threshold.maximum}. Git refs already present locally; no fetch.`);
    assessed.add(debtEntryId(candidate));
    if (actual > threshold.maximum) { add(candidate); }
  }
  if (capped) { notes.push('Game debt candidate limit reached; no prior game findings were cleared.'); }
  return { candidates, assessedIds: capped ? [] : [...assessed], notes: [...new Set(notes)].slice(0, 64) };
}

export interface CollectGameDebtInput extends Omit<GameDebtInput, 'inventory' | 'divergence'> {
  confirmed: boolean;
  roots: readonly { componentId: string; fsPath: string }[];
}
/** Called only by the explicit confirmed debt scan. Reuses existing bounded readers. */
export async function collectGameDebt(input: CollectGameDebtInput, runGit: UpstreamDivergenceGitRunner): Promise<GameDebtResult> {
  if (!input.confirmed) { return { candidates: [], assessedIds: [], notes: ['Game scan requires confirmation.'] }; }
  if (!input.profile || !input.composition) { return deriveGameDebt(input); }
  const components = input.composition.components;
  const roots = new Map(input.roots.map(root => [root.componentId, root.fsPath]));
  const targets = components.map(component => ({ component, componentRoot: roots.get(component.id), contentRoots:
    (input.profile?.contentRoots ?? []).filter(root => (root.componentId ?? components.find(c => c.home)?.id) === component.id).map(root => root.location),
  })).filter(target => target.contentRoots.length > 0);
  const inventory = targets.length > 0 ? scanGameAssetInventory({ confirmed: true, targets }) : undefined;
  const divergence: UpstreamDivergenceReport[] = [];
  const ids = [...new Set((input.profile.forkDebtThresholds ?? []).map(t => t.componentId))].slice(0, 8);
  for (const id of ids) {
    const component = components.find(c => c.id === id);
    if (component?.role === 'engine') {
      divergence.push(await collectUpstreamDivergence({ component, repositoryRoot: roots.get(id), observedAt: new Date().toISOString() }, runGit));
    }
  }
  const result = deriveGameDebt({ ...input, inventory, divergence });
  if (new Set((input.profile.forkDebtThresholds ?? []).map(t => t.componentId)).size > 8) {
    result.notes.push('Engine-fork component limit reached; unexamined findings retained.');
  }
  return result;
}
