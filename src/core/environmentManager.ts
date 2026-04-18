// EnvironmentManager: Detects, stores, and retrieves user-specific development environment info
// Data is stored in user-private VS Code SecretStorage or user home config, never in workspace

import * as vscode from 'vscode';
import * as os from 'os';
import { UserEnvironment, EnvironmentRecord } from '../types.js';

const ENV_SECRET_KEY = 'atlasmind.userEnvironments';

export class EnvironmentManager {
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  // Detect current environment (OS, hardware, shell, editor)
  async detectCurrentEnvironment(): Promise<UserEnvironment> {
    const shell = vscode.env.shell || process.env.SHELL || process.env.ComSpec || '';
    return {
      os: os.platform(),
      osVersion: os.release(),
      arch: os.arch(),
      cpu: os.cpus()[0]?.model || '',
      ramGB: Math.round(os.totalmem() / 1e9),
      shell,
      editor: 'VSCode',
      editorVersion: vscode.version,
      machineId: vscode.env.machineId,
      location: os.hostname(),
      timestamp: new Date().toISOString(),
      // Add more fields as needed
    };
  }

  // Get all environments for this user
  async getUserEnvironments(): Promise<EnvironmentRecord[]> {
    const raw = await this.context.secrets.get(ENV_SECRET_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  // Add or update the current environment
  async saveCurrentEnvironment(): Promise<void> {
    const env = await this.detectCurrentEnvironment();
    let envs = await this.getUserEnvironments();
    // Use machineId+location as unique key
    const idx = envs.findIndex(e => e.machineId === env.machineId && e.location === env.location);
    if (idx >= 0) {
      envs[idx] = env;
    } else {
      envs.push(env);
    }
    await this.context.secrets.store(ENV_SECRET_KEY, JSON.stringify(envs));
  }

  // Get the best-matching environment for the current session
  async getCurrentEnvironment(): Promise<EnvironmentRecord | undefined> {
    const envs = await this.getUserEnvironments();
    const machineId = vscode.env.machineId;
    const location = os.hostname();
    return envs.find(e => e.machineId === machineId && e.location === location);
  }
}
