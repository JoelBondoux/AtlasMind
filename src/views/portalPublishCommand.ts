/**
 * Build the producer portal and publish it, in one press.
 *
 * Every decision with a rule in it lives in `core/portalPublishPlan.ts`,
 * `core/portalHosting.ts` and `core/producerReportPublication.ts`, all pure and
 * tested. This file gathers the inputs, shows **one** confirmation, and then
 * performs the plan in order.
 *
 * Two properties are worth stating because they are what make collapsing six
 * steps into one press safe rather than reckless.
 *
 * **The confirmation shows the plan's own words.** The disclosure sentence and
 * the command list are composed in the module, so what somebody agrees to is
 * what will actually happen — not a summary written next to it that can drift.
 *
 * **The deploy runs with an argument vector and no shell.** The folder name
 * comes from a setting, and a folder called `x; rm -rf ~` must be a folder name
 * rather than a second command. `execFileAsync` is the same no-shell path
 * `ghClient` and `localCiInstaller` use, for the reason `windowsShimBypass`
 * exists.
 */

import * as vscode from 'vscode';
import {
  buildPortalPublishPlan,
  describePortalPublishCommands,
  type PortalPublishPlan,
} from '../core/portalPublishPlan.js';
import {
  readPortalHostingConfig,
  seedPortalHostingConfig,
  type RepositoryVisibility,
} from '../core/portalHosting.js';
import { execFileAsync } from '../mcp/mcpRuntime.js';

/**
 * Ask GitHub how visible this repository is, now.
 *
 * Asked at the moment it matters rather than cached — the existing publication
 * command makes the same call for the same reason: a repository can be made
 * public between one publication and the next, and a warning is only worth
 * anything if it describes the repository as it is today. An unreadable answer
 * is `unknown`, which every module downstream treats as public.
 */
async function readVisibility(root: string): Promise<RepositoryVisibility> {
  try {
    const { runGhOrThrow } = await import('../core/ghClient.js');
    const raw = (await runGhOrThrow(root, ['repo', 'view', '--json', 'visibility', '-q', '.visibility']))
      .trim()
      .toLowerCase();
    return raw === 'public' ? 'public' : raw === 'private' || raw === 'internal' ? 'private' : 'unknown';
  } catch {
    return 'unknown';
  }
}

function refusalMessage(plan: PortalPublishPlan): string {
  return plan.refusals
    .map(refusal => `${refusal.message}\n\nWhat to change: ${refusal.fix}`)
    .join('\n\n———\n\n');
}

