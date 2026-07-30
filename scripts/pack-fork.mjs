#!/usr/bin/env node
/**
 * Builds every publishable Yoopta package and packs it into `dist-packages/`
 * as a tarball that can be installed straight from a raw.githubusercontent URL.
 *
 *   node scripts/pack-fork.mjs [--skip-build] [--dry-run] [--only <name,name>]
 *
 * Two things make the output installable without a registry:
 *
 *   1. Versions are suffixed (`6.0.5-codertapsu.1`) so they can never be
 *      confused with the upstream release, and so a rebuilt tarball gets a new
 *      URL — npm caches by URL and lockfiles pin an integrity hash, so reusing
 *      a filename for different bytes breaks consumers with EINTEGRITY.
 *
 *   2. Intra-repo `@yoopta/*` dependencies and peerDependencies are rewritten to
 *      the matching tarball URLs. Without this, npm would helpfully install the
 *      *public registry* copy of `@yoopta/editor` next to the forked one, and
 *      two editor instances means broken contexts and dead Slate DOM maps.
 *
 * The package.json edits are made in place and always reverted afterwards, so a
 * failed run leaves the working tree clean.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BUILD_LAYERS,
  ROOT,
  forkVersion,
  listPackages,
  loadForkConfig,
  run,
  tarballFileName,
  tarballUrl,
} from './fork-utils.mjs';

const args = process.argv.slice(2);
const skipBuild = args.includes('--skip-build');
const dryRun = args.includes('--dry-run');
const onlyArg = args.indexOf('--only');
const only = onlyArg !== -1 ? (args[onlyArg + 1] ?? '').split(',').filter(Boolean) : null;

const config = loadForkConfig();
const outDir = join(ROOT, config.outDir);

const allPackages = listPackages();
const packages = only ? allPackages.filter((p) => only.includes(p.name)) : allPackages;

if (packages.length === 0) {
  console.error('No packages matched.');
  process.exit(1);
}

/** name -> forked version, needed to build the URL for cross-package deps */
const versions = new Map(
  allPackages.map((p) => [p.name, forkVersion(p.version, config)]),
);

console.log(`\nFork tag     : ${config.tag}`);
console.log(`Revision     : ${config.revision}`);
console.log(`Base URL     : ${config.baseUrl}`);
console.log(`Packages     : ${packages.length}${only ? ` (filtered from ${allPackages.length})` : ''}`);
console.log(`Output       : ${config.outDir}/\n`);

if (!skipBuild) {
  console.log('Building in dependency order (turbo cannot infer it — intra-repo links are peerDependencies)\n');
  run('yarn', ['clean']);
  for (const layer of BUILD_LAYERS) {
    const filters = layer.flatMap((glob) => ['--filter', `./${glob}`]);
    run('yarn', ['turbo', 'run', 'build', ...filters]);
  }
} else {
  console.log('Skipping build (--skip-build)\n');
}

/** Rewrites a dependency block, pointing intra-repo packages at their tarballs. */
function rewriteDeps(block) {
  if (!block) return { next: block, changed: [] };

  const next = { ...block };
  const changed = [];

  for (const [dep, range] of Object.entries(block)) {
    if (!versions.has(dep)) continue;

    const url = tarballUrl(dep, versions.get(dep), config);
    next[dep] = url;
    changed.push(`${dep}: ${range} -> tarball`);
  }

  return { next, changed };
}

const backups = new Map();
const manifest = [];

function restoreAll() {
  for (const [file, contents] of backups) {
    writeFileSync(file, contents);
  }
  backups.clear();
}

process.on('SIGINT', () => {
  restoreAll();
  process.exit(130);
});

try {
  if (!dryRun) {
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
  }

  for (const { dir, file, pkg, name } of packages) {
    const absFile = join(ROOT, file);
    backups.set(absFile, readFileSync(absFile, 'utf8'));

    const version = versions.get(name);
    const deps = rewriteDeps(pkg.dependencies);
    const peers = rewriteDeps(pkg.peerDependencies);

    const forked = { ...pkg, version };
    if (deps.next) forked.dependencies = deps.next;
    if (peers.next) forked.peerDependencies = peers.next;

    // The upstream `prepublishOnly: yarn build` would re-run rollup inside the
    // package on publish; the fork builds explicitly above instead.
    if (forked.scripts?.prepublishOnly) {
      forked.scripts = { ...forked.scripts };
      delete forked.scripts.prepublishOnly;
    }

    forked.yooptaFork = {
      tag: config.tag,
      revision: config.revision,
      upstreamVersion: pkg.version,
      builtFrom: config.repository,
    };

    const tarball = tarballFileName(name, version);
    const rewrites = [...deps.changed, ...peers.changed];

    console.log(`• ${name}@${version}`);
    if (rewrites.length > 0) {
      for (const line of rewrites) console.log(`    ${line}`);
    }

    if (dryRun) {
      manifest.push({ name, version, tarball, url: tarballUrl(name, version, config) });
      continue;
    }

    writeFileSync(absFile, `${JSON.stringify(forked, null, 2)}\n`);

    run('npm', ['pack', '--silent', '--pack-destination', outDir], { cwd: join(ROOT, dir) });

    manifest.push({
      name,
      version,
      upstreamVersion: pkg.version,
      tarball,
      url: tarballUrl(name, version, config),
    });
  }
} finally {
  restoreAll();
}

if (dryRun) {
  console.log('\nDry run — nothing written.');
  process.exit(0);
}

// A paste-ready dependency block, in the exact shape a consumer's package.json wants
const dependencies = Object.fromEntries(
  manifest.map(({ name, url }) => [name, url]),
);

writeFileSync(
  join(outDir, 'manifest.json'),
  `${JSON.stringify(
    {
      tag: config.tag,
      revision: config.revision,
      generatedFrom: config.repository,
      packages: manifest,
    },
    null,
    2,
  )}\n`,
);

writeFileSync(
  join(outDir, 'dependencies.json'),
  `${JSON.stringify({ dependencies }, null, 2)}\n`,
);

writeFileSync(
  join(outDir, 'README.md'),
  `# Yoopta fork packages

Generated by \`yarn fork:pack\` — do not edit by hand.

**Revision \`${config.tag}.${config.revision}\`**, built from upstream ${manifest[0]?.upstreamVersion ?? 'unknown'}.

## Install

Copy the block from [dependencies.json](./dependencies.json) into your app's
\`package.json\`, then reinstall.

## Rules

- **Always upgrade every \`@yoopta/*\` entry together.** The tarballs point at each
  other by URL; mixing revisions makes npm install two copies of
  \`@yoopta/editor\`, which breaks React context and Slate's DOM lookups.
- **Never overwrite a published tarball.** Bump \`revision\` in \`fork.config.json\`
  instead — npm caches by URL and lockfiles pin an integrity hash.
`,
);

console.log(`\n✔ ${manifest.length} tarballs written to ${config.outDir}/`);
console.log(`  manifest.json     — full metadata`);
console.log(`  dependencies.json — paste-ready package.json block\n`);
