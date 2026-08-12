import type { ArdDiscoveryEndpoint } from './types.js';

// ── Recommended MCP Servers ─────────────────────────────────────────────

export type RecommendedMcpServerProvenance = 'official' | 'community' | 'registry' | 'archived';
export type RecommendedMcpSetupMode = 'prefill' | 'manual';

/** Browsable groupings for the guided setup wizard's "Browse by category" view. */
export type RecommendedMcpCategory =
	| 'Core'
	| 'Cloud'
	| 'Databases'
	| 'DevOps'
	| 'Messaging'
	| 'Collaboration'
	| 'Commerce & Social'
	| 'Design';

export interface RecommendedMcpServer {
	id: string;
	name: string;
	description: string;
	installUrl: string;
	docsUrl: string;
	provenance: RecommendedMcpServerProvenance;
	category: RecommendedMcpCategory;
}

/**
 * A single value the guided wizard collects for a recommended server before
 * connecting. `kind: 'secret'` values are written to VS Code SecretStorage and
 * exposed only as an env var at connect time; everything else is stored with
 * the server config (env var or a substituted arg placeholder).
 */
export interface RecommendedMcpInput {
	/** Env var name (target 'env') or the arg placeholder token (target 'arg'). */
	key: string;
	label: string;
	help?: string;
	kind: 'text' | 'secret' | 'folder' | 'url';
	target: 'env' | 'arg';
	/** For target 'arg': the exact token in `args` to replace, e.g. '<DATABASE_URL>'. */
	placeholder?: string;
	/** Default value shown in the field (e.g. '${workspaceFolder}' for a folder). */
	defaultValue?: string;
	/** A realistic example value shown as the field's greyed placeholder (handholding). */
	example?: string;
	required?: boolean;
}

export type RecommendedRuntimePackageManager = 'winget' | 'brew' | 'apt-get' | 'dnf' | 'pacman';
export type SupportedRuntimePlatform = 'win32' | 'darwin' | 'linux';

export interface RecommendedMcpRuntimeInstall {
	packageManager: RecommendedRuntimePackageManager;
	packageId: string;
	displayName: string;
	extraPackages?: string[];
}

export interface RecommendedMcpStarterDetails {
	setupMode: RecommendedMcpSetupMode;
	transport: 'stdio' | 'http';
	command?: string;
	args?: string[];
	/** Fixed, non-secret env values/templates supplied by the audited starter. */
	env?: Record<string, string>;
	url?: string;
	note: string;
	runtimeInstalls?: Partial<Record<SupportedRuntimePlatform, RecommendedMcpRuntimeInstall[]>>;
	/** Values the guided wizard collects (credentials, folders, connection URLs). */
	inputs?: RecommendedMcpInput[];
	/**
	 * Novice-facing handholding content for the guided-setup wizard. Populated for
	 * servers that need credentials or manual review so the wizard can render a
	 * "what you'll need" checklist, a step-by-step credential how-to, a direct
	 * link to the exact console page, and any safety caveat — instead of dropping
	 * the user into a blank Advanced form.
	 */
	/** "What you'll need" bullets shown before the form (accounts, plans, runtimes). */
	prerequisites?: string[];
	/** Ordered, numbered how-to for obtaining the credential(s). */
	credentialSteps?: string[];
	/** Deep link to the exact credential/token creation page. */
	credentialHelpUrl?: string;
	/** Amber caveat rendered as a callout (telemetry, real spend, beta, third-party trust). */
	safetyNote?: string;
}

// Shared runtime-install sets, reused across recommended starters.
const NODE_RUNTIME_INSTALLS: Partial<Record<SupportedRuntimePlatform, RecommendedMcpRuntimeInstall[]>> = {
	win32: [{ packageManager: 'winget', packageId: 'OpenJS.NodeJS.LTS', displayName: 'Node.js LTS' }],
	darwin: [{ packageManager: 'brew', packageId: 'node', displayName: 'Node.js' }],
	linux: [
		{ packageManager: 'brew', packageId: 'node', displayName: 'Node.js' },
		{ packageManager: 'apt-get', packageId: 'nodejs', extraPackages: ['npm'], displayName: 'Node.js and npm' },
		{ packageManager: 'dnf', packageId: 'nodejs', extraPackages: ['npm'], displayName: 'Node.js and npm' },
		{ packageManager: 'pacman', packageId: 'nodejs', extraPackages: ['npm'], displayName: 'Node.js and npm' },
	],
};

const UV_RUNTIME_INSTALLS: Partial<Record<SupportedRuntimePlatform, RecommendedMcpRuntimeInstall[]>> = {
	win32: [{ packageManager: 'winget', packageId: 'astral-sh.uv', displayName: 'uv' }],
	darwin: [{ packageManager: 'brew', packageId: 'uv', displayName: 'uv' }],
	linux: [
		{ packageManager: 'brew', packageId: 'uv', displayName: 'uv' },
		{ packageManager: 'apt-get', packageId: 'uv', displayName: 'uv' },
		{ packageManager: 'dnf', packageId: 'uv', displayName: 'uv' },
		{ packageManager: 'pacman', packageId: 'uv', displayName: 'uv' },
	],
};

const DOCKER_RUNTIME_INSTALLS: Partial<Record<SupportedRuntimePlatform, RecommendedMcpRuntimeInstall[]>> = {
	win32: [{ packageManager: 'winget', packageId: 'Docker.DockerDesktop', displayName: 'Docker Desktop' }],
	darwin: [{ packageManager: 'brew', packageId: 'docker', displayName: 'Docker Desktop' }],
	linux: [
		{ packageManager: 'apt-get', packageId: 'docker.io', displayName: 'Docker Engine' },
		{ packageManager: 'dnf', packageId: 'docker', displayName: 'Docker Engine' },
		{ packageManager: 'pacman', packageId: 'docker', displayName: 'Docker Engine' },
	],
};

const MCP_REGISTRY_URL = 'https://registry.modelcontextprotocol.io/';

function inferRecommendedMcpServerProvenance(server: Omit<RecommendedMcpServer, 'provenance' | 'category'>): RecommendedMcpServerProvenance {
	const installUrl = server.installUrl.toLowerCase();
	const docsUrl = server.docsUrl.toLowerCase();
	const combined = `${installUrl} ${docsUrl}`;

	if (combined.includes('servers-archived')) {
		return 'archived';
	}

	if (installUrl === MCP_REGISTRY_URL || docsUrl === MCP_REGISTRY_URL) {
		return 'registry';
	}

	if (
		combined.includes('learn.microsoft.com')
		|| combined.includes('modelcontextprotocol.io')
		|| combined.includes('github.com/modelcontextprotocol/servers')
		|| combined.includes('github.com/github/github-mcp-server')
		|| combined.includes('github.com/block/buzz')
		|| combined.includes('npmjs.com/package/@azure/mcp')
	) {
		return 'official';
	}

	return 'community';
}

/** Maps a recommended server id to its browsable category (mirrors the catalogue's section grouping). */
const RECOMMENDED_MCP_CATEGORY_BY_ID: Record<string, RecommendedMcpCategory> = {
	'mcp-server-filesystem': 'Core',
	'mcp-server-git': 'Core',
	'mcp-server-work-timer': 'Core',
	'mcp-server-openai': 'Core',
	'mcp-server-azure': 'Cloud',
	'mcp-server-aws': 'Cloud',
	'mcp-server-gcp': 'Cloud',
	'mcp-server-cloudflare': 'Cloud',
	'mcp-server-cloudflare-workers': 'Cloud',
	'mcp-server-m365': 'Cloud',
	'mcp-server-entra': 'Cloud',
	'mcp-server-powerplatform': 'Cloud',
	'mcp-server-appledev': 'Cloud',
	'mcp-server-apns': 'Cloud',
	'mcp-server-mysql': 'Databases',
	'mcp-server-postgres': 'Databases',
	'mcp-server-mongodb': 'Databases',
	'mcp-server-elasticsearch': 'Databases',
	'mcp-server-rabbitmq': 'Messaging',
	'mcp-server-sqs': 'Messaging',
	'mcp-server-twilio': 'Messaging',
	'mcp-server-sendgrid': 'Messaging',
	'mcp-server-jenkins': 'DevOps',
	'mcp-server-circleci': 'DevOps',
	'mcp-server-gitkraken': 'DevOps',
	'mcp-server-github': 'DevOps',
	'mcp-server-grafana': 'DevOps',
	'mcp-server-prometheus': 'DevOps',
	'mcp-server-sentry': 'DevOps',
	'mcp-server-jira': 'Collaboration',
	'mcp-server-buzz': 'Collaboration',
	'mcp-server-slack': 'Collaboration',
	'mcp-server-trello': 'Collaboration',
	'mcp-server-contrast-checker': 'Design',
	'mcp-server-stripe': 'Commerce & Social',
	'mcp-server-shopify': 'Commerce & Social',
	'mcp-server-woocommerce': 'Commerce & Social',
	'mcp-server-wordpress': 'Commerce & Social',
	'mcp-server-webflow': 'Commerce & Social',
	'mcp-server-wix': 'Commerce & Social',
	'mcp-server-youtube': 'Commerce & Social',
	'mcp-server-twitch': 'Commerce & Social',
	'mcp-server-linkedin': 'Commerce & Social',
	'mcp-server-meta': 'Commerce & Social',
	'mcp-server-x': 'Commerce & Social',
};

function inferRecommendedMcpServerCategory(id: string): RecommendedMcpCategory {
	return RECOMMENDED_MCP_CATEGORY_BY_ID[id] ?? 'Core';
}

/**
 * Recommended MCP servers for software developers. Used in the Settings Dashboard catalogue.
 * Each entry uses a verified working documentation page or the official MCP registry/catalogue as a safe fallback.
 */
