import type {
  ClientWebsiteIntake,
  WebsiteAutomation,
  WebsiteHostingEnvironment,
  WebsitePagePlan,
  WebsitePlatformTarget,
  WebsiteWorkspaceConfig,
  WebsiteWorkStatus,
} from '../types.js';

/**
 * Renderer-neutral editing model for Interface Studio.
 *
 * The hierarchy deliberately describes intent rather than HTML elements,
 * native view classes, or deployment concepts. Target-specific information
 * belongs to an adapter so the same project can later drive other renderers.
 */

export type InterfaceStudioEntityKind = 'project' | 'flow' | 'surface' | 'node';

export type InterfaceStudioIdKind =
  | InterfaceStudioEntityKind
  | 'visual-language'
  | 'token'
  | 'preview'
  | 'adapter'
  | 'selection';

export type InterfaceStudioNodeKind =
  | 'frame'
  | 'region'
  | 'component'
  | 'content'
  | 'media'
  | 'control'
  | 'custom';

export interface InterfaceStudioNode {
  readonly id: string;
  readonly name: string;
  readonly kind: InterfaceStudioNodeKind;
  readonly role?: string;
  readonly description?: string;
  readonly tokenRefs: readonly string[];
  readonly children: readonly InterfaceStudioNode[];
}

export interface InterfaceStudioSurface {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly nodes: readonly InterfaceStudioNode[];
}

export interface InterfaceStudioFlowTransition {
  readonly id: string;
  readonly fromSurfaceId: string;
  readonly toSurfaceId: string;
  readonly description?: string;
}

export interface InterfaceStudioFlow {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly surfaces: readonly InterfaceStudioSurface[];
  readonly transitions: readonly InterfaceStudioFlowTransition[];
}

export type InterfaceStudioSemanticTokenCategory =
  | 'color'
  | 'typography'
  | 'spacing'
  | 'radius'
  | 'elevation'
  | 'motion'
  | 'custom';

/** A semantic decision; the value is intentionally not CSS-shaped. */
export interface InterfaceStudioSemanticToken {
  readonly id: string;
  readonly name: string;
  readonly category: InterfaceStudioSemanticTokenCategory;
  readonly role: string;
  readonly value: string;
  readonly description?: string;
}

export interface InterfaceStudioVisualLanguage {
  readonly id: string;
  readonly name: string;
  readonly direction: string;
  readonly tone: string;
  readonly accessibilityIntent: string;
  readonly tokens: readonly InterfaceStudioSemanticToken[];
  readonly componentGuidance: readonly string[];
}

export type InterfaceStudioPreviewFormFactor = 'compact' | 'medium' | 'expanded' | 'custom';
export type InterfaceStudioPreviewOrientation = 'portrait' | 'landscape' | 'adaptive';
export type InterfaceStudioInputMode = 'touch' | 'pointer' | 'keyboard' | 'voice' | 'controller';

export interface InterfaceStudioPreviewProfile {
  readonly id: string;
  readonly name: string;
  readonly formFactor: InterfaceStudioPreviewFormFactor;
  readonly orientation: InterfaceStudioPreviewOrientation;
  readonly viewport: {
    readonly inlineSize: number;
    readonly blockSize: number;
    readonly unit: 'px';
  };
  readonly inputModes: readonly InterfaceStudioInputMode[];
}

export interface InterfaceStudioAdapterSelectionMetadata<TMetadata = unknown> {
  readonly entityKind: InterfaceStudioEntityKind;
  readonly entityId: string;
  readonly metadata: TMetadata;
}

export interface InterfaceStudioTargetAdapter<TMetadata = unknown, TSelectionMetadata = unknown> {
  readonly id: string;
  readonly label: string;
  readonly targetKind: string;
  readonly renderer: string;
  readonly capabilities: readonly string[];
  readonly metadata: TMetadata;
  readonly selectionMetadata: readonly InterfaceStudioAdapterSelectionMetadata<TSelectionMetadata>[];
}

export interface InterfaceStudioProject<TAdapterMetadata = unknown, TSelectionMetadata = unknown> {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly updatedAt: string;
  readonly flows: readonly InterfaceStudioFlow[];
  readonly visualLanguage: InterfaceStudioVisualLanguage;
  readonly previewProfiles: readonly InterfaceStudioPreviewProfile[];
  readonly targetAdapters: readonly InterfaceStudioTargetAdapter<TAdapterMetadata, TSelectionMetadata>[];
}

