import * as vscode from 'vscode';
import { registerChatParticipant } from './chat/participant.js';
import { registerCommands } from './commands.js';
import { registerTreeViews } from './views/treeViews.js';
import { Orchestrator } from './core/orchestrator.js';
import { AgentRegistry } from './core/agentRegistry.js';
import { SkillsRegistry } from './core/skillsRegistry.js';
import { ModelRouter } from './core/modelRouter.js';
import { MemoryManager } from './memory/memoryManager.js';
import { CostTracker } from './core/costTracker.js';

export interface AtlasMindContext {
  orchestrator: Orchestrator;
  agentRegistry: AgentRegistry;
  skillsRegistry: SkillsRegistry;
  modelRouter: ModelRouter;
  memoryManager: MemoryManager;
  costTracker: CostTracker;
}

let atlasContext: AtlasMindContext | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel('AtlasMind');
  outputChannel.appendLine('AtlasMind activating…');

  // ── Core services ──────────────────────────────────────────
  const costTracker = new CostTracker();
  const agentRegistry = new AgentRegistry();
  const skillsRegistry = new SkillsRegistry();
  const modelRouter = new ModelRouter();
  const memoryManager = new MemoryManager();
  const orchestrator = new Orchestrator(
    agentRegistry,
    skillsRegistry,
    modelRouter,
    memoryManager,
    costTracker,
  );

  atlasContext = {
    orchestrator,
    agentRegistry,
    skillsRegistry,
    modelRouter,
    memoryManager,
    costTracker,
  };

  // ── Registrations ──────────────────────────────────────────
  registerChatParticipant(context, atlasContext);
  registerCommands(context, atlasContext);
  registerTreeViews(context, atlasContext);

  outputChannel.appendLine('AtlasMind activated ✓');
}

export function deactivate(): void {
  atlasContext = undefined;
}
