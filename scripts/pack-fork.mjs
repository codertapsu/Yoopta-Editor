#!/usr/bin/env node
/**
 * Builds every publishable Yoopta package and packs it into `dist-packages/`
 * as a tarball installable directly from a URL — no registry involved.
 *
 *   node scripts/pack-fork.mjs [--skip-build] [--dry-run] [--allow-dirty] [--only a,b]
 *
 * Three things make the output installable and safe:
 *
 *   1. Versions are suffixed (`6.0.5-codertapsu.2`) so they can never be confused
 *      with the upstream release, and so every rebuild gets a fresh URL. npm
 *      caches by URL and lockfiles pin an integrity hash, so serving different
 *      bytes from an existing URL breaks consumers with EINTEGRITY.
 *
 *   2. Intra-repo `@yoopta/*` dependencies and peerDependencies are rewritten to
 *      the matching tarball URLs. Without this npm would helpfully resolve
 *      `@yoopta/editor` from the public registry alongside the forked copy, and
 *      two editor instances means broken React context and dead Slate DOM maps.
 *
 *   3. Provenance (upstream version, fork revision, source commit) is recorded
 *      under `yooptaFork`, and repository/bugs/homepage point at the fork.
 *
 * package.json edits are made in place and always reverted, so a failed run
 * leaves the working tree clean.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BUILD_LAYERS,
  ROOT,
  forkVersion,
  gitInfo,
  listPackages,
  loadForkConfig,
  releaseTag,
  run,
  tarballFileName,
  tarballUrl,
  tryRun,
} from './fork-utils.mjs';

const args = process.argv.slice(2);
const skipBuild = args.includes('--skip-build');
const dryRun = args.includes('--dry-run');
const allowDirty = args.includes('--allow-dirty');
const onlyArg = args.indexOf('--only');
const only = onlyArg !== -1 ? (args[onlyArg + 1] ?? '').split(',').filter(Boolean) : null;

const config = loadForkConfig();
const outDir = join(ROOT, config.outDir);

const allPackages = listPackages();
const packages = only ? allPackages.filter((p) => only.includes(p.name)) : allPackages;

if (packages.length === 0) {
  console.error(`No packages matched${only ? ` --only ${only.join(',')}` : ''}.`);
  process.exit(1);
}

const tag = releaseTag(config, allPackages);
const git = gitInfo();

/** name -> forked version, needed to build URLs for cross-package deps */
const versions = new Map(allPackages.map((p) => [p.name, forkVersion(p.version, config)]));

console.log(`\nFork tag     : ${config.tag}`);
console.log(`Revision     : ${config.revision}`);
console.log(`Release tag  : ${tag}`);
console.log(`URL strategy : ${config.urlStrategy}`);
console.log(`Example URL  : ${tarballUrl('@yoopta/editor', versions.get('@yoopta/editor'), config, tag)}`);
console.log(`Source       : ${git.shortCommit ?? 'unknown'}${git.dirty ? ' (dirty)' : ''}`);
console.log(`Packages     : ${packages.length}${only ? ` (filtered from ${allPackages.length})` : ''}\n`);

// --- Guards ------------------------------------------------------------------

if (git.dirty && !allowDirty && !dryRun) {
  console.error('Working tree is dirty. Tarballs should be reproducible from a commit.');
  console.error('Commit your changes, or pass --allow-dirty for a local test build.\n');
  process.exit(1);
}

// Republishing an existing tag would serve different bytes from URLs consumers
// have already pinned. Bump the revision instead.
if (!dryRun && config.urlStrategy === 'release') {
  const existing = tryRun('gh', ['release', 'view', tag, '--repo', config.repository, '--json', 'tagName']);
  if (existing) {
    console.error(`Release ${tag} already exists on ${config.repository}.`);
    console.error('Republishing it would break installs that pinned its integrity hash.');
    console.error('Run `yarn fork:revision` to bump, then pack again.\n');
    process.exit(1);
  }
}

// --- Build -------------------------------------------------------------------

if (!skipBuild) {
  console.log('Building in dependency order (turbo cannot infer it — intra-repo links are peerDependencies)\n');
  run('yarn', ['clean']);
  for (const layer of BUILD_LAYERS) {
    run('yarn', ['turbo', 'run', 'build', ...layer.flatMap((glob) => ['--filter', `./${glob}`])]);
  }
} else {
  console.log('Skipping build (--skip-build)\n');
}