export interface WebsiteWorkspaceV1SurfaceAdapterMetadata {
  readonly surfaceId: string;
  readonly pageId: string;
  readonly sourcePage: WebsitePagePlan;
  readonly route: {
    readonly path: string;
  };
  readonly template: string;
  readonly workStatus: {
    readonly wireframe: WebsiteWorkStatus;
    readonly design: WebsiteWorkStatus;
    readonly content: WebsiteWorkStatus;
  };
  readonly seo: {
    readonly status: WebsiteWorkStatus;
  };
  readonly notes: {
    readonly wireframe: string;
    readonly design: string;
  };
}

/** Lossless website-specific payload owned by the v1 target adapter. */
export interface WebsiteWorkspaceV1AdapterMetadata {
  readonly source: {
    readonly schema: 'atlasmind.website-workspace';
    readonly version: 1;
    readonly updatedAt: string;
  };
  readonly sourceSnapshot: WebsiteWorkspaceConfig;
  readonly surfaces: readonly WebsiteWorkspaceV1SurfaceAdapterMetadata[];
  readonly delivery: {
    readonly platforms: readonly WebsitePlatformTarget[];
    readonly hostingEnvironments: readonly WebsiteHostingEnvironment[];
  };
  readonly automations: readonly WebsiteAutomation[];
}

export type WebsiteWorkspaceV1SelectionMetadata =
  | {
      readonly sourceVersion: 1;
      readonly updatedAt: string;
      readonly intake: ClientWebsiteIntake;
    }
  | {
      readonly orderedPageIds: readonly string[];
    }
  | WebsiteWorkspaceV1SurfaceAdapterMetadata
  | {
      readonly surfaceId: string;
      readonly pageId: string;
      readonly section: {
        readonly index: number;
        readonly label: string;
      };
    };

export interface WebsiteWorkspaceProjectionOptions {
  /** Stable caller-owned source identity, normally the workspace-relative SSOT path. */
  readonly sourceKey?: string;
  readonly projectId?: string;
  readonly flowId?: string;
  readonly adapterId?: string;
  readonly previewProfiles?: readonly InterfaceStudioPreviewProfile[];
}

export const DEFAULT_INTERFACE_STUDIO_PREVIEW_PROFILES: readonly InterfaceStudioPreviewProfile[] = [
  {
    id: createStableInterfaceStudioId('preview', 'compact'),
    name: 'Compact touch',
    formFactor: 'compact',
    orientation: 'portrait',
    viewport: { inlineSize: 390, blockSize: 844, unit: 'px' },
    inputModes: ['touch'],
  },
  {
    id: createStableInterfaceStudioId('preview', 'medium'),
    name: 'Medium touch',
    formFactor: 'medium',
    orientation: 'portrait',
    viewport: { inlineSize: 768, blockSize: 1024, unit: 'px' },
    inputModes: ['touch', 'keyboard'],
  },
  {
    id: createStableInterfaceStudioId('preview', 'expanded'),
    name: 'Expanded pointer',
    formFactor: 'expanded',
    orientation: 'landscape',
    viewport: { inlineSize: 1440, blockSize: 900, unit: 'px' },
    inputModes: ['pointer', 'keyboard'],
  },
];

/**
 * Builds a readable deterministic ID. A hash of the unnormalised, length-framed
 * parts prevents values such as "A B" and "a-b" sharing an ID.
 */
export function createStableInterfaceStudioId(
  kind: InterfaceStudioIdKind,
  ...parts: readonly (string | number)[]
): string {
  const rawParts = [kind, ...parts].map(part => String(part));
  const hashInput = rawParts.map(part => `${part.length}:${part}`).join('|');
  const readable = parts
    .map(part => normalizeIdPart(String(part)))
    .filter(Boolean)
    .join('-')
    .slice(0, 56) || 'untitled';
  const digest = fnv1a32(hashInput).toString(36).padStart(7, '0');
  return `interface-${normalizeIdPart(kind)}-${readable}-${digest}`;
}

