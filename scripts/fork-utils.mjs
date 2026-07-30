import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function loadForkConfig() {
  const config = readJSON(join(ROOT, 'fork.config.json'));

  for (const key of ['tag', 'revision', 'outDir', 'baseUrl']) {
    if (config[key] === undefined) {
      throw new Error(`fork.config.json is missing "${key}"`);
    }
  }

  if (!/^[a-z0-9][a-z0-9-]*$/.test(config.tag)) {
    throw new Error(`fork.config.json "tag" must be a lowercase npm-safe identifier, got "${config.tag}"`);
  }

  if (!Number.isInteger(config.revision) || config.revision < 1) {
    throw new Error(`fork.config.json "revision" must be an integer >= 1, got ${config.revision}`);
  }

  return config;
}

/**
 * Every publishable workspace package, in dependency-safe build order.
 * Order matters: rollup resolves `@yoopta/editor` types from its built `dist`,
 * and turbo cannot infer the graph because intra-repo links are peerDependencies.
 */
export const BUILD_LAYERS = [
  ['packages/core/editor'],
  ['packages/marks', 'packages/core/ui', 'packages/core/exports', 'packages/core/collaboration'],
  ['packages/plugins/*'],
  ['packages/themes/*'],
];

export function listPackages() {
  const dirs = execFileSync(
    'find',
    ['packages', '-name', 'package.json', '-not', '-path', '*/node_modules/*', '-not', '-path', '*/dist/*'],
    { cwd: ROOT, encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .filter(Boolean);

  return dirs
    .map((file) => {
      const dir = dirname(file);
      const pkg = readJSON(join(ROOT, file));
      return { dir, file, pkg, name: pkg.name, version: pkg.version };
    })
    .filter(({ pkg }) => !pkg.private && pkg.name?.startsWith('@yoopta/'))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** `@yoopta/themes-shadcn` -> `yoopta-themes-shadcn` (npm's tarball naming) */
export function tarballBaseName(packageName) {
  return packageName.replace(/^@/, '').replace(/\//g, '-');
}

export function forkVersion(baseVersion, config) {
  // Strip any previously applied fork suffix so re-runs stay idempotent
  const upstreamVersion = baseVersion.split(`-${config.tag}.`)[0];
  return `${upstreamVersion}-${config.tag}.${config.revision}`;
}

export function tarballFileName(packageName, version) {
  return `${tarballBaseName(packageName)}-${version}.tgz`;
}

export function tarballUrl(packageName, version, config) {
  return `${config.baseUrl.replace(/\/$/, '')}/${tarballFileName(packageName, version)}`;
}

export function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: ROOT,
    stdio: options.capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
    ...options,
  });
}
