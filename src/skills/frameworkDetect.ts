import type { SkillDefinition } from '../types.js';

interface FrameworkSignal {
  name: string;
  category: string;
  file?: string;
  depKey?: string;
}

const FILE_SIGNALS: FrameworkSignal[] = [
  // Config files
  { name: 'Next.js', category: 'Web Framework', file: 'next.config.js' },
  { name: 'Next.js', category: 'Web Framework', file: 'next.config.ts' },
  { name: 'Next.js', category: 'Web Framework', file: 'next.config.mjs' },
  { name: 'Vite', category: 'Build Tool', file: 'vite.config.ts' },
  { name: 'Vite', category: 'Build Tool', file: 'vite.config.js' },
  { name: 'Nuxt', category: 'Web Framework', file: 'nuxt.config.ts' },
  { name: 'Nuxt', category: 'Web Framework', file: 'nuxt.config.js' },
  { name: 'SvelteKit', category: 'Web Framework', file: 'svelte.config.js' },
  { name: 'SvelteKit', category: 'Web Framework', file: 'svelte.config.ts' },
  { name: 'Astro', category: 'Web Framework', file: 'astro.config.ts' },
  { name: 'Astro', category: 'Web Framework', file: 'astro.config.mjs' },
  { name: 'Remix', category: 'Web Framework', file: 'remix.config.js' },
  { name: 'Tailwind CSS', category: 'Styling', file: 'tailwind.config.ts' },
  { name: 'Tailwind CSS', category: 'Styling', file: 'tailwind.config.js' },
  { name: 'PostCSS', category: 'Styling', file: 'postcss.config.js' },
  { name: 'Vitest', category: 'Testing', file: 'vitest.config.ts' },
  { name: 'Vitest', category: 'Testing', file: 'vitest.config.js' },
  { name: 'Jest', category: 'Testing', file: 'jest.config.js' },
  { name: 'Jest', category: 'Testing', file: 'jest.config.ts' },
  { name: 'Playwright', category: 'Testing', file: 'playwright.config.ts' },
  { name: 'Cypress', category: 'Testing', file: 'cypress.config.ts' },
  { name: 'Storybook', category: 'Component Dev', file: '.storybook/main.ts' },
  { name: 'Storybook', category: 'Component Dev', file: '.storybook/main.js' },
  { name: 'Electron', category: 'Desktop', file: 'electron-builder.yml' },
  { name: 'Electron', category: 'Desktop', file: 'electron-builder.json' },
  { name: 'Flutter', category: 'Mobile', file: 'pubspec.yaml' },
  { name: 'Expo', category: 'Mobile', file: 'app.json' },
  { name: 'Expo', category: 'Mobile', file: 'app.config.ts' },
  { name: 'React Native', category: 'Mobile', file: 'metro.config.js' },
  { name: 'Rust/Cargo', category: 'Language', file: 'Cargo.toml' },
  { name: 'Go', category: 'Language', file: 'go.mod' },
  { name: 'Python', category: 'Language', file: 'pyproject.toml' },
  { name: 'Python', category: 'Language', file: 'setup.py' },
  { name: 'Python', category: 'Language', file: 'requirements.txt' },
  { name: '.NET', category: 'Language', file: '*.csproj' },
  { name: 'Java/Maven', category: 'Language', file: 'pom.xml' },
  { name: 'Java/Gradle', category: 'Language', file: 'build.gradle' },
  { name: 'Docker', category: 'Infrastructure', file: 'Dockerfile' },
  { name: 'Docker Compose', category: 'Infrastructure', file: 'docker-compose.yml' },
  { name: 'Docker Compose', category: 'Infrastructure', file: 'docker-compose.yaml' },
  { name: 'Terraform', category: 'Infrastructure', file: '*.tf' },
  { name: 'Kubernetes', category: 'Infrastructure', file: 'k8s/*.yaml' },
  { name: 'GitHub Actions', category: 'CI/CD', file: '.github/workflows/*.yml' },
  { name: 'Prisma', category: 'Database', file: 'prisma/schema.prisma' },
  { name: 'Drizzle ORM', category: 'Database', file: 'drizzle.config.ts' },
  { name: 'ESLint', category: 'Linting', file: '.eslintrc.json' },
  { name: 'ESLint', category: 'Linting', file: 'eslint.config.js' },
  { name: 'ESLint', category: 'Linting', file: 'eslint.config.ts' },
  { name: 'Prettier', category: 'Formatting', file: '.prettierrc' },
  { name: 'Prettier', category: 'Formatting', file: 'prettier.config.js' },
];