export async function buildAndPublishPortal(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showWarningMessage('Open a workspace folder before publishing the portal.');
    return;
  }
  const root = folder.uri.fsPath;
  const config = vscode.workspace.getConfiguration('atlasmind');
  const ssotPath = config.get<string>('ssotPath', 'project_memory');

  const [
    { decidePublication, buildPublishableReport },
    { renderProducerReportHtml, renderProducerReportMarkdown },
    { PRODUCER_PORTAL_WORKFLOW_PATH },
    fs,
    path,
  ] = await Promise.all([
    import('../core/producerReportPublication.js'),
    import('../core/producerReport.js'),
    import('../core/producerPortalPlan.js'),
    import('node:fs/promises'),
    import('node:path'),
  ]);

  const dataPath = path.join(root, ssotPath, 'operations', 'producer-report.json');
  let report: import('../core/producerReport.js').ProducerReportData | undefined;
  let reportExists = true;
  try {
    report = JSON.parse(await fs.readFile(dataPath, 'utf8')) as import('../core/producerReport.js').ProducerReportData;
  } catch {
    reportExists = false;
  }

  const visibility = await readVisibility(root);
  const decision = decidePublication(
    {
      enabled: config.get<boolean>('producerReport.publishEnabled', false),
      sections: {
        risks: config.get<boolean>('producerReport.publishRisks', false),
        cost: config.get<boolean>('producerReport.publishCost', false),
      },
    },
    visibility,
  );

  const hosting = readPortalHostingConfig(root) ?? seedPortalHostingConfig();
  const siteRelative = `${ssotPath}/operations/producer-site`;
  const workflowPresent = await fs.access(path.join(root, PRODUCER_PORTAL_WORKFLOW_PATH))
    .then(() => true)
    .catch(() => false);

  const director = await readDirectorContacts(root, path, fs);
  const plan = buildPortalPublishPlan({
    hosting,
    visibility,
    contacts: director,
    reportExists,
    publication: {
      publish: decision.publish,
      ...(decision.reason === undefined ? {} : { reason: decision.reason }),
      publishedSections: decision.publishedSections,
      withheldSections: decision.withheldSections,
    },
    siteDir: siteRelative,
    workflowPresent,
  });

  if (!plan.canPublish) {
    // Refusals are shown in full rather than reduced to "cannot publish": the
    // whole value of refusing is that somebody learns which of two things to
    // change.
    void vscode.window.showWarningMessage('The portal was not published.', {
      modal: true,
      detail: refusalMessage(plan),
    });
    return;
  }

  const commands = describePortalPublishCommands(plan);
  const confirmed = await vscode.window.showWarningMessage(
    plan.atlasCanDeploy
      ? `Build and publish the producer portal for ${folder.name}?`
      : `Build the producer portal for ${folder.name}?`,
    {
      modal: true,
      detail: [
        // The plan's own sentence, never a summary of it.
        plan.disclosure,
        '',
        plan.steps.map(step => `${step.actor === 'atlasmind' ? '•' : '›'} ${step.title} — ${step.detail}`).join('\n'),
        commands.length > 0 ? `\nWill run:\n${commands.join('\n')}` : '',
      ].filter(Boolean).join('\n'),
    },
    plan.atlasCanDeploy ? 'Build and publish' : 'Build it',
  );
  if (confirmed === undefined) {
    return;
  }

  const output = vscode.window.createOutputChannel('AtlasMind Portal');
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'AtlasMind: publishing the portal', cancellable: false },
      async progress => {
        if (!reportExists) {
          progress.report({ message: 'gathering the report' });
          await vscode.commands.executeCommand('atlasmind.generateProducerReport');
          report = JSON.parse(await fs.readFile(dataPath, 'utf8')) as import('../core/producerReport.js').ProducerReportData;
        }

        progress.report({ message: 'preparing the page' });
        if (!report) {
          throw new Error('The producer report could not be read after generating it.');
        }
        const publishable = buildPublishableReport(report, decision);
        const siteDir = path.join(root, ssotPath, 'operations', 'producer-site');
        await fs.mkdir(siteDir, { recursive: true });
        await Promise.all([
          fs.writeFile(path.join(siteDir, 'index.html'), renderProducerReportHtml(publishable.data), 'utf8'),
          fs.writeFile(path.join(siteDir, 'index.md'), renderProducerReportMarkdown(publishable.data), 'utf8'),
          fs.writeFile(path.join(siteDir, 'producer-report.json'), `${JSON.stringify(publishable.data, null, 2)}\n`, 'utf8'),
        ]);

        const deploy = plan.steps.find(step => step.command !== undefined);
        if (!deploy?.command) {
          return;
        }
        progress.report({ message: `publishing to ${hosting.host}` });
        output.appendLine(`$ ${deploy.command.file} ${deploy.command.args.join(' ')}`);
        // Argv, no shell: the folder name is a folder name even when it looks
        // like a command.
        const result = await execFileAsync(deploy.command.file, [...deploy.command.args]);
        output.appendLine(result.stdout);
        if (result.stderr) {
          output.appendLine(result.stderr);
        }
      },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    output.appendLine(detail);
    output.show(true);
    void vscode.window.showErrorMessage(
      `The portal was prepared but publishing failed: ${detail.slice(0, 300)}`,
    );
    return;
  }

  if (plan.atlasCanDeploy) {
    void vscode.window.showInformationMessage(
      'Portal published. Open it in a private window and confirm somebody outside the audience is refused — AtlasMind cannot check that for you.',
      'Show output',
    ).then(choice => {
      if (choice === 'Show output') {
        output.show(true);
      }
    });
    return;
  }

  void vscode.window.showInformationMessage(
    `Portal prepared in ${siteRelative}. AtlasMind has no deploy command for this host, so publishing it is yours to do.`,
  );
}

/**
 * The Director roster, read straight from its file.
 *
 * Only the contacts are wanted, and only so the audience can be resolved to
 * names for the disclosure. A failure here means an empty roster, which reports
 * the audience as unresolvable rather than pretending nobody was named.
 */
async function readDirectorContacts(
  root: string,
  path: typeof import('node:path'),
  fs: typeof import('node:fs/promises'),
): Promise<Array<import('../types.js').DirectorContact>> {
  try {
    const raw = await fs.readFile(
      path.join(root, 'project_memory', 'operations', 'project-director.json'),
      'utf8',
    );
    const parsed = JSON.parse(raw) as { contacts?: unknown };
    return Array.isArray(parsed.contacts)
      ? parsed.contacts as Array<import('../types.js').DirectorContact>
      : [];
  } catch {
    return [];
  }
}