const RECOMMENDED_MCP_SERVER_CATALOGUE: Array<Omit<RecommendedMcpServer, 'provenance' | 'category'>> = [
	// Core developer and infra servers
	{
		id: 'mcp-server-filesystem',
		name: 'Filesystem MCP Server',
		description: 'A local MCP server for file and directory operations, ideal for development and testing workflows. Provides file read/write, directory listing, and basic project automation tools.',
		installUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
		docsUrl: 'https://modelcontextprotocol.io/examples',
	},
	{
		id: 'mcp-server-git',
		name: 'Git MCP Server',
		description: 'MCP server for interacting with Git repositories. Enables version control operations, commit history, and branch management via MCP tools.',
		installUrl: 'https://pypi.org/project/mcp-server-git/',
		docsUrl: 'https://modelcontextprotocol.io/examples',
	},
	{
		id: 'mcp-server-work-timer',
		name: 'Work-Timer MCP Server',
		description: 'Track timers, billing, invoicing, exports, and freelancer work sessions through the Work-Timer MCP toolset.',
		installUrl: 'https://github.com/JoelBondoux/Work-Timer',
		docsUrl: 'https://github.com/JoelBondoux/Work-Timer/blob/master/docs/setup.md',
	},
	{
		id: 'mcp-server-azure',
		name: 'Azure MCP Server',
		description: 'Connects AtlasMind to Azure resources and services using the Model Context Protocol. Supports resource management, deployment, and cost analysis.',
		installUrl: 'https://www.npmjs.com/package/@azure/mcp',
		docsUrl: 'https://learn.microsoft.com/azure/developer/azure-mcp-server/overview',
	},
	{
		id: 'mcp-server-openai',
		name: 'OpenAI MCP Server',
		description: 'Proxy MCP server for OpenAI-compatible LLMs. Route model requests, manage completions, and integrate with local or cloud LLM endpoints.',
		installUrl: 'https://registry.modelcontextprotocol.io/',
		docsUrl: 'https://registry.modelcontextprotocol.io/',
	},
	// Design & accessibility
	{
		id: 'mcp-server-contrast-checker',
		name: 'WCAG Contrast Checker MCP Server',
		description: 'Check colour contrast ratios against WCAG 2.1/2.2 AA and AAA thresholds, parse colours across formats (hex, rgb, hsl, named), and get accessible colour suggestions — useful for UI, theming, and frontend accessibility work.',
		installUrl: 'https://www.npmjs.com/package/contrast-checker-mcp',
		docsUrl: 'https://github.com/ogSINGH/contrast-checker-mcp#readme',
	},
	// Major cloud providers
	{
		id: 'mcp-server-aws',
		name: 'AWS MCP Server',
		description: 'Manage AWS resources (EC2, S3, Lambda, IAM, CloudWatch, and more) via MCP tools.',
		installUrl: 'https://registry.modelcontextprotocol.io/',
		docsUrl: 'https://registry.modelcontextprotocol.io/',
	},
	{
		id: 'mcp-server-gcp',
		name: 'Google Cloud MCP Server',
		description: 'Manage Google Cloud Platform resources (Compute Engine, Cloud Storage, BigQuery, IAM, etc.) via MCP.',
		installUrl: 'https://registry.modelcontextprotocol.io/',
		docsUrl: 'https://registry.modelcontextprotocol.io/',
	},
	// Microsoft ecosystem
	{
		id: 'mcp-server-m365',
		name: 'Microsoft 365 MCP Server',
		description: 'Automate Teams, Outlook, SharePoint, and OneDrive workflows.',
		installUrl: 'https://learn.microsoft.com/en-us/connectors/connector-reference/connector-reference-mcpserver-connectors',
		docsUrl: 'https://learn.microsoft.com/en-us/connectors/connector-reference/connector-reference-mcpserver-connectors',
	},
	{
		id: 'mcp-server-entra',
		name: 'Entra ID MCP Server',
		description: 'Manage Microsoft Entra ID (Azure AD) for identity, authentication, and RBAC.',
		installUrl: 'https://learn.microsoft.com/graph/mcp-server/use-enterprise-mcp-server-microsoft-foundry',
		docsUrl: 'https://learn.microsoft.com/graph/mcp-server/get-started',
	},
	{
		id: 'mcp-server-powerplatform',
		name: 'Power Platform MCP Server',
		description: 'Integrate Power Automate, Power Apps, and Power BI with AtlasMind.',
		installUrl: 'https://learn.microsoft.com/power-platform/developer/howto/use-mcp',
		docsUrl: 'https://learn.microsoft.com/power-platform/developer/howto/use-mcp',
	},
	// Apple
	{
		id: 'mcp-server-appledev',
		name: 'Apple Developer MCP Server',
		description: 'Automate App Store Connect, TestFlight, and certificate management.',
		installUrl: 'https://registry.modelcontextprotocol.io/',
		docsUrl: 'https://registry.modelcontextprotocol.io/',
	},
	{
		id: 'mcp-server-apns',
		name: 'Apple Push Notification MCP Server',
		description: 'Integrate with Apple Push Notification Service (APNs) for device and notification management.',
		installUrl: 'https://registry.modelcontextprotocol.io/',
		docsUrl: 'https://registry.modelcontextprotocol.io/',
	},
	// Cloudflare
	{
		id: 'mcp-server-cloudflare',
		name: 'Cloudflare MCP Server',
		description: 'Manage DNS, CDN, DDoS protection, firewall, and Zero Trust with Cloudflare.',
		installUrl: 'https://registry.modelcontextprotocol.io/',
		docsUrl: 'https://registry.modelcontextprotocol.io/',
	},
	{
		id: 'mcp-server-cloudflare-workers',
		name: 'Cloudflare Workers MCP Server',
		description: 'Automate serverless edge compute and Cloudflare Workers deployments.',
		installUrl: 'https://registry.modelcontextprotocol.io/',
		docsUrl: 'https://registry.modelcontextprotocol.io/',
	},
	// Databases
	{
		id: 'mcp-server-mysql',
		name: 'MySQL MCP Server',
		description: 'Manage MySQL databases, queries, and migrations.',
		installUrl: 'https://registry.modelcontextprotocol.io/',
		docsUrl: 'https://registry.modelcontextprotocol.io/',
	},
	{
		id: 'mcp-server-postgres',
		name: 'PostgreSQL MCP Server',
		description: 'Manage PostgreSQL databases, queries, and schema migrations.',
		installUrl: 'https://github.com/modelcontextprotocol/servers-archived/tree/main/src/postgres',
		docsUrl: 'https://github.com/modelcontextprotocol/servers-archived/tree/main/src/postgres',
	},
	{
		id: 'mcp-server-mongodb',
		name: 'MongoDB MCP Server',
		description: 'Manage MongoDB NoSQL databases and collections.',
		installUrl: 'https://registry.modelcontextprotocol.io/',
		docsUrl: 'https://registry.modelcontextprotocol.io/',
	},
	{
		id: 'mcp-server-elasticsearch',
		name: 'Elasticsearch MCP Server',
		description: 'Manage Elasticsearch clusters, indices, and analytics.',
		installUrl: 'https://registry.modelcontextprotocol.io/',
		docsUrl: 'https://registry.modelcontextprotocol.io/',
	},
	// Messaging/queues
	{
		id: 'mcp-server-rabbitmq',
		name: 'RabbitMQ MCP Server',
		description: 'Manage RabbitMQ message queues and exchanges.',
		installUrl: 'https://registry.modelcontextprotocol.io/',
		docsUrl: 'https://registry.modelcontextprotocol.io/',
	},
	{
		id: 'mcp-server-sqs',
		name: 'Amazon SQS MCP Server',
		description: 'Manage Amazon SQS queues and messaging.',
		installUrl: 'https://registry.modelcontextprotocol.io/',
		docsUrl: 'https://registry.modelcontextprotocol.io/',
	},
	// CI/CD & DevOps
	{
		id: 'mcp-server-jenkins',
		name: 'Jenkins MCP Server',
		description: 'Automate Jenkins jobs, pipelines, and build management.',
		installUrl: 'https://registry.modelcontextprotocol.io/',
		docsUrl: 'https://registry.modelcontextprotocol.io/',
	},
	{
		id: 'mcp-server-circleci',
		name: 'CircleCI MCP Server',
		description: 'Integrate and automate CircleCI pipelines and builds.',
		installUrl: 'https://registry.modelcontextprotocol.io/',
		docsUrl: 'https://registry.modelcontextprotocol.io/',
	},
	// Project management & collaboration
	{
		id: 'mcp-server-gitkraken',
		name: 'GitKraken MCP Server',
		description: 'Integrate GitKraken for advanced Git GUI, repo management, and team collaboration workflows via MCP.',
		installUrl: 'https://github.com/gitkraken/gk-cli/releases',
		docsUrl: 'https://github.com/gitkraken/gk-cli',
	},
	{
		id: 'mcp-server-jira',
		name: 'Jira MCP Server',
		description: 'Automate Jira issue tracking, project management, and workflows.',
		installUrl: 'https://registry.modelcontextprotocol.io/',
		docsUrl: 'https://registry.modelcontextprotocol.io/',
	},
	{
		id: 'mcp-server-github',
		name: 'GitHub MCP Server',
		description: 'Manage GitHub repositories, pull requests, issues, and CI/CD.',
		installUrl: 'https://github.com/github/github-mcp-server',
		docsUrl: 'https://github.com/github/github-mcp-server',
	},
	{
		id: 'mcp-server-slack',
		name: 'Slack MCP Server',
		description: 'Integrate Slack messaging, notifications, and workflow triggers.',
		installUrl: 'https://github.com/zencoderai/slack-mcp-server',
		docsUrl: 'https://github.com/zencoderai/slack-mcp-server',
	},
	{
		id: 'mcp-server-buzz',
		name: 'Buzz Communications',
		description: 'Connect AtlasMind Project Director to Buzz channels, threads, and DMs through a bundled, communication-only bridge around the official pinned Buzz CLI.',
		installUrl: 'https://github.com/block/buzz/releases/tag/v0.4.26',
		docsUrl: 'https://github.com/block/buzz/blob/v0.4.26/crates/buzz-cli/TESTING.md',
	},
	{
		id: 'mcp-server-trello',
		name: 'Trello MCP Server',
		description: 'Automate Trello boards, cards, and task management.',
		installUrl: 'https://registry.modelcontextprotocol.io/',
		docsUrl: 'https://registry.modelcontextprotocol.io/',
	},
	// Monitoring & observability
	{
		id: 'mcp-server-grafana',
		name: 'Grafana MCP Server',
		description: 'Integrate Grafana dashboards and observability workflows.',
		installUrl: 'https://registry.modelcontextprotocol.io/',
		docsUrl: 'https://registry.modelcontextprotocol.io/',
	},
	{
		id: 'mcp-server-prometheus',
		name: 'Prometheus MCP Server',
		description: 'Integrate Prometheus metrics collection and alerting.',
		installUrl: 'https://registry.modelcontextprotocol.io/',
		docsUrl: 'https://registry.modelcontextprotocol.io/',
	},
	{
		id: 'mcp-server-sentry',
		name: 'Sentry MCP Server',
		description: 'Integrate Sentry error tracking and monitoring.',
		installUrl: 'https://github.com/modelcontextprotocol/servers-archived/tree/main/src/sentry',
		docsUrl: 'https://github.com/modelcontextprotocol/servers-archived/tree/main/src/sentry',
	},
	// Communication & notifications
	{
		id: 'mcp-server-twilio',
		name: 'Twilio MCP Server',
		description: 'Automate SMS, voice, and communication workflows with Twilio.',
		installUrl: 'https://registry.modelcontextprotocol.io/',
		docsUrl: 'https://registry.modelcontextprotocol.io/',
	},
	{
		id: 'mcp-server-sendgrid',
		name: 'SendGrid MCP Server',
		description: 'Automate transactional email and notifications with SendGrid.',
		installUrl: 'https://registry.modelcontextprotocol.io/',
		docsUrl: 'https://registry.modelcontextprotocol.io/',
	},
	// Payments & finance
	{
		id: 'mcp-server-stripe',
		name: 'Stripe MCP Server',
		description: 'Integrate Stripe for payment processing and financial automation.',
		installUrl: 'https://registry.modelcontextprotocol.io/',
		docsUrl: 'https://registry.modelcontextprotocol.io/',
	},
	// Commerce, CMS, creator platforms, and social media
	{
		id: 'mcp-server-shopify',
		name: 'Shopify MCP Server',
		description: 'Connect storefront, catalog, order, and fulfillment workflows for Shopify-based ecommerce operations.',
		installUrl: 'https://registry.modelcontextprotocol.io/',
		docsUrl: 'https://shopify.dev/docs/api',
	},
	{
		id: 'mcp-server-woocommerce',
		name: 'WooCommerce MCP Server',
		description: 'Automate WooCommerce shops, products, orders, and customer operations for WordPress-based stores.',
		installUrl: 'https://registry.modelcontextprotocol.io/',
		docsUrl: 'https://woocommerce.github.io/woocommerce-rest-api-docs/',
	},
	{
		id: 'mcp-server-wordpress',
		name: 'WordPress MCP Server',
		description: 'Work with posts, pages, media libraries, and publishing flows for WordPress sites and blogs.',
		installUrl: 'https://registry.modelcontextprotocol.io/',
		docsUrl: 'https://developer.wordpress.org/rest-api/',
	},
	{
		id: 'mcp-server-webflow',
		name: 'Webflow MCP Server',
		description: 'Manage CMS collections, staged content, and site publishing workflows for Webflow projects.',
		installUrl: 'https://registry.modelcontextprotocol.io/',
		docsUrl: 'https://developers.webflow.com/',
	},
	{
		id: 'mcp-server-wix',
		name: 'Wix MCP Server',
		description: 'Integrate Wix site management, content operations, and business app workflows via MCP.',
		installUrl: 'https://registry.modelcontextprotocol.io/',
		docsUrl: 'https://dev.wix.com/docs/',
	},
	{
		id: 'mcp-server-youtube',
		name: 'YouTube MCP Server',
		description: 'Access channel, upload, playlist, analytics, and publishing workflows for YouTube creator operations.',
		installUrl: 'https://registry.modelcontextprotocol.io/',
		docsUrl: 'https://developers.google.com/youtube/v3',
	},
	{
		id: 'mcp-server-twitch',
		name: 'Twitch MCP Server',
		description: 'Connect stream management, moderation, clips, and community workflows for Twitch channels.',
		installUrl: 'https://registry.modelcontextprotocol.io/',
		docsUrl: 'https://dev.twitch.tv/docs/api/',
	},
	{
		id: 'mcp-server-linkedin',
		name: 'LinkedIn MCP Server',
		description: 'Automate LinkedIn organization posting, profile publishing, and business workflow integrations.',
		installUrl: 'https://registry.modelcontextprotocol.io/',
		docsUrl: 'https://learn.microsoft.com/linkedin/',
	},
	{
		id: 'mcp-server-meta',
		name: 'Meta Graph MCP Server',
		description: 'Integrate Facebook and Instagram business workflows using the Meta Graph platform and related APIs.',
		installUrl: 'https://registry.modelcontextprotocol.io/',
		docsUrl: 'https://developers.facebook.com/docs/graph-api/',
	},
	{
		id: 'mcp-server-x',
		name: 'X / Twitter MCP Server',
		description: 'Connect posting, timeline, and moderation workflows for X-based social publishing and monitoring.',
		installUrl: 'https://registry.modelcontextprotocol.io/',
		docsUrl: 'https://developer.x.com/en/docs',
	},
];

export const RECOMMENDED_MCP_SERVERS: RecommendedMcpServer[] = RECOMMENDED_MCP_SERVER_CATALOGUE.map(server => ({
	...server,
	provenance: inferRecommendedMcpServerProvenance(server),
	category: inferRecommendedMcpServerCategory(server.id),
}));

