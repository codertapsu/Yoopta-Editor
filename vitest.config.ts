import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

/**
 * Maps every workspace package to its TypeScript source.
 *
 * Without this, a test that imports `@yoopta/editor` resolves through the
 * workspace symlink to `packages/core/editor/package.json`, whose `main` points
 * at `dist/index.js` — so `yarn test:run` only works if the package happens to
 * have been built, and fails on a clean checkout or in CI.
 *
 * Aliasing to source also means tests exercise the code under review rather than
 * a possibly-stale build artifact.
 */
function workspaceAliases(): Record<string, string> {
  const roots = ['packages/core', 'packages/plugins', 'packages/themes', 'packages'];
  const aliases: Record<string, string> = {};

  for (const root of roots) {
    const rootPath = resolve(__dirname, root);
    if (!existsSync(rootPath)) continue;

    for (const dir of readdirSync(rootPath)) {
      const pkgPath = resolve(rootPath, dir, 'package.json');
      const entry = resolve(rootPath, dir, 'src/index.ts');
      if (!existsSync(pkgPath) || !existsSync(entry)) continue;

      const { name } = JSON.parse(readFileSync(pkgPath, 'utf8'));
      if (name?.startsWith('@yoopta/') && !aliases[name]) {
        aliases[name] = entry;
      }
    }
  }

  return aliases;
}

export default defineConfig({
  plugins: [
    react(),
    svgr({
      exportAsDefault: true,
      svgrOptions: {},
      include: '**/*.svg',
    }),
  ],
  test: {
    css: false,
    globals: true,
    environment: 'jsdom',
    setupFiles: './tests/setup.js',
    include: ['packages/**/*.{test,spec}.{ts,tsx}'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
    ],
    pool: 'threads',
    testTimeout: 10000,
    hookTimeout: 10000,
    reporters: ['default', 'verbose'],
    outputFile: {
      verbose: './test-results/verbose.log',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['packages/**/*.{ts,tsx}'],
      exclude: ['node_modules/**', 'dist/**', '**/*.d.ts'],
      clean: true,
      cleanOnRerun: true,
    },
  },
  resolve: {
    alias: {
      'test-utils': resolve(__dirname, 'tests/test-utils.tsx'),
      ...workspaceAliases(),
    },
  },
});