export function projectWebsiteWorkspaceToInterfaceStudio(
  config: WebsiteWorkspaceConfig,
  options: WebsiteWorkspaceProjectionOptions = {},
): InterfaceStudioProject<WebsiteWorkspaceV1AdapterMetadata, WebsiteWorkspaceV1SelectionMetadata> {
  // Derive everything from an independent clone so frozen callers are valid and
  // no mutable reference from the legacy object escapes into the projection.
  const sourceSnapshot = cloneJsonLike(config);
  const sourceKey = options.sourceKey?.trim() || 'project_memory/domain/website.json';
  const projectId = options.projectId?.trim()
    || createStableInterfaceStudioId('project', sourceKey);
  const flowId = options.flowId?.trim()
    || createStableInterfaceStudioId('flow', projectId, 'primary-experience');
  const adapterId = options.adapterId?.trim()
    || createStableInterfaceStudioId('adapter', projectId, 'website-workspace-v1');
  const visualLanguage = projectVisualLanguage(sourceSnapshot, projectId);
  const surfaceKeyOccurrences = new Map<string, number>();
  const surfaceMetadata: WebsiteWorkspaceV1SurfaceAdapterMetadata[] = [];
  const selectionMetadata: InterfaceStudioAdapterSelectionMetadata<WebsiteWorkspaceV1SelectionMetadata>[] = [];

  const surfaces = sourceSnapshot.pages.map((page, pageIndex): InterfaceStudioSurface => {
    const sourceIdentity = page.id.trim() || page.title.trim() || `surface-${pageIndex + 1}`;
    const occurrence = nextOccurrence(surfaceKeyOccurrences, sourceIdentity);
    const surfaceId = createStableInterfaceStudioId('surface', projectId, sourceIdentity, occurrence);
    const sectionOccurrences = new Map<string, number>();
    const nodes = page.sections.map((section, sectionIndex): InterfaceStudioNode => {
      const sectionIdentity = section.trim() || `region-${sectionIndex + 1}`;
      const sectionOccurrence = nextOccurrence(sectionOccurrences, sectionIdentity);
      const nodeId = createStableInterfaceStudioId(
        'node',
        surfaceId,
        sectionIdentity,
        sectionOccurrence,
      );
      selectionMetadata.push({
        entityKind: 'node',
        entityId: nodeId,
        metadata: {
          surfaceId,
          pageId: page.id,
          section: {
            index: sectionIndex,
            label: section,
          },
        },
      });
      return {
        id: nodeId,
        name: section || `Region ${sectionIndex + 1}`,
        kind: 'region',
        role: 'section',
        tokenRefs: [],
        children: [],
      };
    });
    const adapterSurface: WebsiteWorkspaceV1SurfaceAdapterMetadata = {
      surfaceId,
      pageId: page.id,
      sourcePage: cloneJsonLike(page),
      route: { path: page.slug },
      template: page.template,
      workStatus: {
        wireframe: page.wireframeStatus,
        design: page.designStatus,
        content: page.contentStatus,
      },
      seo: { status: page.seoStatus },
      notes: {
        wireframe: page.wireframeNotes,
        design: page.designNotes,
      },
    };
    surfaceMetadata.push(adapterSurface);
    selectionMetadata.push({
      entityKind: 'surface',
      entityId: surfaceId,
      metadata: adapterSurface,
    });
    return {
      id: surfaceId,
      name: page.title || `Surface ${pageIndex + 1}`,
      description: page.purpose,
      nodes,
    };
  });

  const flow: InterfaceStudioFlow = {
    id: flowId,
    name: 'Primary experience',
    description: sourceSnapshot.intake.goals[0] || sourceSnapshot.intake.summary,
    surfaces,
    // WebsiteWorkspaceConfig v1 stores page order, but no evidence-backed
    // navigation graph. Inventing transitions here would turn order into intent.
    transitions: [],
  };
  selectionMetadata.unshift(
    {
      entityKind: 'project',
      entityId: projectId,
      metadata: {
        sourceVersion: 1,
        updatedAt: sourceSnapshot.updatedAt,
        intake: cloneJsonLike(sourceSnapshot.intake),
      },
    },
    {
      entityKind: 'flow',
      entityId: flowId,
      metadata: {
        orderedPageIds: sourceSnapshot.pages.map(page => page.id),
      },
    },
  );

  const adapterMetadata: WebsiteWorkspaceV1AdapterMetadata = {
    source: {
      schema: 'atlasmind.website-workspace',
      version: 1,
      updatedAt: sourceSnapshot.updatedAt,
    },
    sourceSnapshot,
    surfaces: surfaceMetadata,
    delivery: {
      platforms: cloneJsonLike(sourceSnapshot.platforms),
      hostingEnvironments: cloneJsonLike(sourceSnapshot.hostingEnvironments),
    },
    automations: cloneJsonLike(sourceSnapshot.automations),
  };

  return {
    schemaVersion: 1,
    id: projectId,
    name: sourceSnapshot.intake.projectName
      || sourceSnapshot.intake.clientName
      || 'Untitled interface',
    description: sourceSnapshot.intake.summary,
    updatedAt: sourceSnapshot.updatedAt,
    flows: [flow],
    visualLanguage,
    previewProfiles: cloneJsonLike(
      options.previewProfiles || DEFAULT_INTERFACE_STUDIO_PREVIEW_PROFILES,
    ),
    targetAdapters: [{
      id: adapterId,
      label: 'Website workspace v1',
      targetKind: 'web',
      renderer: 'website-workspace-v1',
      capabilities: [
        'route-metadata',
        'search-review',
        'delivery-planning',
        'automation-planning',
      ],
      metadata: adapterMetadata,
      selectionMetadata,
    }],
  };
}