const DEP_SIGNALS: FrameworkSignal[] = [
  { name: 'React', category: 'UI Library', depKey: 'react' },
  { name: 'Vue.js', category: 'UI Library', depKey: 'vue' },
  { name: 'Angular', category: 'Web Framework', depKey: '@angular/core' },
  { name: 'Svelte', category: 'UI Library', depKey: 'svelte' },
  { name: 'Solid.js', category: 'UI Library', depKey: 'solid-js' },
  { name: 'Preact', category: 'UI Library', depKey: 'preact' },
  { name: 'Qwik', category: 'Web Framework', depKey: '@builder.io/qwik' },
  { name: 'tRPC', category: 'API', depKey: '@trpc/server' },
  { name: 'GraphQL', category: 'API', depKey: 'graphql' },
  { name: 'Express', category: 'Server', depKey: 'express' },
  { name: 'Fastify', category: 'Server', depKey: 'fastify' },
  { name: 'Hono', category: 'Server', depKey: 'hono' },
  { name: 'NestJS', category: 'Server', depKey: '@nestjs/core' },
  { name: 'Elysia', category: 'Server', depKey: 'elysia' },
  { name: 'Stripe', category: 'Payments', depKey: 'stripe' },
  { name: 'Supabase', category: 'Database/Auth', depKey: '@supabase/supabase-js' },
  { name: 'Firebase', category: 'Database/Auth', depKey: 'firebase' },
  { name: 'Phaser', category: 'Game Engine', depKey: 'phaser' },
  { name: 'Three.js', category: 'Graphics', depKey: 'three' },
  { name: 'Babylon.js', category: 'Game Engine', depKey: '@babylonjs/core' },
  { name: 'Pixi.js', category: 'Graphics', depKey: 'pixi.js' },
  { name: 'Electron', category: 'Desktop', depKey: 'electron' },
  { name: 'Tauri', category: 'Desktop', depKey: '@tauri-apps/api' },
  { name: 'React Native', category: 'Mobile', depKey: 'react-native' },
  { name: 'Expo', category: 'Mobile', depKey: 'expo' },
  { name: 'Recharts', category: 'Charts', depKey: 'recharts' },
  { name: 'Chart.js', category: 'Charts', depKey: 'chart.js' },
  { name: 'D3', category: 'Charts', depKey: 'd3' },
  { name: 'Shadcn/ui', category: 'UI Components', depKey: '@radix-ui/react-dialog' },
  { name: 'Material UI', category: 'UI Components', depKey: '@mui/material' },
  { name: 'Ant Design', category: 'UI Components', depKey: 'antd' },
  { name: 'Zustand', category: 'State Management', depKey: 'zustand' },
  { name: 'Jotai', category: 'State Management', depKey: 'jotai' },
  { name: 'Tanstack Query', category: 'Data Fetching', depKey: '@tanstack/react-query' },
  { name: 'Zod', category: 'Validation', depKey: 'zod' },
  { name: 'TypeScript', category: 'Language', depKey: 'typescript' },
];

export const frameworkDetectSkill: SkillDefinition = {
  id: 'framework-detect',
  name: 'Framework & Stack Detector',
  builtIn: true,
  description:
    'Detect the technology stack of the current workspace by scanning package.json dependencies ' +
    'and config file fingerprints. Identifies web frameworks, UI libraries, mobile SDKs, game engines, ' +
    'databases, testing tools, build tools, infrastructure configs, and more. ' +
    'Useful for orienting an agent before working on an unfamiliar project.',
  parameters: {
    type: 'object',
    properties: {},
  },
  async execute(_params, context) {
    const root = context.workspaceRootPath;
    if (!root) { return 'Error: No workspace is open.'; }

    const detected = new Map<string, string>(); // name → category

    // Scan dependencies from package.json
    try {
      const pkgContent = await context.readFile(`${root}/package.json`);
      const pkg = JSON.parse(pkgContent) as Record<string, unknown>;
      const allDeps = {
        ...((pkg['dependencies'] ?? {}) as Record<string, string>),
        ...((pkg['devDependencies'] ?? {}) as Record<string, string>),
        ...((pkg['peerDependencies'] ?? {}) as Record<string, string>),
      };
      for (const signal of DEP_SIGNALS) {
        if (signal.depKey && Object.prototype.hasOwnProperty.call(allDeps, signal.depKey)) {
          detected.set(signal.name, signal.category);
        }
      }
    } catch {
      // No package.json or not parseable — continue with file-based detection
    }

    // Scan config files
    for (const signal of FILE_SIGNALS) {
      if (!signal.file) { continue; }
      if (detected.has(signal.name)) { continue; }
      try {
        const files = await context.findFiles(signal.file);
        if (files.length > 0) {
          detected.set(signal.name, signal.category);
        }
      } catch {
        // skip
      }
    }

    if (detected.size === 0) {
      return 'No recognized frameworks or tools detected in this workspace.';
    }

    // Group by category
    const byCategory = new Map<string, string[]>();
    for (const [name, category] of detected) {
      const existing = byCategory.get(category) ?? [];
      existing.push(name);
      byCategory.set(category, existing);
    }

    const lines: string[] = [`Detected stack (${detected.size} items):`];
    for (const [category, names] of [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`  ${category}: ${names.join(', ')}`);
    }
    return lines.join('\n');
  },
};
