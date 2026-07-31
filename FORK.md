# codertapsu/Yoopta-Editor — fork notes

A fork of [yoopta-editor/Yoopta-Editor](https://github.com/yoopta-editor/Yoopta-Editor)
that ships as tarballs installed straight from GitHub, so fixes can land in our
apps without waiting on an upstream release.

- `origin`   → `codertapsu/Yoopta-Editor` (this fork)
- `upstream` → `yoopta-editor/Yoopta-Editor` (push disabled)

---

## Installing in an app

Packages are published as **GitHub release assets**. Copy the block from
[`dist-packages/dependencies.json`](./dist-packages/dependencies.json) into your
app's `package.json` and reinstall:

```json
"@yoopta/editor": "https://github.com/codertapsu/Yoopta-Editor/releases/download/v6.0.5-codertapsu.2/yoopta-editor-6.0.5-codertapsu.2.tgz",
"@yoopta/mention": "https://github.com/codertapsu/Yoopta-Editor/releases/download/v6.0.5-codertapsu.2/yoopta-mention-6.0.5-codertapsu.2.tgz"
```

You also need `react`, `react-dom`, `slate`, `slate-dom` and `slate-react` in your
own dependencies — they are peers, not bundled.

Release-asset URLs are used rather than `raw.githubusercontent.com/master/…`
because they are **immutable**: a branch path serves whatever is at the head, so a
force-push would change the bytes behind a URL consumers have already pinned. It
also keeps several MB of binaries per release out of git history.

**Two rules that will bite otherwise:**

1. **Upgrade every `@yoopta/*` entry together.** The tarballs reference each other
   by URL. Mixing revisions makes npm install two copies of `@yoopta/editor`,
   and two editor instances means broken React context and dead Slate DOM maps.
2. **Never republish a release tag.** npm caches by URL and lockfiles pin an
   integrity hash — changing the bytes behind an existing URL fails installs with
   `EINTEGRITY`. Bump the revision instead (`yarn fork:revision`), which changes
   both the tag and the filenames. `fork:pack` and `fork:publish` both refuse to
   reuse an existing tag.

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

Either run the **Fork release** workflow from the Actions tab, or locally:

```bash
yarn install
yarn fork:revision          # bump; use `yarn fork:revision 1` after an upstream version bump
git commit -am "chore(fork): revision 3"
yarn fork:pack              # builds everything, writes dist-packages/
yarn fork:publish           # creates the GitHub release with the tarballs attached
git add dist-packages && git commit -m "chore(fork): manifest for v6.0.5-codertapsu.3"
git push origin master
```

Commit before packing: the tarballs record the source commit under `yooptaFork`,
and `fork:pack` refuses to build from a dirty tree (`--allow-dirty` overrides for
local experiments).

`yarn fork:notes` previews the generated release notes without publishing.

`yarn fork:pack` does four things that plain `npm pack` does not:

- builds packages in **explicit dependency order** — turbo cannot infer it,
  because intra-repo links are declared as `peerDependencies`, which are not part
  of the workspace graph. Building in parallel makes plugins compile before
  `@yoopta/editor`'s `dist` exists and emit degraded `.d.ts` files;
- rewrites intra-repo `@yoopta/*` dependencies to the matching tarball URLs;
- stamps `version` with the fork suffix and records provenance (upstream version,
  revision, release tag, source commit) under `yooptaFork`;
- repoints `repository`, `homepage` and `bugs` at this fork rather than upstream.

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
FORK.md  fork.config.json  dist-packages/
scripts/fork-utils.mjs  scripts/pack-fork.mjs  scripts/publish-release.mjs
scripts/sync-upstream.mjs  scripts/set-fork-revision.mjs
.github/workflows/ci.yml  .github/workflows/fork-release.yml
.github/workflows/upstream-sync.yml
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

### 3. Cross-platform & responsiveness audit (v6.0.5-codertapsu.3)

A 10-area audit of every package (core editor, core UI, all plugins, all three
themes, every stylesheet) followed by fixes. Highlights, grouped by what broke:

**Broken on mobile input (same IME root cause as the original mention bug):**

- Slash command menu — the '/' trigger was `event.key`-based, so it never opened
  on Android; it is now derived from the document text via the `input` event,
  with the WebKit collapsed-caret rect fallback, a live re-measured anchor and
  `visualViewport` tracking. The over-broad key detection that opened the menu
  on '?' is gone.
- Block drag-and-drop — dnd-kit had no touch sensor and the handle allowed the
  browser to claim the gesture for scrolling. Touch drags now start with a
  250ms long-press; the handle sets `touch-action: none`.
- Table column resize (shadcn) — mouse-only listeners became pointer events
  with `pointercancel` handling; handles grew a 24px touch hit area.
- Hover-only affordances — link/mention/math hover cards (shadcn) and the
  material link popover now toggle on tap on coarse pointers;
  `opacity-0 group-hover` control reveals are visible on touch; table row/column
  controls appear when tapping into a cell; the base todo-list finally renders a
  tappable checkbox (it had NO checkbox, and toggling was Cmd+Enter-only).
- Focus stealing — buttons in the floating toolbar, block actions, slash items,
  action menu, highlight picker and material image toolbar now `preventDefault`
  on `pointerdown`, so a tap no longer blurs the contenteditable and collapses
  the keyboard. Form fields inside popovers are exempt (they need the focus).

**Plain logic bugs the audit surfaced (all platforms):**

- Pasting HTML with images collapsed every image to 0x0: `limitSizes` divided
  by the unconfigured max (0), producing an Infinity ratio. Now covered by
  regression tests.
- The video paste handler read `editor.plugins.Image` — crashing when Image was
  not registered — and its render dereferenced optional props bare.
- Every carousel command was a silent no-op: they searched for a
  `carousel-list` element the plugin never creates.
- Accordion items always rendered collapsed: `isExpanded` was never bound to
  the `<details>` `open` attribute.
- The table Cmd+Shift+H/V hotkeys compared `event.key` case-sensitively, but
  Shift reports uppercase keys — dead code since it shipped.
- The material link popover initialized open and its `onMouseLeave` re-set open
  to `true` — every link's popover was permanently stuck on screen.
- The material theme rendered `<thead>` inside `<tr>` for header cells (invalid
  HTML that breaks SSR hydration); now `<th>`.
- The base table/todo renders spread config objects onto the DOM and duplicated
  Slate's node-ref attributes across two elements.
- `insertMention`'s focus path reset the caret to block start (the same bug the
  emoji plugin had already fixed).