// --- Pack --------------------------------------------------------------------

/** Rewrites a dependency block, pointing intra-repo packages at their tarballs. */
function rewriteDeps(block) {
  if (!block) return { next: block, changed: [] };

  const next = { ...block };
  const changed = [];

  for (const [dep, range] of Object.entries(block)) {
    if (!versions.has(dep)) continue;
    next[dep] = tarballUrl(dep, versions.get(dep), config, tag);
    changed.push(`${dep}: ${range} -> tarball`);
  }

  return { next, changed };
}

const backups = new Map();
const manifest = [];

function restoreAll() {
  for (const [file, contents] of backups) writeFileSync(file, contents);
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

    // Point consumers at the fork, not upstream
    forked.repository = { type: 'git', url: `git+https://github.com/${config.repository}.git` };
    forked.homepage = `https://github.com/${config.repository}#readme`;
    forked.bugs = { url: `https://github.com/${config.repository}/issues` };

    // Upstream's `prepublishOnly: yarn build` would re-run rollup inside the
    // package; this script builds explicitly above instead.
    if (forked.scripts?.prepublishOnly) {
      forked.scripts = { ...forked.scripts };
      delete forked.scripts.prepublishOnly;
    }

    forked.yooptaFork = {
      tag: config.tag,
      revision: config.revision,
      releaseTag: tag,
      upstreamVersion: pkg.version,
      upstreamRepository: config.upstreamRepository ?? null,
      builtFrom: config.repository,
      commit: git.commit,
    };

    const rewrites = [...deps.changed, ...peers.changed];
    console.log(`• ${name}@${version}`);
    for (const line of rewrites) console.log(`    ${line}`);

    const entry = {
      name,
      version,
      upstreamVersion: pkg.version,
      tarball: tarballFileName(name, version),
      url: tarballUrl(name, version, config, tag),
    };

    if (dryRun) {
      manifest.push(entry);
      continue;
    }

    writeFileSync(absFile, `${JSON.stringify(forked, null, 2)}\n`);
    run('npm', ['pack', '--silent', '--pack-destination', outDir], { cwd: join(ROOT, dir) });
    manifest.push(entry);
  }
} finally {
  restoreAll();
}

if (dryRun) {
  console.log('\nDry run — nothing written.');
  process.exit(0);
}

// --- Metadata ----------------------------------------------------------------

const dependencies = Object.fromEntries(manifest.map(({ name, url }) => [name, url]));

writeFileSync(
  join(outDir, 'manifest.json'),
  `${JSON.stringify(
    {
      tag: config.tag,
      revision: config.revision,
      releaseTag: tag,
      urlStrategy: config.urlStrategy,
      repository: config.repository,
      commit: git.commit,
      packages: manifest,
    },
    null,
    2,
  )}\n`,
);

writeFileSync(join(outDir, 'dependencies.json'), `${JSON.stringify({ dependencies }, null, 2)}\n`);

writeFileSync(
  join(outDir, 'README.md'),
  `# Yoopta fork packages — \`${tag}\`

Generated by \`yarn fork:pack\` — do not edit by hand.

Built from upstream **${manifest[0]?.upstreamVersion ?? 'unknown'}** at commit
\`${git.shortCommit ?? 'unknown'}\`.

## Install

Copy the block from [dependencies.json](./dependencies.json) into your app's
\`package.json\`, then reinstall.

The tarballs themselves are published as assets on the
[\`${tag}\`](https://github.com/${config.repository}/releases/tag/${tag}) release —
they are deliberately **not** committed to git, so the repository does not grow by
several MB per release.

## Rules

- **Always upgrade every \`@yoopta/*\` entry together.** The tarballs point at each
  other by URL; mixing revisions makes npm install two copies of
  \`@yoopta/editor\`, which breaks React context and Slate's DOM lookups.
- **Never republish a release tag.** Bump \`revision\` in \`fork.config.json\`
  instead — npm caches by URL and lockfiles pin an integrity hash.
`,
);

console.log(`\n✔ ${manifest.length} tarballs written to ${config.outDir}/`);
console.log(`\nNext: yarn fork:publish   # creates release ${tag} with these assets\n`);