export interface InterfaceStudioSelection {
  readonly flowId?: string;
  readonly surfaceId?: string;
  readonly nodeId?: string;
}

export interface InterfaceStudioSelectionPathItem {
  readonly kind: InterfaceStudioEntityKind;
  readonly id: string;
  readonly name: string;
}

export interface InterfaceStudioResolvedSelection<
  TAdapterMetadata = unknown,
  TSelectionMetadata = unknown,
> {
  readonly kind: InterfaceStudioEntityKind;
  readonly id: string;
  readonly entity:
    | InterfaceStudioProject<TAdapterMetadata, TSelectionMetadata>
    | InterfaceStudioFlow
    | InterfaceStudioSurface
    | InterfaceStudioNode;
  readonly selection: InterfaceStudioSelection;
  readonly path: readonly InterfaceStudioSelectionPathItem[];
}

export interface InterfaceStudioSelectionContext {
  readonly contextId: string;
  readonly project: {
    readonly id: string;
    readonly name: string;
    readonly description: string;
  };
  readonly subject: {
    readonly kind: InterfaceStudioEntityKind;
    readonly id: string;
    readonly name: string;
    readonly description?: string;
    readonly role?: string;
  };
  readonly path: readonly InterfaceStudioSelectionPathItem[];
  readonly children: readonly {
    readonly kind: InterfaceStudioEntityKind;
    readonly id: string;
    readonly name: string;
    readonly role?: string;
  }[];
  readonly visualLanguage: {
    readonly id: string;
    readonly direction: string;
    readonly tone: string;
    readonly accessibilityIntent: string;
    readonly componentGuidance: readonly string[];
    readonly tokens: readonly InterfaceStudioSemanticToken[];
  };
  readonly previewProfiles: readonly InterfaceStudioPreviewProfile[];
  readonly adapterMetadata: readonly {
    readonly adapterId: string;
    readonly label: string;
    readonly targetKind: string;
    readonly renderer: string;
    readonly metadata: unknown;
  }[];
}

