# codertapsu/Yoopta-Editor — fork notes

A fork of [yoopta-editor/Yoopta-Editor](https://github.com/yoopta-editor/Yoopta-Editor)
that ships as tarballs installed straight from GitHub, so fixes can land in our
apps without waiting on an upstream release.

- `origin`   → `codertapsu/Yoopta-Editor` (this fork)
- `upstream` → `yoopta-editor/Yoopta-Editor` (push disabled)

---

## Installing in an app

Copy the block from [`dist-packages/dependencies.json`](./dist-packages/dependencies.json)
into your app's `package.json` and reinstall:

```json
"@yoopta/editor": "https://raw.githubusercontent.com/codertapsu/Yoopta-Editor/master/dist-packages/yoopta-editor-6.0.5-codertapsu.1.tgz",
"@yoopta/mention": "https://raw.githubusercontent.com/codertapsu/Yoopta-Editor/master/dist-packages/yoopta-mention-6.0.5-codertapsu.1.tgz"
```

**Two rules that will bite otherwise:**

1. **Upgrade every `@yoopta/*` entry together.** The tarballs reference each other
   by URL. Mixing revisions makes npm install two copies of `@yoopta/editor`,
   and two editor instances means broken React context and dead Slate DOM maps.
2. **Never overwrite a published tarball.** npm caches by URL and lockfiles pin an
   integrity hash — changing the bytes behind an existing URL fails installs with
   `EINTEGRITY`. Bump the revision instead (`yarn fork:revision`), which changes
   the filename.

### Packages that do not exist in this repo

These were part of Yoopta v4/v5 and have no source in the v6 monorepo, so the
fork cannot build them. They were replaced by `@yoopta/ui`:

| Old package | Replacement |
| --- | --- |
| `@yoopta/action-menu-list` | `@yoopta/ui` (`ActionMenuList`) |
| `@yoopta/toolbar` | `@yoopta/ui` (`Toolbar`) |
| `@yoopta/link-tool` | `@yoopta/ui` |
| `@yoopta/renderer` | — (no v6 equivalent) |

`@yoopta/math` exists here but was missing from the original dependency list.

---

## Releasing a new build

```bash
yarn install
yarn fork:revision          # bump; use `yarn fork:revision 1` after an upstream version bump
yarn fork:pack              # builds everything, writes dist-packages/
git add dist-packages fork.config.json
git commit -m "release: 6.0.5-codertapsu.2"
git push origin master
```

`yarn fork:pack` does three things that plain `npm pack` does not:

- builds packages in **explicit dependency order** — turbo cannot infer it,
  because intra-repo links are declared as `peerDependencies`, which are not part
  of the workspace graph. Building in parallel makes plugins compile before
  `@yoopta/editor`'s `dist` exists and emit degraded `.d.ts` files;
- rewrites intra-repo `@yoopta/*` dependencies to the matching tarball URLs;
- stamps `version` with the fork suffix and records provenance under
  `yooptaFork` in each published `package.json`.

The workspace `package.json` files are edited in place and always restored, so a
failed run leaves the tree clean.

Use `--skip-build` (`yarn fork:pack:quick`) when `dist/` is already current, and
`--dry-run` to preview.

---

## Syncing with upstream

```bash
yarn fork:sync:check   # report what changed upstream and whether it collides with our edits
yarn fork:sync         # fetch, branch, merge
```

`fork:sync` creates a `sync/upstream-<sha>` branch and runs a normal `git merge`.
Our changes live in ordinary commits, so git's three-way merge keeps them and
raises real conflicts rather than silently choosing a side.

After a merge:

```bash
yarn install
yarn build && yarn test:run
yarn fork:revision 1        # if upstream's version changed
yarn fork:pack
git push -u origin sync/upstream-<sha>
```

Files the fork owns outright — on conflict, keep ours (`git checkout --ours`):

```
FORK.md  fork.config.json  scripts/fork-*.mjs  scripts/pack-fork.mjs
scripts/sync-upstream.mjs  scripts/set-fork-revision.mjs  dist-packages/
.github/workflows/fork-release.yml  .github/workflows/upstream-sync.yml
```

---

## What this fork changes

### 1. Mention & Emoji dropdowns work on mobile

Upstream detects the `@` / `:` trigger and accumulates the search query purely
from `keydown` events. That cannot work on a phone:

- **Android IMEs** (Gboard, Samsung, SwiftKey) report every printable character
  as `key: 'Unidentified'`, `keyCode: 229`. `event.key === '@'` is never true, so
  the dropdown never opened at all.
- **iOS** is WebKit-only, and WebKit returns an **empty `DOMRectList` and a zeroed
  bounding rect for collapsed ranges**. The caret measurement produced
  `{0,0,0,0}`, anchoring the dropdown to the viewport origin.
- The measured rect was **captured once** when the trigger was typed. The mobile
  keyboard opening scrolls the caret into view immediately afterwards, so the
  dropdown drifted by the scroll delta.
- The dropdown rendered **inline with `position: absolute`**, so any ancestor with
  `overflow` or `transform` clipped it — including ordinary chat composers.

The fix, in `@yoopta/mention` and `@yoopta/emoji`:

| Change | Where |
| --- | --- |
| Trigger + query derived from document text after every Slate change, not from keystrokes | `extenstions/withMentionSync.ts`, `extensions/withEmojiSync.ts` |
| `onDOMBeforeInput` installs the sync — fires for IME, autocorrect, dictation and paste | `plugin/*-plugin.tsx` |
| Caret measured off the trigger character (a non-collapsed range), with four fallbacks | `utils/index.ts` |
| Anchor re-measured on every reposition instead of cached | `hooks/use-*-dropdown.ts` |
| `strategy: 'fixed'` + `size()` middleware + `visualViewport` listeners | `hooks/use-*-dropdown.ts` |
| Dropdown portaled to `document.body` | `@yoopta/themes-shadcn` |
| `pointerdown` for outside-close; `preventDefault` on item press; 44px touch targets | hooks + theme |

Escape-to-dismiss is tracked per trigger range (`dismissedRange`), otherwise the
text-derived sync would immediately re-open the dropdown it just closed.

Behaviour on desktop is unchanged, including the upstream rule that a mention is
only offered when the caret sits at the end of a token.

### 2. Slate is no longer bundled into each package

Only `@yoopta/editor` and `@yoopta/themes-shadcn` declared `slate`, `slate-dom`
and `slate-react` as peer dependencies. The rollup config externalises
**peer dependencies only**, so every other package bundled its own private copy
of Slate — `@yoopta/mention` shipped 88 KB, half of it a second Slate.

Slate keeps its DOM lookups (`ReactEditor.toDOMNode` / `toDOMRange`) in
module-scoped `WeakMap`s. A second copy has empty maps, so every `ReactEditor`
call from a plugin threw and fell back to `window.getSelection()` — which is
exactly the collapsed-range path that returns nothing on WebKit.

19 packages now declare the slate peers they import. `@yoopta/mention` dropped to
40 KB and `ReactEditor` resolves against the app's Slate instance.

### 3. Test coverage

`packages/plugins/mention/src/utils/trigger-match.test.ts` covers the trigger
matcher (word boundaries, spaces, multiple triggers, caret position, query caps).

---

## Known pre-existing issues (not introduced by the fork)

- `packages/core/collaboration/src/with-collaboration.test.ts` — one failing test
  ("should auto-connect when connect is not false"), failing on upstream `master` too.
- `@yoopta/mention` has ~21 pre-existing type errors, all from `editor.mentions`
  and the `mention:*` events not being part of `YooEditor`/`YooptaEventsMap`.
  `rollup-plugin-typescript2` runs with `abortOnError: false`, so they do not fail
  the build.
- Repo-wide: intra-repo links are `peerDependencies`, which turbo does not treat
  as graph edges — hence the explicit build layering in `scripts/fork-utils.mjs`.
