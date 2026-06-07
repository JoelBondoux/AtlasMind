import type { SkillDefinition } from '../types.js';
import { requireString, optionalString } from './validation.js';

export const simpleBrowserSkill: SkillDefinition = {
  id: 'simple-browser',
  name: 'Simple Browser',
  builtIn: true,
  description:
    'Open a URL in the VS Code built-in Simple Browser panel. ' +
    'Supports http and https URLs. ' +
    'Ideal for previewing local dev servers, web apps, dashboards, API docs, or HTML5 games ' +
    'without leaving VS Code.',
  parameters: {
    type: 'object',
    required: ['url'],
    properties: {
      url: {
        type: 'string',
        description: 'The http or https URL to open.',
      },
      title: {
        type: 'string',
        description: 'Optional display title for the browser panel tab.',
      },
    },
  },
  async execute(params, context) {
    const urlErr = requireString(params, 'url');
    if (urlErr) { return urlErr; }
    const titleErr = optionalString(params, 'title');
    if (titleErr) { return titleErr; }

    const url = (params['url'] as string).trim();
    const title = typeof params['title'] === 'string' ? params['title'].trim() : undefined;

    // Validate URL scheme
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return `Error: "${url}" is not a valid URL.`;
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return `Error: Only http and https URLs are supported. Got "${parsed.protocol}".`;
    }

    if (!context.openSimpleBrowser) {
      return 'Simple Browser is not available in this environment (requires VS Code extension host).';
    }

    await context.openSimpleBrowser(url, title);
    return `Opened Simple Browser: ${url}`;
  },
};