**Responsive (the small-screen pass):**

- Viewport clamps on every floating surface: slash menu, action menu (+ fixed
  strategy so overflow ancestors cannot clip it), floating toolbar (wraps),
  block options, element options, highlight picker, image/video settings
  popovers, material link popover.
- Overflow-scroll containers for wide content: tables (base + material), code
  blocks, math blocks. `max-width: 100%` clamps for image/video/embed renders
  (embed keeps its aspect ratio), material react-rnd images, shadcn carousel
  nav buttons stay inside the viewport, placeholder text ellipsizes instead of
  forcing horizontal scroll.
- `@media (pointer: coarse)` touch-target bumps across core UI and themes
  (drag handle, block actions, color presets, slider thumbs, todo checkbox,
  table selection trigger, resize handles); 16px inputs stop iOS auto-zoom.

**Browser compat & SSR:**

- `ClipboardItem` feature-detected everywhere (Firefox <127, non-secure
  contexts), with plain-text fallback and no unhandled promise rejections.
- SSR guards: `getPlainText` works without a DOM, `deserializeHTML` fails with
  an actionable message, collaboration no longer constructs a WebSocket on the
  server, math components no longer read `navigator.userAgent` during render,
  and `@yoopta/code` no longer eagerly builds a ~60-language shiki highlighter
  at import time (idle-warmed in the browser instead).
- `scrollIntoView` options feature-detected (old WebKit treats the object as a
  boolean); `content-visibility` blocks got `contain-intrinsic-size`; the
  shadcn `::selection` color follows the theme (it was hardcoded light-blue,
  unreadable in dark mode); the inline-code mark tints `currentColor` instead
  of hardcoding a light-gray background.

**Known limitations (deliberately not "fixed"):**

- Multi-block drag selection remains mouse/keyboard-only. On touch, dragging a
  finger must scroll the page; a proper mobile selection model (long-press to
  enter selection mode) is a feature, not a fix, and is out of scope here.
  Single-block interactions and the block actions menu work on touch.
- The base Table plugin's insert/delete row/column operations are
  keyboard-shortcut-only by design (it is headless); the shadcn theme's tap
  controls are the touch path.
- `slate-editor-component` defers state sync through `scheduler.postTask` at
  background priority on Chromium — upstream's perf trade-off, left unchanged.

### 4. Test coverage and CI

`packages/plugins/mention/src/utils/trigger-match.test.ts` covers the trigger
matcher (word boundaries, spaces, multiple triggers, caret position, query caps).

`with-collaboration.test.ts` asserted that `connect` defaults to **true**, while
both the implementation (`if (config.connect === true)`) and the documented
contract (`/** Whether to connect immediately (default: false) */`) say the
opposite. The stale assertion was corrected and a case added for `connect: true`,
which previously had no coverage. The suite is now fully green (626 tests), so CI
can gate on it rather than tolerating a known failure.

`.github/workflows/ci.yml` runs install (`--immutable`, so a stale `yarn.lock`
fails loudly), tests, an ordered build, and a guard that greps each built bundle
for a privately bundled Slate — the exact defect described above, which is easy to
reintroduce by adding a `slate` import without touching `peerDependencies`.

---

## Known pre-existing issues (not introduced by the fork)

- `@yoopta/mention` has ~21 pre-existing type errors, all from `editor.mentions`
  and the `mention:*` events not being part of `YooEditor`/`YooptaEventsMap`.
  `rollup-plugin-typescript2` runs with `abortOnError: false`, so they do not fail
  the build.
- Repo-wide: intra-repo links are `peerDependencies`, which turbo does not treat
  as graph edges — hence the explicit build layering in `scripts/fork-utils.mjs`.
- `yarn lint` needs `NODE_OPTIONS=--max-old-space-size=8192`; the airbnb-typescript
  config runs out of memory across the whole monorepo otherwise.
