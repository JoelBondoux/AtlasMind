import * as vscode from 'vscode';
import type { AtlasMindContext } from '../extension.js';

/**
 * Registers the @atlas chat participant with VS Code's Chat API.
 */
export function registerChatParticipant(
  context: vscode.ExtensionContext,
  atlas: AtlasMindContext,
): void {
  const participant = vscode.chat.createChatParticipant(
    'atlasmind.orchestrator',
    (request, chatContext, stream, token) =>
      handleChatRequest(request, chatContext, stream, token, atlas),
  );

  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.svg');

  context.subscriptions.push(participant);
}

async function handleChatRequest(
  request: vscode.ChatRequest,
  _chatContext: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  atlas: AtlasMindContext,
): Promise<void> {
  const command = request.command;

  if (token.isCancellationRequested) {
    return;
  }

  switch (command) {
    case 'bootstrap':
      stream.markdown('🏗️ **Project Bootstrap**\n\nBootstrap flow coming soon…');
      break;

    case 'agents':
      await handleAgentsCommand(stream, atlas);
      break;

    case 'skills':
      await handleSkillsCommand(stream, atlas);
      break;

    case 'memory':
      stream.markdown('🧠 **Memory Query**\n\nMemory search coming soon…');
      break;

    case 'cost':
      await handleCostCommand(stream, atlas);
      break;

    default:
      await handleFreeformMessage(request.prompt, stream, atlas);
      break;
  }
}

async function handleAgentsCommand(
  stream: vscode.ChatResponseStream,
  atlas: AtlasMindContext,
): Promise<void> {
  const agents = atlas.agentRegistry.listAgents();
  if (agents.length === 0) {
    stream.markdown('No agents registered yet. Use the sidebar to add agents.');
    return;
  }
  const lines = agents.map(a => `- **${a.name}** – ${a.role}`);
  stream.markdown(`### Registered Agents\n\n${lines.join('\n')}`);
}

async function handleSkillsCommand(
  stream: vscode.ChatResponseStream,
  atlas: AtlasMindContext,
): Promise<void> {
  const skills = atlas.skillsRegistry.listSkills();
  if (skills.length === 0) {
    stream.markdown('No skills registered yet.');
    return;
  }
  const lines = skills.map(s => `- **${s.name}** – ${s.description}`);
  stream.markdown(`### Registered Skills\n\n${lines.join('\n')}`);
}

async function handleCostCommand(
  stream: vscode.ChatResponseStream,
  atlas: AtlasMindContext,
): Promise<void> {
  const summary = atlas.costTracker.getSummary();
  stream.markdown(
    `### Session Cost Summary\n\n` +
    `| Metric | Value |\n|---|---|\n` +
    `| Total cost | $${summary.totalCostUsd.toFixed(4)} |\n` +
    `| Requests | ${summary.totalRequests} |\n` +
    `| Input tokens | ${summary.totalInputTokens.toLocaleString()} |\n` +
    `| Output tokens | ${summary.totalOutputTokens.toLocaleString()} |`,
  );
}

async function handleFreeformMessage(
  prompt: string,
  stream: vscode.ChatResponseStream,
  _atlas: AtlasMindContext,
): Promise<void> {
  stream.markdown(
    `**AtlasMind received:** "${prompt}"\n\n` +
    `Orchestrator routing is not yet implemented. ` +
    `Try one of the slash commands: /bootstrap, /agents, /skills, /memory, /cost`,
  );
}