/** Resolve the deepest requested entity in stable project order. */
export function resolveInterfaceStudioSelection<TAdapterMetadata, TSelectionMetadata>(
  project: InterfaceStudioProject<TAdapterMetadata, TSelectionMetadata>,
  selection: InterfaceStudioSelection = {},
): InterfaceStudioResolvedSelection<TAdapterMetadata, TSelectionMetadata> | undefined {
  const projectPath: InterfaceStudioSelectionPathItem[] = [{
    kind: 'project',
    id: project.id,
    name: project.name,
  }];

  if (selection.nodeId !== undefined) {
    for (const flow of project.flows) {
      if (selection.flowId !== undefined && selection.flowId !== flow.id) {
        continue;
      }
      for (const surface of flow.surfaces) {
        if (selection.surfaceId !== undefined && selection.surfaceId !== surface.id) {
          continue;
        }
        const nodePath = findNodePath(surface.nodes, selection.nodeId);
        if (nodePath !== undefined) {
          const node = nodePath[nodePath.length - 1]!;
          return {
            kind: 'node',
            id: node.id,
            entity: node,
            selection: { flowId: flow.id, surfaceId: surface.id, nodeId: node.id },
            path: [
              ...projectPath,
              pathItem('flow', flow),
              pathItem('surface', surface),
              ...nodePath.map(item => pathItem('node', item)),
            ],
          };
        }
      }
    }
    return undefined;
  }

  if (selection.surfaceId !== undefined) {
    for (const flow of project.flows) {
      if (selection.flowId !== undefined && selection.flowId !== flow.id) {
        continue;
      }
      const surface = flow.surfaces.find(item => item.id === selection.surfaceId);
      if (surface !== undefined) {
        return {
          kind: 'surface',
          id: surface.id,
          entity: surface,
          selection: { flowId: flow.id, surfaceId: surface.id },
          path: [...projectPath, pathItem('flow', flow), pathItem('surface', surface)],
        };
      }
    }
    return undefined;
  }

  if (selection.flowId !== undefined) {
    const flow = project.flows.find(item => item.id === selection.flowId);
    if (flow === undefined) {
      return undefined;
    }
    return {
      kind: 'flow',
      id: flow.id,
      entity: flow,
      selection: { flowId: flow.id },
      path: [...projectPath, pathItem('flow', flow)],
    };
  }

  return {
    kind: 'project',
    id: project.id,
    entity: project,
    selection: {},
    path: projectPath,
  };
}

/** Build bounded, JSON-safe selection context for a conversational editor. */
export function buildInterfaceStudioSelectionContext<TAdapterMetadata, TSelectionMetadata>(
  project: InterfaceStudioProject<TAdapterMetadata, TSelectionMetadata>,
  selection: InterfaceStudioSelection = {},
): InterfaceStudioSelectionContext | undefined {
  const resolved = resolveInterfaceStudioSelection(project, selection);
  if (resolved === undefined) {
    return undefined;
  }
  const entity = resolved.entity;
  const nodeTokenRefs = resolved.kind === 'node'
    ? (entity as InterfaceStudioNode).tokenRefs
    : [];
  const tokens = nodeTokenRefs.length > 0
    ? project.visualLanguage.tokens.filter(token => nodeTokenRefs.includes(token.id))
    : project.visualLanguage.tokens;
  const subject = {
    kind: resolved.kind,
    id: resolved.id,
    name: entity.name,
    description: entity.description,
    ...(resolved.kind === 'node' && (entity as InterfaceStudioNode).role !== undefined
      ? { role: (entity as InterfaceStudioNode).role }
      : {}),
  };

  return {
    contextId: createStableInterfaceStudioId(
      'selection',
      project.id,
      resolved.kind,
      resolved.id,
    ),
    project: {
      id: project.id,
      name: project.name,
      description: project.description,
    },
    subject,
    path: cloneJsonLike(resolved.path),
    children: selectionChildren(resolved),
    visualLanguage: {
      id: project.visualLanguage.id,
      direction: project.visualLanguage.direction,
      tone: project.visualLanguage.tone,
      accessibilityIntent: project.visualLanguage.accessibilityIntent,
      componentGuidance: cloneJsonLike(project.visualLanguage.componentGuidance),
      tokens: cloneJsonLike(tokens),
    },
    previewProfiles: cloneJsonLike(project.previewProfiles),
    adapterMetadata: project.targetAdapters.flatMap(adapter => {
      const match = adapter.selectionMetadata.find(item => (
        item.entityKind === resolved.kind && item.entityId === resolved.id
      ));
      return match === undefined
        ? []
        : [{
            adapterId: adapter.id,
            label: adapter.label,
            targetKind: adapter.targetKind,
            renderer: adapter.renderer,
            metadata: cloneJsonLike(match.metadata),
          }];
    }),
  };
}

/** Canonical JSON keeps prompt cache keys and chat context comparisons stable. */
export function serializeInterfaceStudioSelectionContext(
  context: InterfaceStudioSelectionContext,
): string {
  return JSON.stringify(sortJsonKeys(context));
}

