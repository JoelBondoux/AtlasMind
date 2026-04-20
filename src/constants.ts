// ── Recommended MCP Servers ─────────────────────────────────────────────

export type RecommendedMcpServerProvenance = 'official' | 'community' | 'registry' | 'archived';
export type RecommendedMcpSetupMode = 'prefill' | 'manual';

export interface RecommendedMcpServer {
	id: string;
	name: string;
	description: string;
	installUrl: string;
	docsUrl: string;
	provenance: RecommendedMcpServerProvenance;
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
	url?: string;
	note: string;
	runtimeInstalls?: Partial<Record<SupportedRuntimePlatform, RecommendedMcpRuntimeInstall[]>>;
}

const MCP_REGISTRY_URL = 'https://registry.modelcontextprotocol.io/';

function inferRecommendedMcpServerProvenance(server: Omit<RecommendedMcpServer, 'provenance'>): RecommendedMcpServerProvenance {
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
		|| combined.includes('npmjs.com/package/@azure/mcp')
	) {
		return 'official';
	}

	return 'community';
}

/**
 * Recommended MCP servers for software developers. Used in the Settings Dashboard catalogue.
 * Each entry uses a verified working documentation page or the official MCP registry/catalogue as a safe fallback.
 */
const RECOMMENDED_MCP_SERVER_CATALOGUE: Array<Omit<RecommendedMcpServer, 'provenance'>> = [
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
		case 'mcp-server-postgres':
			return {
				setupMode: 'manual',
				transport: 'stdio',
				note: 'Confirmed example command: npx -y @modelcontextprotocol/server-postgres <postgresql://...>. Replace the database URL with your real connection string before saving.',
			};
		case 'mcp-server-sentry':
			return {
				setupMode: 'manual',
				transport: 'stdio',
				note: 'Confirmed example command: uvx mcp-server-sentry. You still need the required Sentry authentication environment variables for your account.',
			};
		case 'mcp-server-slack':
			return {
				setupMode: 'manual',
				transport: 'stdio',
				note: 'Confirmed example command: npx -y @zencoderai/slack-mcp-server. You must also provide Slack bot credentials such as SLACK_BOT_TOKEN and SLACK_TEAM_ID.',
			};
		case 'mcp-server-github':
			return {
				setupMode: 'manual',
				transport: 'http',
				note: 'Confirmed remote endpoint exists, but AtlasMind does not yet autofill the required OAuth or PAT configuration for the GitHub MCP server.',
			};
		case 'mcp-server-entra':
			return {
				setupMode: 'manual',
				transport: 'http',
				note: 'Confirmed Microsoft enterprise MCP flow exists, but it requires tenant-specific authentication and consent setup before AtlasMind can connect.',
			};
		case 'mcp-server-m365':
			return {
				setupMode: 'manual',
				transport: 'http',
				note: 'Microsoft 365 MCP is exposed through connector and enterprise-specific flows rather than one universal AtlasMind-ready command. Follow the linked documentation for your tenant or connector path.',
			};
		case 'mcp-server-shopify':
		case 'mcp-server-woocommerce':
		case 'mcp-server-wordpress':
		case 'mcp-server-webflow':
		case 'mcp-server-wix':
		case 'mcp-server-youtube':
		case 'mcp-server-twitch':
		case 'mcp-server-linkedin':
		case 'mcp-server-meta':
		case 'mcp-server-x':
			return {
				setupMode: 'manual',
				transport: 'http',
				note: 'This AtlasMind catalogue preset covers a hosted platform integration that normally requires OAuth, API tokens, or site-specific app credentials. Review the linked vendor docs, then paste the real MCP server command or endpoint for your account before saving.',
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

/** Number of retries for transient provider failures. */
export const MAX_PROVIDER_RETRIES = 2;

/** Exponential backoff base for provider retries in milliseconds. */
export const PROVIDER_RETRY_BASE_DELAY_MS = 400;

// ── Planner ──────────────────────────────────────────────────────

/** Maximum subtasks the planner will accept from a single LLM response. */
export const MAX_SUBTASKS = 20;

// ── Task Scheduler ───────────────────────────────────────────────

/** Maximum concurrent subtask executions per batch within the scheduler. */
export const MAX_SCHEDULER_CONCURRENCY = 5;

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