export function getRecommendedMcpStarterDetails(serverId: string): RecommendedMcpStarterDetails {
	switch (serverId) {
		case 'mcp-server-filesystem':
			return {
				setupMode: 'prefill',
				transport: 'stdio',
				command: 'npx',
				args: ['-y', '@modelcontextprotocol/server-filesystem', '${workspaceFolder}'],
				note: 'Verified local filesystem server. AtlasMind scopes it to the current workspace by default.',
				inputs: [
					{
						key: '${workspaceFolder}',
						label: 'Folder to expose',
						help: 'The server can only read and write inside this folder. Defaults to your current workspace.',
						kind: 'folder',
						target: 'arg',
						placeholder: '${workspaceFolder}',
						defaultValue: '${workspaceFolder}',
						required: false,
					},
				],
				runtimeInstalls: {
					win32: [{ packageManager: 'winget', packageId: 'OpenJS.NodeJS.LTS', displayName: 'Node.js LTS' }],
					darwin: [{ packageManager: 'brew', packageId: 'node', displayName: 'Node.js' }],
					linux: [
						{ packageManager: 'brew', packageId: 'node', displayName: 'Node.js' },
						{ packageManager: 'apt-get', packageId: 'nodejs', extraPackages: ['npm'], displayName: 'Node.js and npm' },
						{ packageManager: 'dnf', packageId: 'nodejs', extraPackages: ['npm'], displayName: 'Node.js and npm' },
						{ packageManager: 'pacman', packageId: 'nodejs', extraPackages: ['npm'], displayName: 'Node.js and npm' },
					],
				},
			};
		case 'mcp-server-git':
			return {
				setupMode: 'prefill',
				transport: 'stdio',
				command: 'uvx',
				args: ['mcp-server-git'],
				note: 'Verified git server. Requires the uv / uvx runtime to be installed locally.',
				runtimeInstalls: {
					win32: [{ packageManager: 'winget', packageId: 'astral-sh.uv', displayName: 'uv' }],
					darwin: [{ packageManager: 'brew', packageId: 'uv', displayName: 'uv' }],
					linux: [
						{ packageManager: 'brew', packageId: 'uv', displayName: 'uv' },
						{ packageManager: 'apt-get', packageId: 'uv', displayName: 'uv' },
						{ packageManager: 'dnf', packageId: 'uv', displayName: 'uv' },
						{ packageManager: 'pacman', packageId: 'uv', displayName: 'uv' },
					],
				},
			};
		case 'mcp-server-work-timer':
			return {
				setupMode: 'prefill',
				transport: 'stdio',
				command: 'node',
				args: ['${userHome}/Work-Timer/dist/mcp/server.js'],
				note: 'Verified Work-Timer MCP launch path from the upstream setup guide. Run the Work-Timer installer first so the repo is available under your home directory, then AtlasMind can connect directly.',
				runtimeInstalls: {
					win32: [{ packageManager: 'winget', packageId: 'OpenJS.NodeJS.LTS', displayName: 'Node.js LTS' }],
					darwin: [{ packageManager: 'brew', packageId: 'node', displayName: 'Node.js' }],
					linux: [
						{ packageManager: 'brew', packageId: 'node', displayName: 'Node.js' },
						{ packageManager: 'apt-get', packageId: 'nodejs', extraPackages: ['npm'], displayName: 'Node.js and npm' },
						{ packageManager: 'dnf', packageId: 'nodejs', extraPackages: ['npm'], displayName: 'Node.js and npm' },
						{ packageManager: 'pacman', packageId: 'nodejs', extraPackages: ['npm'], displayName: 'Node.js and npm' },
					],
				},
			};
		case 'mcp-server-azure':
			return {
				setupMode: 'prefill',
				transport: 'stdio',
				command: 'npx',
				args: ['-y', '@azure/mcp@latest', 'server', 'start'],
				note: 'Verified Azure MCP launch command. Requires Node.js plus Azure authentication in your local environment.',
				runtimeInstalls: {
					win32: [{ packageManager: 'winget', packageId: 'OpenJS.NodeJS.LTS', displayName: 'Node.js LTS' }],
					darwin: [{ packageManager: 'brew', packageId: 'node', displayName: 'Node.js' }],
					linux: [
						{ packageManager: 'brew', packageId: 'node', displayName: 'Node.js' },
						{ packageManager: 'apt-get', packageId: 'nodejs', extraPackages: ['npm'], displayName: 'Node.js and npm' },
						{ packageManager: 'dnf', packageId: 'nodejs', extraPackages: ['npm'], displayName: 'Node.js and npm' },
						{ packageManager: 'pacman', packageId: 'nodejs', extraPackages: ['npm'], displayName: 'Node.js and npm' },
					],
				},
			};
		case 'mcp-server-powerplatform':
			return {
				setupMode: 'prefill',
				transport: 'stdio',
				command: 'dnx',
				args: ['Microsoft.PowerApps.CLI.Tool', '--yes', 'copilot', 'mcp', '--run'],
				note: 'Verified Power Platform MCP launch command. Requires .NET 10 or later.',
				runtimeInstalls: {
					win32: [{ packageManager: 'winget', packageId: 'Microsoft.DotNet.SDK.10', displayName: '.NET SDK 10' }],
					darwin: [{ packageManager: 'brew', packageId: 'dotnet', displayName: '.NET SDK' }],
					linux: [
						{ packageManager: 'apt-get', packageId: 'dotnet-sdk-10.0', displayName: '.NET SDK 10' },
						{ packageManager: 'dnf', packageId: 'dotnet-sdk-10.0', displayName: '.NET SDK 10' },
						{ packageManager: 'pacman', packageId: 'dotnet-sdk', displayName: '.NET SDK' },
						{ packageManager: 'brew', packageId: 'dotnet', displayName: '.NET SDK' },
					],
				},
			};
		case 'mcp-server-gitkraken':
			return {
				setupMode: 'prefill',
				transport: 'stdio',
				command: 'gk',
				args: ['mcp'],
				note: 'Verified GitKraken MCP CLI command. Install GitKraken CLI first and run gk auth login.',
				runtimeInstalls: {
					win32: [{ packageManager: 'winget', packageId: 'GitKraken.cli', displayName: 'GitKraken CLI' }],
					darwin: [{ packageManager: 'brew', packageId: 'gitkraken-cli', displayName: 'GitKraken CLI' }],
					linux: [{ packageManager: 'brew', packageId: 'gitkraken-cli', displayName: 'GitKraken CLI' }],
				},
			};
		case 'mcp-server-contrast-checker':
			return {
				setupMode: 'prefill',
				transport: 'stdio',
				command: 'npx',
				args: ['-y', 'contrast-checker-mcp'],
				note: 'Verified npm launch command (npx -y contrast-checker-mcp). Requires Node.js. If your environment uses a custom corporate CA, add {"NODE_OPTIONS":"--use-system-ca"} in the Env vars (JSON) field before saving.',
				runtimeInstalls: {
					win32: [{ packageManager: 'winget', packageId: 'OpenJS.NodeJS.LTS', displayName: 'Node.js LTS' }],
					darwin: [{ packageManager: 'brew', packageId: 'node', displayName: 'Node.js' }],
					linux: [
						{ packageManager: 'brew', packageId: 'node', displayName: 'Node.js' },
						{ packageManager: 'apt-get', packageId: 'nodejs', extraPackages: ['npm'], displayName: 'Node.js and npm' },
						{ packageManager: 'dnf', packageId: 'nodejs', extraPackages: ['npm'], displayName: 'Node.js and npm' },
						{ packageManager: 'pacman', packageId: 'nodejs', extraPackages: ['npm'], displayName: 'Node.js and npm' },
					],
				},
			};
		case 'mcp-server-postgres':
			return {
				setupMode: 'prefill',
				transport: 'stdio',
				command: 'npx',
				args: ['-y', '@modelcontextprotocol/server-postgres', '<DATABASE_URL>'],
				note: 'Verified command: npx -y @modelcontextprotocol/server-postgres <connection URL>. Enter your PostgreSQL connection string below and AtlasMind fills it in.',
				inputs: [
					{
						key: '<DATABASE_URL>',
						label: 'PostgreSQL connection URL',
						help: 'e.g. postgresql://user:password@localhost:5432/mydb',
						kind: 'url',
						target: 'arg',
						placeholder: '<DATABASE_URL>',
						required: true,
					},
				],
				runtimeInstalls: {
					win32: [{ packageManager: 'winget', packageId: 'OpenJS.NodeJS.LTS', displayName: 'Node.js LTS' }],
					darwin: [{ packageManager: 'brew', packageId: 'node', displayName: 'Node.js' }],
					linux: [
						{ packageManager: 'brew', packageId: 'node', displayName: 'Node.js' },
						{ packageManager: 'apt-get', packageId: 'nodejs', extraPackages: ['npm'], displayName: 'Node.js and npm' },
						{ packageManager: 'dnf', packageId: 'nodejs', extraPackages: ['npm'], displayName: 'Node.js and npm' },
						{ packageManager: 'pacman', packageId: 'nodejs', extraPackages: ['npm'], displayName: 'Node.js and npm' },
					],
				},
			};
		case 'mcp-server-sentry':
			return {
				setupMode: 'prefill',
				transport: 'stdio',
				command: 'uvx',
				args: ['mcp-server-sentry'],
				note: 'Verified command: uvx mcp-server-sentry. Enter a Sentry auth token below; AtlasMind stores it securely and passes it as an environment variable.',
				inputs: [
					{
						key: 'SENTRY_AUTH_TOKEN',
						label: 'Sentry Auth Token',
						help: 'Create one under Sentry → Settings → Auth Tokens.',
						kind: 'secret',
						target: 'env',
						required: true,
					},
				],
				runtimeInstalls: {
					win32: [{ packageManager: 'winget', packageId: 'astral-sh.uv', displayName: 'uv' }],
					darwin: [{ packageManager: 'brew', packageId: 'uv', displayName: 'uv' }],
					linux: [
						{ packageManager: 'brew', packageId: 'uv', displayName: 'uv' },
						{ packageManager: 'apt-get', packageId: 'uv', displayName: 'uv' },
						{ packageManager: 'dnf', packageId: 'uv', displayName: 'uv' },
						{ packageManager: 'pacman', packageId: 'uv', displayName: 'uv' },
					],
				},
			};
		case 'mcp-server-slack':
			return {
				setupMode: 'prefill',
				transport: 'stdio',
				command: 'npx',
				args: ['-y', '@zencoderai/slack-mcp-server'],
				note: 'Verified command: npx -y @zencoderai/slack-mcp-server. Enter your Slack bot credentials below; the bot token is stored securely.',
				inputs: [
					{
						key: 'SLACK_BOT_TOKEN',
						label: 'Slack Bot Token',
						help: 'Starts with xoxb-. From your Slack app → OAuth & Permissions.',
						kind: 'secret',
						target: 'env',
						required: true,
					},
					{
						key: 'SLACK_TEAM_ID',
						label: 'Slack Team ID',
						help: 'Your workspace/team ID (starts with T).',
						kind: 'text',
						target: 'env',
						required: true,
					},
				],
				runtimeInstalls: {
					win32: [{ packageManager: 'winget', packageId: 'OpenJS.NodeJS.LTS', displayName: 'Node.js LTS' }],
					darwin: [{ packageManager: 'brew', packageId: 'node', displayName: 'Node.js' }],
					linux: [
						{ packageManager: 'brew', packageId: 'node', displayName: 'Node.js' },
						{ packageManager: 'apt-get', packageId: 'nodejs', extraPackages: ['npm'], displayName: 'Node.js and npm' },
						{ packageManager: 'dnf', packageId: 'nodejs', extraPackages: ['npm'], displayName: 'Node.js and npm' },
						{ packageManager: 'pacman', packageId: 'nodejs', extraPackages: ['npm'], displayName: 'Node.js and npm' },
					],
				},
			};
		case 'mcp-server-buzz':
			return {
				setupMode: 'prefill',
				transport: 'stdio',
				command: 'node',
				args: ['${extensionPath}/out/mcp/buzzCommsServer.js'],
				env: {
					ATLASMIND_BUZZ_ENABLED: '${config:atlasmind.buzz.enabled}',
					ATLASMIND_BUZZ_ALLOW_REMOTE_RELAY: '${config:atlasmind.buzz.allowRemoteRelay}',
					BUZZ_CLI_PATH: 'buzz',
					BUZZ_RELAY_URL: '${config:atlasmind.buzz.relayUrl}',
				},
				note: 'AtlasMind-bundled communication-only MCP bridge for the official Buzz CLI v0.4.26. It exposes channels, posts, threads, and DMs — never Buzz shell/file/admin tools.',
				inputs: [
					{
						key: 'BUZZ_PRIVATE_KEY',
						label: 'Buzz agent private key',
						help: 'The agent identity key as nsec or 64-character hex. Stored only in VS Code SecretStorage.',
						kind: 'secret',
						target: 'env',
						example: 'nsec1…',
						required: true,
					},
					{
						key: 'BUZZ_AUTH_TAG',
						label: 'Buzz owner authorization tag — optional',
						help: 'Optional NIP-OA owner attestation JSON. Store it as a secret when your community requires scoped agent authorization.',
						kind: 'secret',
						target: 'env',
						required: false,
					},
					{
						key: 'BUZZ_CLI_PATH',
						label: 'Buzz CLI executable',
						help: 'Command name or absolute path for the pinned v0.4.26 Buzz CLI. Leave as "buzz" when it is on PATH.',
						kind: 'text',
						target: 'env',
						defaultValue: 'buzz',
						example: 'C:\\Tools\\buzz.exe',
						required: false,
					},
				],
				prerequisites: [
					'Buzz CLI v0.4.26 installed from the official Block release or built from the v0.4.26 tag.',
					'A Buzz community/relay and a dedicated agent identity with only the channel memberships it needs.',
					'atlasmind.buzz.enabled turned on; remote communities also require atlasmind.buzz.allowRemoteRelay.',
					'Node.js (AtlasMind can install it) to host the bundled local MCP bridge.',
				],
				credentialSteps: [
					'Create or select a dedicated agent identity in Buzz; do not reuse a human private key.',
					'Grant that identity membership only in the channels AtlasMind should reach.',
					'Copy the identity private key (nsec or 64-character hex) into the secret field below.',
					'If your community issues a NIP-OA owner authorization tag, paste that optional JSON grant too.',
					'Enable atlasmind.buzz.enabled and review the configured relay URL before connecting.',
				],
				credentialHelpUrl: 'https://github.com/block/buzz/blob/v0.4.26/README.md',
				safetyNote: 'This identity can perform real external sends. Use a dedicated, least-privilege agent key. AtlasMind stores it in SecretStorage, passes message bodies over stdin, confirms Director sends, and rejects an incompatible CLI command contract or remote relays without explicit consent.',
				runtimeInstalls: NODE_RUNTIME_INSTALLS,
			};
		case 'mcp-server-github':
			return {
				setupMode: 'prefill',
				transport: 'stdio',
				command: 'docker',
				args: ['run', '-i', '--rm', '-e', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'ghcr.io/github/github-mcp-server'],
				note: 'Official GitHub MCP server (Docker image ghcr.io/github/github-mcp-server). Paste a fine-grained token below; AtlasMind stores it securely and passes it to the container.',
				inputs: [
					{
						key: 'GITHUB_PERSONAL_ACCESS_TOKEN',
						label: 'GitHub Personal Access Token',
						help: 'Authorises the server to read/manage your repos, issues, and PRs. Create a fine-grained token; stored in SecretStorage and passed to the container as an env var.',
						kind: 'secret',
						target: 'env',
						example: 'github_pat_11ABCDE0A0…',
						required: true,
					},
				],
				prerequisites: [
					'A GitHub account (any plan).',
					'Docker installed and running (AtlasMind can install Docker for you).',
					'A fine-grained personal access token you create in the steps below.',
				],
				credentialSteps: [
					'Sign in to GitHub, then open the token page linked below.',
					'Name it "AtlasMind MCP" and set an expiry (e.g. 90 days).',
					'Repository access → choose "Only select repositories" (least privilege).',
					'Repository permissions → set Contents, Issues, and Pull requests to Read and write.',
					'Click Generate token and copy it (github_pat_…) — it is shown only once.',
					'Paste it into the field below.',
				],
				credentialHelpUrl: 'https://github.com/settings/personal-access-tokens/new',
				safetyNote: 'Grant access to "Only select repositories" so the token can only touch what you intend.',
				runtimeInstalls: DOCKER_RUNTIME_INSTALLS,
			};
		case 'mcp-server-entra':
			return {
				setupMode: 'prefill',
				transport: 'stdio',
				command: 'npx',
				args: ['-y', '@merill/lokka'],
				note: 'Microsoft Entra ID via Lokka (community server maintained by a Microsoft Entra PM). Enter your app-registration details below.',
				inputs: [
					{ key: 'TENANT_ID', label: 'Directory (tenant) ID', help: 'Your Entra tenant ID, from the app registration Overview page.', kind: 'text', target: 'env', example: '0a1b2c3d-4e5f-6789-abcd-ef0123456789', required: true },
					{ key: 'CLIENT_ID', label: 'Application (client) ID', help: 'The app registration client ID, from its Overview page.', kind: 'text', target: 'env', example: '1f2e3d4c-5b6a-7890-cdef-0123456789ab', required: true },
					{ key: 'CLIENT_SECRET', label: 'Client secret value', help: 'The secret VALUE (not its ID) from Certificates & secrets. Shown only once.', kind: 'secret', target: 'env', example: 'abc8Q~ExAmPle-Secret-Value…', required: true },
				],
				prerequisites: [
					'A Microsoft Entra tenant and an account that can create app registrations.',
					'A tenant admin to grant admin consent for the Graph permissions.',
					'Node.js (AtlasMind can install it for you).',
				],
				credentialSteps: [
					'In entra.microsoft.com → Identity → Applications → App registrations → New registration (single tenant), Register.',
					'On Overview, copy the Directory (tenant) ID and Application (client) ID.',
					'API permissions → Add → Microsoft Graph → Application permissions → add read-only scopes (User.Read.All, Group.Read.All, Directory.Read.All).',
					'Click "Grant admin consent" and confirm the green check marks.',
					'Certificates & secrets → New client secret → copy the Value (shown once).',
					'Paste the tenant ID, client ID, and secret value below.',
				],
				credentialHelpUrl: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
				safetyNote: 'Community package (by a Microsoft Entra PM). Grant read-only Graph scopes to limit what it can do.',
				runtimeInstalls: NODE_RUNTIME_INSTALLS,
			};
		case 'mcp-server-m365':
			return {
				setupMode: 'prefill',
				transport: 'stdio',
				command: 'npx',
				args: ['-y', '@softeria/ms-365-mcp-server', '--org-mode', '--read-only'],
				note: 'Microsoft 365 via @softeria/ms-365-mcp-server. Read-only by default; sign in with a one-time browser device code on first connect (no token needed up front). Leave the fields blank unless you use your own Entra app.',
				inputs: [
					{ key: 'MS365_MCP_CLIENT_ID', label: 'Custom Entra app (client) ID — optional', help: 'Only if you register your own Entra app instead of Softeria\'s default. Leave blank otherwise.', kind: 'text', target: 'env', example: '11111111-2222-3333-4444-555555555555', required: false },
					{ key: 'MS365_MCP_TENANT_ID', label: 'Entra tenant ID — optional', help: 'Your tenant ID, or "consumers"/"common". Leave blank to use the default.', kind: 'text', target: 'env', example: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', required: false },
					{ key: 'MS365_MCP_CLIENT_SECRET', label: 'Custom Entra app secret — optional', help: 'Only needed with a custom Entra app. Leave blank otherwise.', kind: 'secret', target: 'env', example: 'abc8Q~ExAmPle-Secret-Value…', required: false },
				],
				prerequisites: [
					'A Microsoft 365 work/school account (for a personal account, remove --org-mode via Advanced).',
					'Node.js 18+ (20+ recommended) — AtlasMind can install it.',
					'A one-time browser sign-in on first connect; your organisation may need to approve it once.',
				],
				credentialSteps: [
					'Add the server with the prefilled command and connect — no token is needed up front.',
					'Ask the tools to sign in (or run: npx -y @softeria/ms-365-mcp-server --login).',
					'Open microsoft.com/devicelogin and enter the code shown.',
					'Sign in and approve the requested permissions; an admin approves once if required.',
					'Your sign-in is cached by your OS credential store — no token is stored in AtlasMind.',
				],
				credentialHelpUrl: 'https://github.com/Softeria/ms-365-mcp-server#authentication',
				safetyNote: 'Third-party server (Softeria). Runs read-only by default; enable write access via Advanced only when you need it.',
				runtimeInstalls: NODE_RUNTIME_INSTALLS,
			};
		case 'mcp-server-shopify':
			return {
				setupMode: 'prefill',
				transport: 'stdio',
				command: 'npx',
				args: ['-y', '@shopify/dev-mcp@latest'],
				note: 'Official Shopify Dev MCP server — searches Shopify dev docs and the Admin GraphQL schema. No account or token required; connect immediately.',
				prerequisites: [
					'Node.js (AtlasMind can install it for you).',
					'No Shopify account or token needed — it reads public developer docs and schemas only.',
				],
				credentialSteps: [
					'No credential is required — just connect.',
					'Verify by asking: "search the Shopify Admin GraphQL schema for the product type".',
				],
				credentialHelpUrl: 'https://shopify.dev/docs/apps/build/devmcp',
				safetyNote: 'This is the developer docs/schema server, not a live-store connector. It sends anonymous usage telemetry.',
				runtimeInstalls: NODE_RUNTIME_INSTALLS,
			};
		case 'mcp-server-woocommerce':
			return {
				setupMode: 'prefill',
				transport: 'stdio',
				command: 'npx',
				args: ['-y', '@automattic/mcp-wordpress-remote@latest'],
				note: 'Official Automattic WordPress/WooCommerce MCP server. Enable the MCP feature on your store first, then paste your store URL and REST API keys below.',
				inputs: [
					{ key: 'WP_API_URL', label: 'Store MCP endpoint URL', help: 'Your store URL + /wp-json/mcp/mcp-adapter-default-server.', kind: 'url', target: 'env', example: 'https://mystore.com/wp-json/mcp/mcp-adapter-default-server', required: true },
					{ key: 'WOO_CUSTOMER_KEY', label: 'WooCommerce REST API consumer key', help: 'Starts with ck_. From WooCommerce → Settings → Advanced → REST API.', kind: 'secret', target: 'env', example: 'ck_1a2b3c4d5e6f…', required: true },
					{ key: 'WOO_CUSTOMER_SECRET', label: 'WooCommerce REST API consumer secret', help: 'Starts with cs_. Shown only once when you create the key.', kind: 'secret', target: 'env', example: 'cs_9f8e7d6c5b4a…', required: true },
				],
				prerequisites: [
					'A WooCommerce 10.3+ store on HTTPS that you administer.',
					'The MCP feature enabled on the store (WooCommerce → Settings → Advanced → Features → MCP (Beta)).',
					'Node.js (AtlasMind can install it for you).',
				],
				credentialSteps: [
					'Sign in to wp-admin as an administrator.',
					'WooCommerce → Settings → Advanced → Features → enable "MCP (Beta)", Save.',
					'WooCommerce → Settings → Advanced → REST API → Add key.',
					'Description "AtlasMind MCP", pick an admin user, Permissions = Read (use Read/Write only if you need writes).',
					'Generate the key and copy ck_… and cs_… (the secret is shown once).',
					'Endpoint URL = https://YOURDOMAIN/wp-json/mcp/mcp-adapter-default-server.',
				],
				credentialHelpUrl: 'https://woocommerce.com/document/woocommerce-rest-api/',
				safetyNote: 'WooCommerce MCP is Beta and endpoints may change. Prefer a Read-only API key.',
				runtimeInstalls: NODE_RUNTIME_INSTALLS,
			};
		case 'mcp-server-wordpress':
			return {
				setupMode: 'prefill',
				transport: 'stdio',
				command: 'npx',
				args: ['-y', '@automattic/mcp-wordpress-remote'],
				note: 'Official Automattic WordPress MCP server. Install the MCP Adapter plugin on your site, then use an application password below.',
				inputs: [
					{ key: 'WP_API_URL', label: 'WordPress MCP endpoint URL', help: 'Your site URL + /wp-json/mcp/mcp-adapter-default-server.', kind: 'url', target: 'env', example: 'https://example.com/wp-json/mcp/mcp-adapter-default-server', required: true },
					{ key: 'WP_API_USERNAME', label: 'WordPress username', help: 'Your WordPress admin username.', kind: 'text', target: 'env', example: 'jane_admin', required: true },
					{ key: 'WP_API_PASSWORD', label: 'Application password', help: 'From Users → Profile → Application Passwords. Keep the spaces in the value.', kind: 'secret', target: 'env', example: 'abcd EFGH 1234 wxyz 5678 90AB', required: true },
					{ key: 'OAUTH_ENABLED', label: 'Use application password', help: 'Keep this "false" to authenticate with the application password above.', kind: 'text', target: 'env', example: 'false', defaultValue: 'false', required: true },
				],
				prerequisites: [
					'A self-hosted WordPress 6.9+ site (on HTTPS) where you are an administrator.',
					'The official MCP Adapter plugin installed and activated.',
					'Node.js 22+ — AtlasMind can install it.',
				],
				credentialSteps: [
					'Download mcp-adapter.zip from github.com/WordPress/mcp-adapter/releases/latest.',
					'wp-admin → Plugins → Add New → Upload Plugin → upload and Activate it.',
					'Confirm your endpoint: open site + /wp-json/mcp/mcp-adapter-default-server and check it returns JSON (not 404).',
					'Users → Profile → Application Passwords → name it "AtlasMind" → Add New Application Password.',
					'Copy the spaced value into the password field (keep the spaces) and enter your username.',
					'Leave "Use application password" set to false.',
				],
				credentialHelpUrl: 'https://wordpress.org/documentation/article/application-passwords/',
				safetyNote: 'Application passwords require HTTPS. The application-password path is treated as legacy upstream (OAuth is their default) but is fully supported.',
				runtimeInstalls: NODE_RUNTIME_INSTALLS,
			};
		case 'mcp-server-webflow':
			return {
				setupMode: 'prefill',
				transport: 'stdio',
				command: 'npx',
				args: ['-y', 'webflow-mcp-server@latest'],
				note: 'Official Webflow MCP server. Paste a Site API token below.',
				inputs: [
					{ key: 'WEBFLOW_TOKEN', label: 'Webflow Site API Token', help: 'Generate under your site\'s Settings → Apps & integrations → API access. Only site admins can create one.', kind: 'secret', target: 'env', example: 'a1b2c3d4e5f6…', required: true },
				],
				prerequisites: [
					'A Webflow account with site-admin access (only admins can mint a token).',
					'Node.js 22.3+ — AtlasMind can install it.',
					'Some Data API operations may require a paid Webflow plan.',
				],
				credentialSteps: [
					'Open the Webflow Dashboard → your site → Settings.',
					'Site settings → Apps & integrations → API access → Generate API token.',
					'Name it "AtlasMind MCP" and enable only the scopes you need (least privilege).',
					'Generate and copy the token (shown once).',
					'Paste it below.',
				],
				credentialHelpUrl: 'https://developers.webflow.com/data/docs/getting-started-apps/get-a-site-token',
				safetyNote: 'Enable only the scopes you actually need. Tokens are limited to 5 per site and expire after 365 days unused.',
				runtimeInstalls: NODE_RUNTIME_INSTALLS,
			};
		case 'mcp-server-wix':
			return {
				setupMode: 'prefill',
				transport: 'stdio',
				command: 'npx',
				args: ['-y', '@wix/mcp-remote@latest', 'https://mcp.wix.com/mcp', '--header', 'Authorization:${WIX_API_KEY}', '--header', 'wix-account-id:<WIX_ACCOUNT_ID>'],
				note: 'Official Wix MCP (via the Wix remote proxy). Enter your Wix API key and Account ID below; the key is stored securely and injected into the request header.',
				inputs: [
					{ key: 'WIX_API_KEY', label: 'Wix API key', help: 'Generate under Account Settings → API Keys (owner/co-owner only). Stored in SecretStorage and passed as a request header.', kind: 'secret', target: 'env', example: 'IST.eyJ…', required: true },
					{ key: '<WIX_ACCOUNT_ID>', label: 'Wix Account ID', help: 'The account UUID shown on the API Keys page.', kind: 'text', target: 'arg', placeholder: '<WIX_ACCOUNT_ID>', example: '11111111-2222-3333-4444-555555555555', required: true },
				],
				prerequisites: [
					'A Wix account where you are the owner or a co-owner (required to create an API key).',
					'Node.js — AtlasMind can install it.',
				],
				credentialSteps: [
					'Sign in at wix.com as the account owner or a co-owner.',
					'Open manage.wix.com/account/api-keys.',
					'Copy your Account ID (a UUID) into the Account ID field.',
					'Click "Generate API Key", name it, and choose "Specific sites" with the minimum scopes you need.',
					'Copy the key (shown once) into the API key field.',
				],
				credentialHelpUrl: 'https://manage.wix.com/account/api-keys',
				safetyNote: 'A Wix API key grants account-level access — scope it to specific sites and minimal permissions.',
				runtimeInstalls: NODE_RUNTIME_INSTALLS,
			};
		case 'mcp-server-youtube':
			return {
				setupMode: 'prefill',
				transport: 'stdio',
				command: 'npx',
				args: ['-y', '@kirbah/mcp-youtube'],
				note: 'Community YouTube Data API MCP server (@kirbah/mcp-youtube). Paste a YouTube Data API key below.',
				inputs: [
					{ key: 'YOUTUBE_API_KEY', label: 'YouTube Data API key', help: 'A Google Cloud API key with the YouTube Data API v3 enabled.', kind: 'secret', target: 'env', example: 'AIzaSyD-EXAMPLE…', required: true },
				],
				prerequisites: [
					'A free Google account.',
					'A Google Cloud project with the "YouTube Data API v3" enabled (free, no billing).',
					'Node.js — AtlasMind can install it.',
				],
				credentialSteps: [
					'Open console.cloud.google.com → create a project (e.g. "AtlasMind YouTube") and select it.',
					'Enable the YouTube Data API v3 (console.cloud.google.com/apis/library/youtube.googleapis.com).',
					'APIs & Services → Credentials → Create Credentials → API key.',
					'Copy the AIza… key.',
					'Edit the key → API restrictions → restrict it to "YouTube Data API v3" → Save.',
					'Paste it below.',
				],
				credentialHelpUrl: 'https://console.cloud.google.com/apis/credentials',
				safetyNote: 'Community server (no official YouTube MCP exists). Restrict the API key to the YouTube Data API only.',
				runtimeInstalls: NODE_RUNTIME_INSTALLS,
			};
		case 'mcp-server-meta':
			return {
				setupMode: 'prefill',
				transport: 'stdio',
				command: 'uvx',
				args: ['meta-ads-mcp'],
				note: 'Meta Ads MCP server (meta-ads-mcp, via the Pipeboard broker so no Meta Developer App is required). Paste a Pipeboard token below. Covers Meta ADS only — not organic posts or DMs.',
				inputs: [
					{ key: 'PIPEBOARD_API_TOKEN', label: 'Pipeboard API Token', help: 'From pipeboard.co/api-tokens after you connect your Meta/Facebook account there.', kind: 'secret', target: 'env', example: 'pb_9f3c1a2b…', required: true },
				],
				prerequisites: [
					'A Facebook/Meta account that administers at least one Meta Ads account.',
					'A free Pipeboard account (it brokers the Meta OAuth for you).',
					'The uv / uvx runtime — AtlasMind can install it.',
				],
				credentialSteps: [
					'Create an account at pipeboard.co.',
					'Connect your Meta / Facebook account and approve the OAuth prompt.',
					'Open pipeboard.co/api-tokens and create a token named "AtlasMind".',
					'Copy the token and paste it below.',
				],
				credentialHelpUrl: 'https://pipeboard.co/api-tokens',
				safetyNote: 'Not Meta-official — access is brokered by Pipeboard (a third party). Write actions can change real ad spend, so review them at the approval gate.',
				runtimeInstalls: UV_RUNTIME_INSTALLS,
			};
		case 'mcp-server-x':
			return {
				setupMode: 'prefill',
				transport: 'stdio',
				command: 'npx',
				args: ['-y', '@xdevplatform/xurl', 'mcp', 'https://api.x.com/mcp'],
				note: 'Official X (Twitter) MCP bridge (@xdevplatform/xurl). Enter your OAuth 2.0 client credentials below; you approve access in the browser on first connect.',
				inputs: [
					{ key: 'CLIENT_ID', label: 'X OAuth 2.0 Client ID', help: 'From your X app → Keys and tokens (OAuth 2.0, Confidential client).', kind: 'secret', target: 'env', example: 'eVc3d0hHTFF4…', required: true },
					{ key: 'CLIENT_SECRET', label: 'X OAuth 2.0 Client Secret', help: 'From the same Keys and tokens page. Shown only once.', kind: 'secret', target: 'env', example: '9kQ2mP7v0s…', required: true },
				],
				prerequisites: [
					'An X account plus a free X developer account.',
					'An X app with an OAuth 2.0 Confidential client and callback http://localhost:8080/callback.',
					'A paid/pay-per-use X API plan in Production (the free tier rejects reads).',
					'Node.js and a browser for the one-time sign-in on first connect.',
				],
				credentialSteps: [
					'Open developer.x.com/en/portal/dashboard and finish the free developer sign-up if prompted.',
					'Create a Project and an App.',
					'User authentication settings → Set up → enable OAuth 2.0, Type = Confidential.',
					'Set the Callback URI to http://localhost:8080/callback and a Website URL, then Save.',
					'Keys and tokens → copy the OAuth 2.0 Client ID and Client Secret (secret shown once).',
					'Paste both below. On first connect, approve access in the browser (allow up to a few minutes).',
				],
				credentialHelpUrl: 'https://developer.x.com/en/portal/dashboard',
				safetyNote: 'Reads require a paid X API plan (Production); the free tier will fail. First connect opens a browser for OAuth.',
				runtimeInstalls: NODE_RUNTIME_INSTALLS,
			};
		case 'mcp-server-twitch':
			return {
				// Guided-manual: reputable-enough to prefill the form, but flagged for
				// review (community, low-maintenance) and pinned to a reviewed version.
				setupMode: 'manual',
				transport: 'stdio',
				command: 'npx',
				args: ['-y', '@mtane0412/twitch-mcp-server@2.0.5'],
				note: 'Community Twitch MCP server, pinned to a reviewed version. Read-only (public Twitch data). Review before connecting.',
				inputs: [
					{ key: 'TWITCH_CLIENT_ID', label: 'Twitch Client ID', help: 'From your app in the Twitch Developer Console.', kind: 'text', target: 'env', example: 'gp762nuuoqcox2yp7bmk9zdjsx', required: true },
					{ key: 'TWITCH_CLIENT_SECRET', label: 'Twitch Client Secret', help: 'Generate it in the Twitch Developer Console (shown once).', kind: 'secret', target: 'env', example: '39fjr9848fjkdi38fjfk38fj', required: true },
				],
				prerequisites: [
					'A free Twitch account with two-factor authentication enabled (required to register an app).',
					'A registered application in the Twitch Developer Console.',
					'Node.js — AtlasMind can install it.',
				],
				credentialSteps: [
					'Open dev.twitch.tv/console/apps and log in (enable 2FA if prompted).',
					'Click "Register Your Application".',
					'Use a unique name, OAuth Redirect URL http://localhost, Category "Application Integration", Client Type Confidential, then Create.',
					'Open the app → Manage → copy the Client ID.',
					'Click "New Secret" and copy the secret (shown once).',
					'Paste both below.',
				],
				credentialHelpUrl: 'https://dev.twitch.tv/console/apps',
				safetyNote: 'Community server with low recent maintenance — read-only, so blast radius is small. Review it before connecting.',
				runtimeInstalls: NODE_RUNTIME_INSTALLS,
			};
		case 'mcp-server-linkedin':
			return {
				// Guided-manual: community server using LinkedIn's official OAuth API,
				// pinned to a reviewed version. The token can post as you — review first.
				setupMode: 'manual',
				transport: 'stdio',
				command: 'npx',
				args: ['-y', '@pegasusheavy/linkedin-mcp@1.4.0'],
				note: 'Community LinkedIn MCP server (uses LinkedIn\'s official OAuth API), pinned to a reviewed version. The access token can post on your behalf — review before connecting.',
				inputs: [
					{ key: 'LINKEDIN_ACCESS_TOKEN', label: 'LinkedIn OAuth access token', help: 'Generated with LinkedIn\'s OAuth token tool for your developer app. Expires roughly every 60 days.', kind: 'secret', target: 'env', example: 'AQVJ8kZ2n5xQw…', required: true },
				],
				prerequisites: [
					'A LinkedIn account and a free LinkedIn Developer app (requires an associated company Page).',
					'"Sign In with LinkedIn using OpenID Connect" added to the app (plus "Share on LinkedIn" if you want to post).',
					'Node.js — AtlasMind can install it. Note: the token expires ~every 60 days and must be regenerated.',
				],
				credentialSteps: [
					'Open developer.linkedin.com and create an app (associate a Page and logo).',
					'Products → add "Sign In with LinkedIn using OpenID Connect" (and "Share on LinkedIn" to post).',
					'Auth tab → confirm scopes (openid, profile, email, and w_member_social to post).',
					'Docs and tools → OAuth 2.0 token generator → pick your app and the scopes.',
					'Approve on the consent screen and copy the generated access token.',
					'Paste it below (repeat roughly every 60 days when it expires).',
				],
				credentialHelpUrl: 'https://www.linkedin.com/developers/apps',
				safetyNote: 'Community server. With the posting scope the token can publish as you — grant only the scopes you need and review before connecting.',
				runtimeInstalls: NODE_RUNTIME_INSTALLS,
			};
		case 'mcp-server-aws':
			return {
				setupMode: 'prefill',
				transport: 'stdio',
				command: 'uvx',
				args: ['awslabs.aws-api-mcp-server@latest'],
				note: 'Official AWS Labs AWS API MCP server. Read-only by default; enter least-privilege IAM credentials below.',
				inputs: [
					{ key: 'AWS_REGION', label: 'AWS Region', help: 'The region your resources live in.', kind: 'text', target: 'env', example: 'us-east-1', required: true },
					{ key: 'AWS_ACCESS_KEY_ID', label: 'AWS Access Key ID', help: 'From an IAM user with least-privilege (start with ReadOnlyAccess).', kind: 'secret', target: 'env', example: 'AKIAIOSFODNN7EXAMPLE', required: true },
					{ key: 'AWS_SECRET_ACCESS_KEY', label: 'AWS Secret Access Key', help: 'Shown only once when you create the access key.', kind: 'secret', target: 'env', example: 'wJalrXUtnFEMI/K7MDENG/…', required: true },
					{ key: 'AWS_SESSION_TOKEN', label: 'AWS Session Token (optional)', help: 'Only for temporary/SSO credentials.', kind: 'secret', target: 'env', example: 'FQoGZXIvYXdz…', required: false },
					{ key: 'READ_OPERATIONS_ONLY', label: 'Read-only mode (recommended)', help: 'Keep "true" so the server cannot mutate AWS resources.', kind: 'text', target: 'env', example: 'true', defaultValue: 'true', required: true },
				],
				prerequisites: [
					'The uv / uvx runtime (AtlasMind can install it; it provisions Python).',
					'A least-privilege IAM user (start with ReadOnlyAccess) — never your root account.',
				],
				credentialSteps: [
					'IAM → Users → Create user "atlasmind-mcp".',
					'Attach the ReadOnlyAccess policy (add more only if you need writes).',
					'Security credentials → Create access key → "Application running outside AWS".',
					'Copy the Access Key ID and Secret (shown once) and set your Region below.',
					'Leave "Read-only mode" set to true.',
				],
				credentialHelpUrl: 'https://console.aws.amazon.com/iam/home#/users',
				safetyNote: 'Executes real AWS API calls with your credentials. Use a least-privilege IAM user and keep read-only mode on — turning it off allows mutating operations.',
				runtimeInstalls: UV_RUNTIME_INSTALLS,
			};
		case 'mcp-server-gcp':
			return {
				setupMode: 'prefill',
				transport: 'stdio',
				command: 'npx',
				args: ['-y', '@google-cloud/gcloud-mcp'],
				note: 'Google Cloud gcloud MCP server (official npm scope, preview). Uses your existing gcloud CLI sign-in — no token to paste.',
				inputs: [
					{ key: 'CLOUDSDK_CORE_PROJECT', label: 'GCP project ID (optional)', help: 'Pins a project; otherwise your active gcloud project is used.', kind: 'text', target: 'env', example: 'my-project-123456', required: false },
				],
				prerequisites: [
					'Node.js (AtlasMind can install it).',
					'The Google Cloud CLI installed and signed in (gcloud init) — AtlasMind cannot auto-install gcloud.',
					'A least-privilege account (service-account impersonation recommended).',
				],
				credentialSteps: [
					'Install the Google Cloud CLI and run: gcloud init (sign in, pick a project).',
					'Verify with: gcloud auth list and gcloud config list.',
					'(Recommended) impersonate a least-privilege service account.',
					'Optionally enter a project ID below. No token is pasted.',
				],
				credentialHelpUrl: 'https://cloud.google.com/sdk/docs/authorizing',
				safetyNote: 'Runs real gcloud commands and inherits the FULL permissions of your signed-in account — it can create, modify, and delete resources and incur cost. It is not read-only; require approval for mutating commands and prefer a scoped service account. Preview project, not covered by Google Cloud ToS.',
				runtimeInstalls: NODE_RUNTIME_INSTALLS,
			};
		case 'mcp-server-cloudflare':
			return {
				setupMode: 'prefill',
				transport: 'stdio',
				command: 'npx',
				args: ['-y', 'mcp-remote@0.1.38', 'https://mcp.cloudflare.com/mcp'],
				note: 'Official Cloudflare MCP (remote) via the mcp-remote bridge. No key to paste — you approve access in your browser on first connect.',
				prerequisites: [
					'Node.js (AtlasMind can install it).',
					'A Cloudflare account (free is fine).',
					'A default browser for the one-time sign-in on first connect.',
				],
				credentialSteps: [
					'Connect — a browser tab "Authorize Cloudflare" opens.',
					'Pick your account and grant the least-privilege scopes you need.',
					'Approve, then return to VS Code — the sign-in is cached by the bridge (~/.mcp-auth).',
				],
				credentialHelpUrl: 'https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/',
				safetyNote: 'Full Cloudflare API — write/Code-Mode tools can make destructive changes across DNS, WAF, Workers, and Zero Trust. Grant least-privilege scopes at consent and keep approval on for config-changing actions. The bridge (mcp-remote, community) caches the OAuth token unencrypted at ~/.mcp-auth; run only on a trusted machine.',
				runtimeInstalls: NODE_RUNTIME_INSTALLS,
			};
		case 'mcp-server-cloudflare-workers':
			return {
				setupMode: 'prefill',
				transport: 'stdio',
				command: 'npx',
				args: ['-y', 'mcp-remote@0.1.38', 'https://bindings.mcp.cloudflare.com/mcp'],
				note: 'Official Cloudflare Workers Bindings MCP (remote) via the mcp-remote bridge. Browser OAuth on first connect — no key to paste.',
				prerequisites: [
					'Node.js (AtlasMind can install it).',
					'A Cloudflare account with the Workers/KV/R2/D1 you want to manage.',
					'A default browser for the one-time sign-in.',
				],
				credentialSteps: [
					'Connect — a Cloudflare sign-in opens in your browser.',
					'Pick the account whose Workers resources you want and Allow.',
					'Return to VS Code. Revoke later in the Cloudflare dashboard and delete ~/.mcp-auth.',
				],
				credentialHelpUrl: 'https://dash.cloudflare.com/',
				safetyNote: 'Tools create/modify/DELETE real KV, R2, D1, Hyperdrive, and Workers. Treat write/delete as approval-required. The mcp-remote bridge caches the OAuth token unencrypted at ~/.mcp-auth.',
				runtimeInstalls: NODE_RUNTIME_INSTALLS,
			};
		case 'mcp-server-appledev':
			return {
				setupMode: 'prefill',
				transport: 'stdio',
				command: 'npx',
				args: ['-y', 'xcodebuildmcp@2.7.0', 'mcp'],
				note: 'XcodeBuildMCP (Sentry-maintained) — build/run/test Apple projects and simulators. macOS + Xcode only; no credentials.',
				inputs: [],
				prerequisites: [
					'macOS with Xcode 16+ (opened once, license accepted) — this server will NOT run on Windows or Linux.',
					'Xcode Command Line Tools (xcode-select --install) and an iOS Simulator runtime.',
					'Node.js (AtlasMind can install it).',
				],
				credentialSteps: [
					'No credential — one-time Mac prep only.',
					'Install/launch Xcode; run: xcode-select --install.',
					'If prompted: sudo xcodebuild -license accept.',
					'Confirm at least one simulator exists, then connect.',
				],
				credentialHelpUrl: 'https://www.xcodebuildmcp.com/docs/getting-started',
				safetyNote: 'macOS-only — it will not start on this platform if you are on Windows/Linux. Powerful local tool (runs xcodebuild, boots/erases simulators, installs/launches apps) — treat build/run/erase like local shell execution and gate behind approval.',
				runtimeInstalls: NODE_RUNTIME_INSTALLS,
			};
		case 'mcp-server-apns':
			return {
				// Guided-manual: low-adoption single-maintainer wrapper around a live push channel.
				setupMode: 'manual',
				transport: 'stdio',
				command: 'npx',
				args: ['-y', '@metrovoc/bark-mcp-server@1.2.0'],
				note: 'Apple push notifications via the community Bark MCP server (pinned). Pushes only to your own Bark devices. Review before connecting.',
				inputs: [
					{ key: 'BARK_KEY', label: 'Bark device key', help: 'The code after the last / in your Bark app URL (https://api.day.app/XXXX).', kind: 'secret', target: 'env', example: '5vTk9wQ8mN1pXyZ2abcdEF', required: true },
					{ key: 'BARK_SERVER_URL', label: 'Bark server URL (self-host only)', help: 'Leave blank to use the default api.day.app.', kind: 'url', target: 'env', example: 'https://api.day.app', required: false },
				],
				prerequisites: [
					'The free "Bark - Custom Notifications" iOS app with notifications allowed.',
					'Node.js (AtlasMind can install it).',
				],
				credentialSteps: [
					'Install the Bark iOS app and allow notifications.',
					'Copy the code after the last / in your https://api.day.app/XXXX URL.',
					'Paste it as the device key; leave the server URL blank unless self-hosting.',
				],
				credentialHelpUrl: 'https://github.com/Finb/Bark/blob/master/docs/en-us/tutorial.md',
				safetyNote: 'Community server (single maintainer, low adoption). The device key is a bearer capability; default content transits public api.day.app — enable Bark E2E encryption or self-host for sensitive pushes.',
				runtimeInstalls: NODE_RUNTIME_INSTALLS,
			};
		case 'mcp-server-mysql':
			return {
				setupMode: 'prefill',
				transport: 'stdio',
				command: 'npx',
				args: ['-y', '@benborla29/mcp-server-mysql'],
				note: 'MySQL MCP server (@benborla29). Read-only by default; enter a least-privilege SELECT-only connection below.',
				inputs: [
					{ key: 'MYSQL_HOST', label: 'MySQL host', help: 'Hostname or IP of your MySQL server.', kind: 'text', target: 'env', example: '127.0.0.1', required: true },
					{ key: 'MYSQL_PORT', label: 'MySQL port', help: 'Defaults to 3306.', kind: 'text', target: 'env', example: '3306', required: false },
					{ key: 'MYSQL_USER', label: 'MySQL username', help: 'A least-privilege (SELECT-only) user is recommended.', kind: 'text', target: 'env', example: 'atlas_readonly', required: true },
					{ key: 'MYSQL_PASS', label: 'MySQL password', help: 'Stored securely in SecretStorage.', kind: 'secret', target: 'env', example: 'S0me-Strong-Passw0rd', required: true },
					{ key: 'MYSQL_DB', label: 'Database name', help: 'Optional; scopes the connection to one database.', kind: 'text', target: 'env', example: 'mydb', required: false },
				],
				prerequisites: [
					'Node.js (AtlasMind can install it).',
					'A reachable MySQL 8.0+ / MariaDB and a SELECT-only user (recommended).',
				],
				credentialSteps: [
					"In a MySQL client as admin: CREATE USER 'atlas_readonly'@'%' IDENTIFIED BY '…';",
					'GRANT SELECT ON your_db.* TO \'atlas_readonly\'@\'%\'; then FLUSH PRIVILEGES;',
					'Enter the host, user, password, and (optionally) database below.',
				],
				credentialHelpUrl: 'https://dev.mysql.com/doc/refman/8.0/en/creating-accounts.html',
				safetyNote: 'Read-only by default. Use a least-privilege SELECT-only account (not root), and prefer SSL/TLS for non-local databases — query results flow to the model.',
				runtimeInstalls: NODE_RUNTIME_INSTALLS,
			};
		case 'mcp-server-mongodb':
			return {
				setupMode: 'prefill',
				transport: 'stdio',
				command: 'npx',
				args: ['-y', 'mongodb-mcp-server@latest', '--readOnly'],
				note: 'Official MongoDB MCP server, read-only by default. Paste your connection string below.',
				inputs: [
					{ key: 'MDB_MCP_CONNECTION_STRING', label: 'MongoDB connection string', help: 'From Atlas → Connect → Drivers, or mongodb://localhost:27017/db. Includes the password.', kind: 'secret', target: 'env', example: 'mongodb+srv://user:pass@cluster0.abc.mongodb.net/mydb', required: true },
					{ key: 'MDB_MCP_API_CLIENT_ID', label: 'Atlas Service Account Client ID (optional)', help: 'Only for Atlas admin tools.', kind: 'text', target: 'env', example: 'mdb_sa_id_0123…', required: false },
					{ key: 'MDB_MCP_API_CLIENT_SECRET', label: 'Atlas Service Account Secret (optional)', help: 'Only for Atlas admin tools.', kind: 'secret', target: 'env', example: 'mdb_sa_sk_a1b2…', required: false },
				],
				prerequisites: [
					'Node.js 20.19+ (AtlasMind can install it).',
					'A reachable MongoDB (Atlas, self-hosted, or local) and a least-privilege DB user.',
					'For Atlas: your machine IP on the Network Access allow-list.',
				],
				credentialSteps: [
					'Atlas → Clusters → Connect → Drivers → create a DB user (copy the password).',
					'Copy the connection string, replace <password>, and append /yourDatabase.',
					'Atlas → Network Access → Add Current IP, then paste the string below.',
					'Local instead: mongodb://localhost:27017/yourDatabase.',
				],
				credentialHelpUrl: 'https://www.mongodb.com/docs/guides/atlas/connection-string/',
				safetyNote: 'Keep --readOnly on unless you deliberately need writes. The connection string embeds a password — stored as a secret and passed via env, never on the command line. Use a least-privilege DB user.',
				runtimeInstalls: NODE_RUNTIME_INSTALLS,
			};
		case 'mcp-server-elasticsearch':
			return {
				setupMode: 'prefill',
				transport: 'stdio',
				command: 'docker',
				args: ['run', '-i', '--rm', '-e', 'ES_URL', '-e', 'ES_API_KEY', 'docker.elastic.co/mcp/elasticsearch', 'stdio'],
				note: 'Official Elastic MCP server (Docker). Enter your cluster URL and a read-only API key below.',
				inputs: [
					{ key: 'ES_URL', label: 'Elasticsearch cluster URL', help: 'Your cluster endpoint (Cloud uses :443).', kind: 'url', target: 'env', example: 'https://my-deployment.es.us-central1.gcp.cloud.es.io:443', required: true },
					{ key: 'ES_API_KEY', label: 'Elasticsearch API key (encoded)', help: 'Create in Kibana → Security → API keys, restricted to read-only. Use the Encoded value.', kind: 'secret', target: 'env', example: 'VnVhQ2ZHY0JDZGJr…==', required: true },
				],
				prerequisites: [
					'Docker installed AND running (launch Docker Desktop on Windows/macOS).',
					'A reachable Elasticsearch 8.x/9.x cluster over HTTPS and Kibana access to create the key.',
				],
				credentialSteps: [
					'Kibana → Stack Management → Security → API keys → Create API key.',
					'Enable "Control security privileges" and restrict it to read-only on the indices you need; set an expiration.',
					'Switch the format to Encoded and copy it into the API key field.',
					'Copy your cluster endpoint into the URL field.',
				],
				credentialHelpUrl: 'https://www.elastic.co/docs/deploy-manage/api-keys/elasticsearch-api-keys',
				safetyNote: 'Scope the API key tightly (read-only, specific indices, with an expiry). The secret is injected via a valueless Docker -e flag, never in argv. This official server is in maintenance (critical fixes only) — plan to migrate to Elastic Agent Builder later.',
				runtimeInstalls: DOCKER_RUNTIME_INSTALLS,
			};
		case 'mcp-server-rabbitmq':
			return {
				setupMode: 'prefill',
				transport: 'stdio',
				command: 'uvx',
				args: ['amq-mcp-server-rabbitmq@latest'],
				note: 'RabbitMQ MCP server (AWS Amazon MQ org). Read-only by default. Connect first, then give broker credentials to the connect tool in chat.',
				inputs: [],
				prerequisites: [
					'The uv / uvx runtime (AtlasMind can install it).',
					'Network access to your broker (AMQPS 5671 + Management API 15671/15672) with the Management plugin enabled.',
					'A least-privilege (monitoring/management) broker user.',
				],
				credentialSteps: [
					'Connect the server — no credentials are needed to start it.',
					'Gather your broker hostname, username, and password (a read-only user is best).',
					'In chat, ask: "Connect to my RabbitMQ broker at <host> as <user> with password <pass> over TLS on 5671."',
				],
				credentialHelpUrl: 'https://www.rabbitmq.com/docs/management',
				safetyNote: 'Read-only unless you add --allow-mutative-tools (create/delete/purge/publish are destructive on a live broker). Because credentials are given to a tool in chat, they pass through the model context — keep them out of persisted memory/logs. Install exactly amq-mcp-server-rabbitmq (avoid look-alikes).',
				runtimeInstalls: UV_RUNTIME_INSTALLS,
			};
		case 'mcp-server-sqs':
			return {
				setupMode: 'prefill',
				transport: 'stdio',
				command: 'uvx',
				args: ['awslabs.amazon-sns-sqs-mcp-server@latest'],
				note: 'Official AWS Labs SNS/SQS MCP server. Safe-by-default (no resource creation). Enter read-only IAM credentials below.',
				inputs: [
					{ key: 'AWS_ACCESS_KEY_ID', label: 'AWS Access Key ID', help: 'From an IAM user with SQS/SNS read-only access.', kind: 'secret', target: 'env', example: 'AKIAIOSFODNN7EXAMPLE', required: true },
					{ key: 'AWS_SECRET_ACCESS_KEY', label: 'AWS Secret Access Key', help: 'Shown only once when you create the key.', kind: 'secret', target: 'env', example: 'wJalrXUtnFEMI/K7MDENG/…', required: true },
					{ key: 'AWS_REGION', label: 'AWS Region', help: 'The region your queues live in.', kind: 'text', target: 'env', example: 'us-east-1', required: true },
					{ key: 'AWS_SESSION_TOKEN', label: 'AWS Session Token (temp/SSO only)', help: 'Only for temporary credentials.', kind: 'secret', target: 'env', example: 'FwoGZXIvYXdz…', required: false },
				],
				prerequisites: [
					'The uv / uvx runtime (AtlasMind can install it).',
					'An IAM user/role with AmazonSQSReadOnlyAccess + AmazonSNSReadOnlyAccess.',
				],
				credentialSteps: [
					'IAM → Create user "atlasmind-sqs-mcp" (programmatic access).',
					'Attach AmazonSQSReadOnlyAccess and AmazonSNSReadOnlyAccess.',
					'Create an access key ("Application running outside AWS") and copy both parts.',
					'Set your Region; leave the session token blank.',
				],
				credentialHelpUrl: 'https://console.aws.amazon.com/iam/home#/users',
				safetyNote: 'Safe-by-default — no resource-creation tools unless you opt into --allow-resource-creation. Pair with read-only IAM. Prefer temporary SSO/STS credentials over long-lived keys.',
				runtimeInstalls: UV_RUNTIME_INSTALLS,
			};
		case 'mcp-server-twilio':
			return {
				// Guided-manual: Twilio's MCP takes credentials as a positional CLI
				// argument (no env option), which AtlasMind will not auto-store in
				// config. We guide the user to add it themselves in Advanced setup.
				setupMode: 'manual',
				transport: 'stdio',
				note: 'Official Twilio (alpha) MCP server. It requires your credentials on the command line, so AtlasMind guides you to add it in Advanced setup rather than auto-storing a secret.',
				prerequisites: [
					'Node.js 18+ / npm 9+ (AtlasMind can install Node).',
					'A Twilio account (trial is fine) and a Standard API Key you create below.',
					'A Twilio phone number with SMS/Voice if you plan to send.',
				],
				credentialSteps: [
					'console.twilio.com → copy your Account SID (starts AC…).',
					'Account → API keys & tokens → Create API key → type Standard → copy the Key SID (SK…) and Secret (shown once).',
					'Open Advanced setup and add a stdio server: command npx, args: -y @twilio-alpha/mcp@0.7.0 ACxxxx/SKxxxx:your-secret',
					'Save. Note the secret is part of the command (Twilio has no env option).',
				],
				credentialHelpUrl: 'https://www.twilio.com/docs/iam/api-keys/keys-in-console',
				safetyNote: 'Execution server — real API calls send SMS/place calls and cost money. Use a revocable Standard API Key (never the primary Auth Token). Because Twilio takes the secret as a CLI argument, it can appear in OS process listings; only add it on a trusted machine and route sends through approval.',
				runtimeInstalls: NODE_RUNTIME_INSTALLS,
			};
		case 'mcp-server-sendgrid':
			return {
				setupMode: 'prefill',
				transport: 'stdio',
				command: 'npx',
				args: ['-y', '@codespar/mcp-sendgrid@0.2.2'],
				note: 'SendGrid MCP server (@codespar, pinned). Paste a restricted "Mail Send" API key below.',
				inputs: [
					{ key: 'SENDGRID_API_KEY', label: 'SendGrid API Key', help: 'A Restricted Access key with only "Mail Send" enabled.', kind: 'secret', target: 'env', example: 'SG.AbCdEf012345.mNoPqRs…', required: true },
					{ key: 'SENDGRID_FROM_EMAIL', label: 'Default From address (optional)', help: 'A verified sender identity.', kind: 'text', target: 'env', example: 'alerts@yourdomain.com', required: false },
				],
				prerequisites: [
					'Node.js (AtlasMind can install it).',
					'A SendGrid account with a verified sender identity.',
					'An API key with at least Mail Send.',
				],
				credentialSteps: [
					'app.sendgrid.com → Settings → API Keys → Create API Key.',
					'Choose Restricted Access and set only "Mail Send" to Full Access.',
					'Create & View, then copy the SG. key (shown once) into the field.',
					'Optionally verify a From address under Sender Authentication.',
				],
				credentialHelpUrl: 'https://app.sendgrid.com/settings/api_keys',
				safetyNote: 'Sending costs money and affects sender reputation. Use a Restricted "Mail Send"-only key (other tools will 403 until broadened — intentional). Community package, version-pinned; confirm the exact name @codespar/mcp-sendgrid (email-MCP impersonations exist).',
				runtimeInstalls: NODE_RUNTIME_INSTALLS,
			};
		case 'mcp-server-jenkins':
			return {
				// Guided-manual: mcp-jenkins takes the API token as a CLI argument (no
				// env option), which AtlasMind will not auto-store. Guide to Advanced.
				setupMode: 'manual',
				transport: 'stdio',
				note: 'Jenkins MCP server (mcp-jenkins). It takes the API token on the command line, so AtlasMind guides you to add it in Advanced setup rather than auto-storing a secret.',
				prerequisites: [
					'The uv / uvx runtime (AtlasMind can install it).',
					'A reachable Jenkins with the standard REST API.',
					'A least-privilege Jenkins user with an API token.',
				],
				credentialSteps: [
					'Jenkins → your name (top-right) → Security → API Token → Add new Token → Generate → copy it.',
					'Open Advanced setup and add a stdio server: command uvx, args: mcp-jenkins --jenkins-url=https://your-jenkins --jenkins-username=you --jenkins-password=YOUR_TOKEN',
					'Add --read-only to that command to keep it inspect-only (recommended).',
					'Save. The token is part of the command (mcp-jenkins has no env option).',
				],
				credentialHelpUrl: 'https://www.jenkins.io/doc/book/system-administration/authenticating-scripted-clients/',
				safetyNote: 'The token inherits your Jenkins permissions — use a least-privilege user, not admin. It exposes build triggers and run_groovy_script (arbitrary Groovy = full controller RCE) — prefer --read-only and require approval for build/script tools. The token appears on the command line, so only add it on a trusted machine.',
				runtimeInstalls: UV_RUNTIME_INSTALLS,
			};
		case 'mcp-server-circleci':
			return {
				setupMode: 'prefill',
				transport: 'stdio',
				command: 'npx',
				args: ['-y', '@circleci/mcp-server-circleci@0.19.0'],
				note: 'Official CircleCI MCP server (pinned to the security-patched 0.19.0). Paste a personal API token below.',
				inputs: [
					{ key: 'CIRCLECI_TOKEN', label: 'CircleCI Personal API Token', help: 'Create one at app.circleci.com → Personal API Tokens.', kind: 'secret', target: 'env', example: 'CCIPAT_7Kd3f9…', required: true },
					{ key: 'CIRCLECI_BASE_URL', label: 'CircleCI Base URL (self-hosted only)', help: 'Leave blank for CircleCI cloud.', kind: 'text', target: 'env', example: 'https://circleci.example.com', required: false },
				],
				prerequisites: [
					'Node.js (AtlasMind can install it).',
					'A CircleCI account (cloud or self-hosted Server).',
				],
				credentialSteps: [
					'app.circleci.com → Personal API Tokens → Create New Token.',
					'Name it, click Add API Token, and copy it (CCIPAT_…, shown once).',
					'Paste it below.',
				],
				credentialHelpUrl: 'https://app.circleci.com/settings/user/tokens',
				safetyNote: 'The token inherits your full account permissions; tools can trigger/rerun/rollback pipelines (i.e. deploy) and read logs that may contain secrets. Treat it as a password and revoke if exposed. The upstream repo is deprecated but this version is security-patched (GHSA-8xjg-jpfh-5257).',
				runtimeInstalls: NODE_RUNTIME_INSTALLS,
			};
		case 'mcp-server-grafana':
			return {
				setupMode: 'prefill',
				transport: 'stdio',
				command: 'uvx',
				args: ['mcp-grafana'],
				note: 'Official Grafana MCP server. Enter your Grafana URL and a Viewer service-account token below.',
				inputs: [
					{ key: 'GRAFANA_URL', label: 'Grafana URL', help: 'Your Grafana base URL (Cloud or self-hosted).', kind: 'url', target: 'env', example: 'https://myorg.grafana.net', required: true },
					{ key: 'GRAFANA_SERVICE_ACCOUNT_TOKEN', label: 'Service Account Token', help: 'Create a Viewer-role service account token (starts glsa_).', kind: 'secret', target: 'env', example: 'glsa_AbCd1234…', required: true },
				],
				prerequisites: [
					'The uv / uvx runtime (AtlasMind can install it).',
					'A reachable Grafana (Cloud or self-hosted v9+).',
					'Permission to create a service account + token (Admin/Org Admin).',
				],
				credentialSteps: [
					'Grafana → Administration → Users and access → Service accounts → Add service account.',
					'Give it the Viewer role (for read-only), then Add service account token → Generate.',
					'Copy the glsa_ token (shown once) and your base URL into the fields below.',
				],
				credentialHelpUrl: 'https://grafana.com/docs/grafana/latest/administration/service-accounts/',
				safetyNote: 'The token grants Grafana API access at its assigned role — use Viewer for read-only and set an expiration. Stored in SecretStorage and passed via env.',
				runtimeInstalls: UV_RUNTIME_INSTALLS,
			};
		case 'mcp-server-prometheus':
			return {
				setupMode: 'prefill',
				transport: 'stdio',
				command: 'docker',
				args: ['run', '-i', '--rm', '--add-host=host.docker.internal:host-gateway', '-e', 'PROMETHEUS_MCP_SERVER_PROMETHEUS_URL', 'ghcr.io/tjhop/prometheus-mcp-server:latest'],
				note: 'Official Prometheus MCP server (Docker). Enter your Prometheus URL below — no auth needed for a local, unauthenticated instance.',
				inputs: [
					{ key: 'PROMETHEUS_MCP_SERVER_PROMETHEUS_URL', label: 'Prometheus server URL', help: 'For a local instance use host.docker.internal (not localhost) so the container can reach it.', kind: 'url', target: 'env', example: 'http://host.docker.internal:9090', required: true },
				],
				prerequisites: [
					'Docker installed AND running (launch Docker Desktop on Windows/macOS).',
					'A reachable Prometheus (local default http://localhost:9090 — verify in a browser first).',
				],
				credentialSteps: [
					'Confirm Prometheus loads at http://localhost:9090.',
					'Enter http://host.docker.internal:9090 (inside the container, localhost means the container itself).',
					'If no login is required, save and connect.',
				],
				credentialHelpUrl: 'https://github.com/prometheus/prometheus-mcp/blob/main/examples/http-config.yml',
				safetyNote: 'Read/query access to metrics — names and labels can leak infrastructure detail, so keep redaction on. Never add --dangerous.enable-tsdb-admin-tools. Authenticated/hosted Prometheus needs a mounted config file with this official server; for token/basic-auth use the community pab1it0/prometheus-mcp-server instead.',
				runtimeInstalls: DOCKER_RUNTIME_INSTALLS,
			};
		case 'mcp-server-jira':
			return {
				setupMode: 'prefill',
				transport: 'stdio',
				command: 'npx',
				args: ['-y', 'mcp-remote@latest', 'https://mcp.atlassian.com/v1/mcp/authv2'],
				note: 'Official Atlassian (Jira/Rovo) MCP via the mcp-remote bridge. Browser sign-in on first connect — no token to paste. Atlassian Cloud only.',
				prerequisites: [
					'An Atlassian Cloud site with Jira (not Server/Data Center).',
					'Node.js (AtlasMind can install it).',
					'A default browser for the one-time consent.',
				],
				credentialSteps: [
					'Connect — mcp-remote opens Atlassian sign-in in your browser.',
					'Review the consent (it acts with YOUR Jira permissions) and Accept.',
					'Return to VS Code. Revoke later via id.atlassian.com → Connected apps and delete ~/.mcp-auth.',
				],
				credentialHelpUrl: 'https://support.atlassian.com/atlassian-rovo-mcp-server/docs/setting-up-ides/',
				safetyNote: 'Read-write — it can create, edit, comment on, and transition Jira issues, scoped to your permissions. Review agent actions on approved sessions. The mcp-remote bridge is a community package caching the OAuth token at ~/.mcp-auth.',
				runtimeInstalls: NODE_RUNTIME_INSTALLS,
			};
		case 'mcp-server-trello':
			return {
				setupMode: 'prefill',
				transport: 'stdio',
				command: 'npx',
				args: ['-y', 'mcp-remote@0.1.38', 'https://mcp.trello.com/v1'],
				note: 'Official Trello MCP (Atlassian) via the mcp-remote bridge. Browser sign-in on first connect — no key to paste.',
				prerequisites: [
					'A Trello account (MCP is enabled by default on Premium/Enterprise; may be unavailable on Free or restricted by an admin).',
					'Node.js (AtlasMind can install it) and a default browser.',
				],
				credentialSteps: [
					'Connect — mcp-remote opens Atlassian/Trello sign-in in your browser.',
					'Pick the one Workspace to connect and Accept.',
					'Return to VS Code. Revoke later via Atlassian connected-apps and delete ~/.mcp-auth.',
				],
				credentialHelpUrl: 'https://support.atlassian.com/trello/docs/connect-trello-to-ai-assistants-with-trello-mcp/',
				safetyNote: 'Read-write within the approved workspace — it can create, move, and comment on cards. Approve only a workspace you are comfortable letting the AI modify.',
				runtimeInstalls: NODE_RUNTIME_INSTALLS,
			};
		case 'mcp-server-stripe':
			return {
				setupMode: 'prefill',
				transport: 'stdio',
				command: 'npx',
				args: ['-y', '@stripe/mcp'],
				note: 'Official Stripe MCP server. Paste a Restricted API Key (rk_…) below — use Test mode to start.',
				inputs: [
					{ key: 'STRIPE_SECRET_KEY', label: 'Stripe Restricted API Key', help: 'A restricted key (rk_…), least-privilege — never a full secret key (sk_…).', kind: 'secret', target: 'env', example: 'rk_test_51Nabc…', required: true },
				],
				prerequisites: [
					'Node.js (AtlasMind can install it).',
					'A Stripe account (free); Test mode is enough to start.',
				],
				credentialSteps: [
					'dashboard.stripe.com/apikeys → confirm Test mode is ON.',
					'Restricted keys → Create restricted key → set least-privilege (Read where needed, Write only for required actions).',
					'Create, reveal, and copy the rk_test_ key (shown once) into the field.',
				],
				credentialHelpUrl: 'https://dashboard.stripe.com/apikeys',
				safetyNote: 'Use a Restricted key (rk_…), never a full secret key (sk_…). Keep Test mode + read-mostly until trusted — a Write-scoped LIVE key can move real money. The key is stored in SecretStorage and passed via env, never in the command.',
				runtimeInstalls: NODE_RUNTIME_INSTALLS,
			};
		case 'mcp-server-openai':
			return {
				// Guided-manual: no first-party OpenAI MCP server; leading community
				// option is narrow-scope + billable credential. Flag for review.
				setupMode: 'manual',
				transport: 'stdio',
				command: 'uvx',
				args: ['openai-websearch-mcp==0.4.3'],
				note: 'OpenAI web-search via a community MCP server (pinned). Adds live web search only — AtlasMind already calls OpenAI models directly. Review before connecting.',
				inputs: [
					{ key: 'OPENAI_API_KEY', label: 'OpenAI API key', help: 'A dedicated, project-scoped key. Billable and account-wide unless scoped.', kind: 'secret', target: 'env', example: 'sk-proj-…', required: true },
					{ key: 'OPENAI_DEFAULT_MODEL', label: 'OpenAI model (optional)', help: 'Defaults to the server default.', kind: 'text', target: 'env', example: 'gpt-5-mini', required: false },
				],
				prerequisites: [
					'The uv / uvx runtime (AtlasMind can install it).',
					'An OpenAI account with active billing and a project-scoped API key.',
				],
				credentialSteps: [
					'platform.openai.com → set up Billing first.',
					'API keys → Create new secret key → name it "AtlasMind".',
					'Copy the sk- value (shown once) and paste it below.',
				],
				credentialHelpUrl: 'https://platform.openai.com/api-keys',
				safetyNote: 'No official OpenAI MCP server exists; this is a community, AI-generated package covering web search only, pinned by version. The API key is billable and account-wide unless scoped — create a dedicated key. Typosquats exist; the exact name is openai-websearch-mcp.',
				runtimeInstalls: UV_RUNTIME_INSTALLS,
			};
		default:
			return {
				setupMode: 'manual',
				transport: 'stdio',
				note: 'AtlasMind verified the catalogue or documentation reference for this preset, but no single cross-environment one-click connection command could be confirmed safely. Review the linked docs and enter the real server command or URL for your environment.',
			};
	}
}
/**
 * AtlasMind – centralised tunable constants.
 *
 * Every cap, limit, and default that was previously scattered across source
 * files now lives here so the values are discoverable, adjustable, and
 * testable from a single location.
 */

// ── Orchestrator ─────────────────────────────────────────────────

/** Maximum agentic loop iterations before forcing a stop. */
export const MAX_TOOL_ITERATIONS = 20;

/** Maximum number of tool calls accepted in a single model turn. */
export const MAX_TOOL_CALLS_PER_TURN = 8;

/** Maximum number of tool executions running in parallel. */
export const MAX_PARALLEL_TOOL_EXECUTIONS = 3;

/** Per-tool execution timeout in milliseconds. */
export const TOOL_EXECUTION_TIMEOUT_MS = 15_000;

/** Provider call timeout in milliseconds. */
export const PROVIDER_TIMEOUT_MS = 30_000;

/**
 * How long a single ACP JSON-RPC request may take. Consumed by the adapter as
 * its per-request budget; exported so the enclosing budget can be derived from
 * it rather than restated.
 */
export const ACP_REQUEST_TIMEOUT_MS = 180_000;

/**
 * Time allowed for everything an ACP prompt needs before the prompt itself:
 * spawning the agent process, `initialize`, and `session/new`.
 *
 * Generous because the first turn after an editor restart pays for a cold
 * process launch — an `npx`-resolved agent on Windows can spend tens of seconds
 * before it answers a single frame.
 */
export const ACP_HANDSHAKE_HEADROOM_MS = 60_000;

/**
 * ACP agents run a stateful subprocess and may legitimately spend time using
 * tools.
 *
 * **Derived, not restated.** This budget encloses spawn → `initialize` →
 * `session/new` → `session/prompt`, while the adapter's budget covers one frame
 * of that sequence. When the two were both 180_000 the outer timer always fired
 * first on a cold start, so a slow handshake surfaced as a bare "Provider timed
 * out after 180000ms" naming no phase, and the adapter's own message — which
 * names the method that stalled — was never the one the user saw. `acp.ts` makes
 * exactly this argument for `ACP_PROBE_TIMEOUT_MS` and the prompt path never got
 * the same treatment.
 */
export const ACP_PROVIDER_TIMEOUT_MS = ACP_REQUEST_TIMEOUT_MS + ACP_HANDSHAKE_HEADROOM_MS;

/**
 * Extra time a local model gets per billion parameters.
 *
 * `PROVIDER_TIMEOUT_MS` is a flat 30s written for a hosted endpoint, where the
 * weights are already resident and somebody else owns the GPU. A local 14B model
 * answering a 5k-token prompt does the loading and the prompt evaluation on this
 * machine, and 30s covers neither — the attempt was recorded as a timeout, the
 * endpoint quarantined, and a failover spent, for a model that was working.
 */
export const LOCAL_TIMEOUT_MS_PER_BILLION_PARAMS = 4_000;

/** Extra time a local model gets per 1,000 prompt tokens, for prompt evaluation. */
export const LOCAL_TIMEOUT_MS_PER_1K_PROMPT_TOKENS = 6_000;

/**
 * Extra time for the first attempt against a local model in this session.
 *
 * Loading weights into VRAM is a one-off cost paid by whichever turn arrives
 * first, and it is the single largest term in a cold local call. Charged only
 * until that model has answered once — see `Orchestrator.warmLocalModels`.
 */
export const LOCAL_COLD_START_TIMEOUT_MS = 60_000;

/**
 * Ceiling on a derived local timeout. A local call that has produced nothing in
 * five minutes is a stall worth failing over from, whatever the model's size.
 */
export const LOCAL_PROVIDER_MAX_TIMEOUT_MS = 300_000;

// ── Local GPU arbiter ────────────────────────────────────────────

/**
 * How long a local request may wait for GPU headroom before it is refused.
 *
 * A bound rather than an unbounded queue, because a request that never resolves
 * is a wedged editor. On expiry the turn fails over to another provider, which
 * is the right answer: the GPU is committed, so use something that is not.
 *
 * Long enough to outlast a cold model load — the commonest reason the budget is
 * briefly committed — and short enough that the turn has not already been
 * abandoned by whoever asked for it.
 */
export const LOCAL_GPU_ADMISSION_WAIT_MS = 45_000;

/**
 * Concurrent local HTTP calls allowed regardless of measured headroom.
 *
 * Two rather than one: with the residency accounting charging weights once per
 * distinct model, a same-model fan-out is nearly free, and a cap of one would
 * serialise the bootstrapper's four parallel completions — all of which route to
 * the same model — turning a one-minute step into four. Two rather than five,
 * because concurrent *generation* on one card is slower per request than
 * sequential and the scheduler's fan-out is already bounded elsewhere.
 */
export const LOCAL_GPU_MAX_CONCURRENT_REQUESTS = 2;

/**
 * Subtracted from measured free VRAM before anything is admitted.
 *
 * The limb that normally binds. Covers what the desktop will allocate while a
 * model is loading — a browser tab opening mid-load is ordinary, and a driver
 * reporting free memory a moment before something else claims it is the common
 * case rather than the pathological one.
 */
export const LOCAL_GPU_SAFETY_MARGIN_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * VRAM reserved from the card total, defining AtlasMind's own ceiling.
 *
 * **Not an OS reserve.** The desktop is protected by measuring *free* memory,
 * which already accounts for it — on the reference machine, 9.2 GB of a 24 GB
 * card was in use with no model loaded. This is the second limb: a cap on how
 * much of the card AtlasMind may occupy at once, which keeps binding as its own
 * footprint grows.
 *
 * The naive form of that limb, `total − reserve`, is a constant and therefore
 * inert the moment anything is loaded: the measured limb is always lower. It has
 * to be `total − reserve − whatAtlasMindHolds` to mean anything.
 */
export const LOCAL_GPU_RESERVE_BYTES = 3 * 1024 * 1024 * 1024;

/**
 * Distinct models AtlasMind may hold per endpoint when VRAM is unmeasurable.
 *
 * The degraded mode, on AMD, Intel, Apple, or any machine without `nvidia-smi`.
 * Capping *residency* rather than concurrency is the whole point: Ollama holds a
 * model for five minutes after a request, so serialising requests alone would
 * leave three sequential calls to three models with all three resident.
 */
export const LOCAL_GPU_MAX_OWNED_RESIDENT_MODELS = 1;

/** How long a residency reading is reused before the runtimes are asked again. */
export const LOCAL_GPU_RESIDENCY_POLL_MS = 5_000;

/** Number of retries for transient provider failures. */
export const MAX_PROVIDER_RETRIES = 2;

/**
 * Hard per-turn ceiling across initial selection, capability re-routing,
 * escalation, and provider failover. A spend backstop, not a policy: the
 * budgets below are what normally stops a turn.
 */
export const MAX_TASK_MODEL_ATTEMPTS = 5;

/**
 * Provider-failover attempts allowed in one turn, counted separately from
 * escalation.
 *
 * One shared counter made an outage compete with a quality upgrade for the same
 * budget, and the escalation is the discretionary half: a turn that escalated
 * once had a single attempt left to survive a provider failure. Failover is
 * what keeps a turn alive when an endpoint dies, so it gets its own budget.
 */
export const MAX_TASK_FAILOVER_ATTEMPTS = 3;

/**
 * Consecutive hard failures before an execution endpoint is quarantined for
 * later turns as well as the current one.
 *
 * Turn-local circuit state is discarded when the turn ends, so an agent that
 * has just failed twice is still first pick on the next message. Two failures
 * rather than one: a single blip should not cost the user their preferred
 * endpoint for ten minutes.
 */
export const ENDPOINT_QUARANTINE_THRESHOLD = 2;

/**
 * How long a quarantined endpoint stays excluded from routing. Longer than
 * `MODEL_FAILURE_TTL_MS` because the subject is a process rather than a model:
 * a crashed ACP agent or a stopped local server is not usually well again in
 * five minutes, and a quarantine that lifts too early re-enters the failure.
 */
export const ENDPOINT_QUARANTINE_TTL_MS = 10 * 60 * 1000;

/** Exponential backoff base for provider retries in milliseconds. */
export const PROVIDER_RETRY_BASE_DELAY_MS = 400;

// ── Planner ──────────────────────────────────────────────────────

/** Maximum subtasks the planner will accept from a single LLM response. */
export const MAX_SUBTASKS = 20;

// ── Task Scheduler ───────────────────────────────────────────────

/** Maximum concurrent subtask executions per batch within the scheduler. */
export const MAX_SCHEDULER_CONCURRENCY = 5;

// ── Mission Loop ─────────────────────────────────────────────────
// Defaults for the autonomous goal-seeking loop (MissionRunner). Each is a
// HARD stop: the loop halts when any is exceeded. Safety-first — keep these
// conservative so an unattended loop cannot run away with budget or time.

/** Default maximum loop iterations before forcing a stop. */
export const DEFAULT_MISSION_MAX_ITERATIONS = 8;

/** Default hard ceiling on cumulative USD cost across a mission. */
export const DEFAULT_MISSION_MAX_COST_USD = 5;

/** Default hard ceiling on cumulative (input + output) tokens across a mission. */
export const DEFAULT_MISSION_MAX_TOKENS = 2_000_000;

/** Default hard ceiling on mission wall-clock duration in milliseconds (30 min). */
export const DEFAULT_MISSION_MAX_DURATION_MS = 30 * 60 * 1000;

/** Default number of consecutive no-progress iterations before the loop stops. */
export const DEFAULT_MISSION_MAX_NO_PROGRESS = 2;

/** Default checkpoint cadence — pause for approval every N iterations. */
export const DEFAULT_MISSION_CHECKPOINT_EVERY_N = 3;

/**
 * Default budget fractions (0..1) at which the loop forces an approval
 * checkpoint the first time cumulative spend crosses each threshold.
 */
export const DEFAULT_MISSION_CHECKPOINT_BUDGET_FRACTION = 0.75;

/**
 * Minimum goal-evaluator confidence required to accept an `achieved` verdict and
 * stop the loop successfully. Below this the loop treats the goal as not yet met
 * and keeps iterating — a low-confidence evaluator can never falsely "win".
 */
export const DEFAULT_MISSION_GOAL_CONFIDENCE = 0.7;

/** Maximum number of mission runs persisted by MissionRegistry. */
export const MAX_MISSION_RECORDS = 25;

/** Maximum characters retained per persisted iteration synthesis/output (audit trim). */
export const MAX_MISSION_TEXT_PERSIST = 4_000;

// ── Memory ───────────────────────────────────────────────────────

/** Dimension length for hashed mini-embeddings. */
export const EMBEDDING_DIMENSIONS = 96;

/** Hard ceiling on the number of entries in the in-memory SSOT index. */
export const MAX_MEMORY_ENTRIES = 1_000;

/** Maximum byte length for a single memory entry's content field. */
export const MAX_ENTRY_CONTENT_BYTES = 64_000;

/** Maximum characters when rendering a memory snippet for context. */
export const MAX_SNIPPET_LENGTH = 4_000;

/** Maximum character length for a memory entry title. */
export const MAX_TITLE_LENGTH = 200;

/** Maximum number of tags per memory entry. */
export const MAX_TAGS = 12;

/** Maximum character length per tag. */
export const MAX_TAG_LENGTH = 50;

/** Maximum number of results returned from a single memory query. */
export const MAX_QUERY_RESULTS = 50;

// ── Memory Scanner ───────────────────────────────────────────────

/** Maximum byte length for a memory entry accepted by the scanner. */
export const MAX_SCANNER_ENTRY_BYTES = 32_000;

// ── Skills ───────────────────────────────────────────────────────

/** Maximum response bytes for the web-fetch skill. */
export const MAX_WEB_FETCH_BODY_BYTES = 64_000;

/** Cap on memory-query skill results. */
export const MAX_MEMORY_QUERY_RESULTS_CAP = 50;

/** Maximum characters for memory-write snippet input. */
export const MAX_MEMORY_WRITE_SNIPPET = 4_000;

// ── Chat ─────────────────────────────────────────────────────────

/** Maximum number of image attachments per chat turn. */
export const MAX_IMAGE_ATTACHMENTS = 4;

/** Maximum byte size for a single image attachment. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** Default output token budget for Atlas chat completions when callers do not specify one. */
export const DEFAULT_CHAT_MAX_TOKENS = 2_400;

/** Maximum continuation requests after a provider truncates a reply with `finishReason: 'length'`. */
export const MAX_COMPLETION_CONTINUATIONS = 2;

// ── Checkpoint Manager ───────────────────────────────────────────

/** Maximum number of automatic checkpoints retained per workspace. */
export const MAX_CHECKPOINTS = 10;

/**
 * Maximum file size (in bytes) for a single file snapshot stored in a
 * checkpoint.  Files larger than this are skipped to prevent the checkpoint
 * manager from loading large binaries (node_modules, build artefacts, etc.)
 * into memory.  512 KB is large enough to cover any realistic source file
 * while bounding per-checkpoint memory to a few MB.
 */
export const CHECKPOINT_MAX_FILE_BYTES = 512 * 1024;

/**
 * Maximum number of messages that can accumulate in the agentic loop's
 * in-flight `messages[]` array before the oldest tool-result pairs are
 * pruned to prevent silent context-window overflow.  The initial system +
 * user messages are always preserved.
 */
export const MAX_LOOP_MESSAGES = 60;

// ── Project Run History ──────────────────────────────────────────

/** Maximum number of project runs persisted in globalState. */
export const MAX_PROJECT_RUNS = 40;

// ── Tool Webhook Dispatcher ──────────────────────────────────────

/** Default timeout for outbound webhook delivery in milliseconds. */
export const DEFAULT_WEBHOOK_TIMEOUT_MS = 5_000;

/** Maximum webhook delivery history items. */
export const MAX_WEBHOOK_HISTORY_ITEMS = 50;

/** Maximum delivery attempts per webhook payload. */
export const MAX_WEBHOOK_DELIVERY_ATTEMPTS = 3;

/** Exponential backoff base for webhook retry in milliseconds. */
export const WEBHOOK_RETRY_BASE_DELAY_MS = 300;

// ── MCP Client ───────────────────────────────────────────────────

/** Per-tool-call timeout for MCP server invocations in milliseconds. */
export const MCP_TOOL_CALL_TIMEOUT_MS = 120_000;

// ── Bootstrap ────────────────────────────────────────────────────

/** Maximum byte length for a file during project import scanning. */
export const MAX_IMPORT_FILE_BYTES = 32_000;

/** Maximum snippet characters for a single imported file summary. */
export const MAX_IMPORT_SNIPPET = 3_500;

// ── Model Router ─────────────────────────────────────────────────

/**
 * Default context window (tokens) assumed for local models when the endpoint
 * does not return metadata.  Most modern open-weights models support at least
 * 32K tokens; using 8192 (the old default) caused the router to under-allocate
 * context for capable models.
 */
export const LOCAL_MODEL_DEFAULT_CONTEXT_WINDOW = 32_768;

/**
 * Budget-tier price thresholds (USD per 1K tokens, input + output combined).
 * Models at or below BUDGET_TIER_CHEAP_THRESHOLD_USD are classified "cheap";
 * models between the two thresholds are "balanced"; above is "expensive".
 *
 * These values reflect the mid-2026 model landscape.  As commodity pricing
 * compresses, adjust both thresholds together so the tier distribution stays
 * roughly 33%/33%/33% across the live catalog.
 *
 * Calibration date: 2026-06-08
 */
export const BUDGET_TIER_CHEAP_THRESHOLD_USD = 0.0015;
export const BUDGET_TIER_BALANCED_THRESHOLD_USD = 0.008;

/**
 * Context-window size gates used by the model scorer to reward or penalise
 * models based on context capacity relative to a task's expected data volume.
 *
 * CONTEXT_GATE_SMALL: below this is penalised on high-reasoning tasks.
 * CONTEXT_GATE_MEDIUM: below this is penalised on medium-reasoning tasks.
 * CONTEXT_GATE_LARGE: models at or above this qualify for the "considered"
 *   speed tier heuristic when paired with high reasoning depth.
 * CONTEXT_GATE_FAST: models at or below this qualify for the "fast" tier
 *   heuristic when reasoning depth is zero.
 *
 * Calibration date: 2026-06-08 (typical range: 8K – 2M tokens)
 */
export const CONTEXT_GATE_SMALL = 32_000;
export const CONTEXT_GATE_MEDIUM = 16_000;
export const CONTEXT_GATE_LARGE = 100_000;
export const CONTEXT_GATE_FAST = 128_000;

/**
 * Model failure TTL in milliseconds.  A model recorded as failed is excluded
 * from routing until this duration has elapsed, after which the failure record
 * is cleared automatically and the model may be retried.  Transient network
 * errors should recover within a few minutes; setting this to 5 minutes avoids
 * a permanent exclusion caused by a momentary blip.
 */
export const MODEL_FAILURE_TTL_MS = 5 * 60 * 1000;

/**
 * Subscription quota conservation threshold (0–1 fraction).  When the
 * remaining quota fraction drops below this value the router blends the
 * subscription effective cost toward the listed pay-per-token price so
 * cheaper models become relatively more attractive, conserving premium quota.
 */
export const QUOTA_CONSERVATION_THRESHOLD = 0.3;

/**
 * Tokens to reserve for model output when clamping maxTokens against a
 * model's context window.  Prevents the input prompt from consuming the
 * entire context window and leaving no room for the response.
 */
export const CONTEXT_SAFE_OUTPUT_MARGIN = 1_024;

/**
 * Weight applied to model-outcome feedback when adjusting per-model preference
 * scores.  Kept small (0.12) so a single failure doesn't permanently exclude
 * a model — the Laplace-smoothed preference score requires several consistent
 * outcomes before it meaningfully shifts routing decisions.
 */
export const PERFORMANCE_OUTCOME_WEIGHT = 0.12;

// ── Agentic Resource Discovery (ARD) ─────────────────────────────

/** Byte cap for a fetched `ai-catalog.json` manifest or `/search` response. */
export const MAX_ARD_RESPONSE_BYTES = 512 * 1024;

/** Maximum entries accepted from a single catalog/search response. */
export const MAX_ARD_ENTRIES = 500;

/** Maximum referral hops followed during a federated search (loop / SSRF guard). */
export const MAX_ARD_FEDERATION_DEPTH = 2;

/** Maximum nested `application/ai-catalog+json` expansions when fetching a manifest. */
export const MAX_ARD_CATALOG_DEPTH = 2;

/** Default request timeout for ARD discovery calls in milliseconds. */
export const DEFAULT_ARD_REQUEST_TIMEOUT_MS = 15_000;

/** Default maximum results surfaced from a discovery search. */
export const DEFAULT_ARD_MAX_RESULTS = 10;

/** Well-known path for a publisher's static ARD catalog. */
export const ARD_WELL_KNOWN_PATH = '/.well-known/ai-catalog.json';

/** Manifest `specVersion` AtlasMind emits when exporting its own catalog. */
export const ARD_SPEC_VERSION = '1.0';

/** Pattern every ARD resource identifier must match (`urn:ai:<publisher>:...`). */
export const ARD_URN_PATTERN = /^urn:ai:[a-z0-9.-]+:.+/i;

/**
 * Default Agent Finders (ARD discovery services) seeded into the ArdRegistry.
 * Mirrors the ards-project connectors `agent-finders.json`. All ship DISABLED —
 * AtlasMind performs no outbound discovery traffic until the user opts in. Each
 * URL points at the finder's `POST /search` endpoint.
 */
export const DEFAULT_ARD_FINDERS: Array<Omit<ArdDiscoveryEndpoint, 'id'>> = [
	{
		name: 'GitHub Agent Finder',
		url: 'https://agentfinder.github.com/api/v1/search',
		kind: 'registry',
		enabled: false,
		builtIn: true,
	},
	{
		name: 'Hugging Face Discover',
		url: 'https://huggingface-hf-discover.hf.space/search',
		kind: 'registry',
		enabled: false,
		builtIn: true,
	},
];