function projectVisualLanguage(
  config: WebsiteWorkspaceConfig,
  projectId: string,
): InterfaceStudioVisualLanguage {
  const visualLanguageId = createStableInterfaceStudioId('visual-language', projectId);
  const token = (
    name: string,
    category: InterfaceStudioSemanticTokenCategory,
    role: string,
    value: string,
  ): InterfaceStudioSemanticToken => ({
    id: createStableInterfaceStudioId('token', visualLanguageId, role),
    name,
    category,
    role,
    value,
  });
  return {
    id: visualLanguageId,
    name: 'Project visual language',
    direction: config.designSystem.brandDirection,
    tone: config.designSystem.tone,
    accessibilityIntent: config.designSystem.accessibilityTarget,
    tokens: [
      token('Primary brand', 'color', 'color.brand.primary', config.designSystem.primaryColor),
      token('Secondary brand', 'color', 'color.brand.secondary', config.designSystem.secondaryColor),
      token('Accent', 'color', 'color.brand.accent', config.designSystem.accentColor),
      token('Heading', 'typography', 'typography.heading', config.designSystem.headingFont),
      token('Body', 'typography', 'typography.body', config.designSystem.bodyFont),
      token('Spacing scale', 'spacing', 'spacing.scale', config.designSystem.spacingScale),
      token('Corner radius', 'radius', 'radius.corner', config.designSystem.cornerStyle),
    ],
    componentGuidance: cloneJsonLike(config.designSystem.componentNotes),
  };
}

function selectionChildren<TAdapterMetadata, TSelectionMetadata>(
  resolved: InterfaceStudioResolvedSelection<TAdapterMetadata, TSelectionMetadata>,
): InterfaceStudioSelectionContext['children'] {
  switch (resolved.kind) {
    case 'project':
      return (resolved.entity as InterfaceStudioProject<TAdapterMetadata, TSelectionMetadata>).flows
        .map(item => ({ kind: 'flow' as const, id: item.id, name: item.name }));
    case 'flow':
      return (resolved.entity as InterfaceStudioFlow).surfaces
        .map(item => ({ kind: 'surface' as const, id: item.id, name: item.name }));
    case 'surface':
      return (resolved.entity as InterfaceStudioSurface).nodes
        .map(item => ({
          kind: 'node' as const,
          id: item.id,
          name: item.name,
          ...(item.role === undefined ? {} : { role: item.role }),
        }));
    case 'node':
      return (resolved.entity as InterfaceStudioNode).children
        .map(item => ({
          kind: 'node' as const,
          id: item.id,
          name: item.name,
          ...(item.role === undefined ? {} : { role: item.role }),
        }));
  }
}

function findNodePath(
  nodes: readonly InterfaceStudioNode[],
  nodeId: string,
): InterfaceStudioNode[] | undefined {
  for (const node of nodes) {
    if (node.id === nodeId) {
      return [node];
    }
    const childPath = findNodePath(node.children, nodeId);
    if (childPath !== undefined) {
      return [node, ...childPath];
    }
  }
  return undefined;
}

function pathItem(
  kind: InterfaceStudioEntityKind,
  entity: { readonly id: string; readonly name: string },
): InterfaceStudioSelectionPathItem {
  return { kind, id: entity.id, name: entity.name };
}

function nextOccurrence(occurrences: Map<string, number>, identity: string): number {
  const occurrence = (occurrences.get(identity) || 0) + 1;
  occurrences.set(identity, occurrence);
  return occurrence;
}

function normalizeIdPart(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'item';
}

function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function cloneJsonLike<T>(value: T, seen = new Map<object, unknown>()): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  const existing = seen.get(value as object);
  if (existing !== undefined) {
    return existing as T;
  }
  if (Array.isArray(value)) {
    const clone: unknown[] = [];
    seen.set(value, clone);
    for (const item of value) {
      clone.push(cloneJsonLike(item, seen));
    }
    return clone as T;
  }
  const clone: Record<string, unknown> = {};
  seen.set(value as object, clone);
  for (const key of Object.keys(value)) {
    clone[key] = cloneJsonLike((value as Record<string, unknown>)[key], seen);
  }
  return clone as T;
}

function sortJsonKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonKeys);
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const child = sortJsonKeys((value as Record<string, unknown>)[key]);
      if (child !== undefined) {
        sorted[key] = child;
      }
    }
    return sorted;
  }
  return value;
}
