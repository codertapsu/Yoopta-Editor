import type { SlateEditor, YooEditor } from '@yoopta/editor';

import type { EmojiPluginOptions, EmojiTriggerRange, EmojiYooEditor } from '../types';
import { findTriggerMatch, getEmojiTargetRect, getTriggers, isSameTriggerRange } from '../utils';

/** Slate editors whose `onChange` has already been wrapped. */
const SYNCED_SLATES = new WeakSet<SlateEditor>();

/**
 * Derives the emoji dropdown state from the text around the caret.
 *
 * Runs after every Slate change instead of on keystrokes, because virtual
 * keyboards do not emit usable `keydown` events — Android IMEs report
 * `key: 'Unidentified'` / `keyCode: 229`, and iOS autocorrect replaces text
 * through composition events. Both still produce Slate operations.
 */
export function syncEmojiState(editor: YooEditor, slate: SlateEditor, blockId: string): void {
  const { emoji } = editor as EmojiYooEditor;

  // The `withEmoji` editor extension is optional — degrade quietly
  if (!emoji || emoji.isApplying) return;

  const { state } = emoji;

  // A different block owns the open dropdown; its own sync will handle it
  if (state.isOpen && state.triggerRange && state.triggerRange.blockId !== blockId) return;

  const pluginOptions = editor.plugins.Emoji?.options as EmojiPluginOptions | undefined;
  const triggers = getTriggers(pluginOptions);
  const match = findTriggerMatch(slate, triggers);

  if (!match) {
    if (state.isOpen) emoji.close('no-match');
    else if (state.dismissedRange) emoji.setState({ dismissedRange: null });
    return;
  }

  const triggerRange: EmojiTriggerRange = {
    blockId,
    path: [...match.path],
    startOffset: match.startOffset,
  };

  // The user dismissed this exact trigger — the text still matches, so without
  // this the dropdown would immediately re-open.
  if (isSameTriggerRange(state.dismissedRange, triggerRange)) return;

  const isNewTrigger = !state.isOpen || !isSameTriggerRange(state.triggerRange, triggerRange);

  if (isNewTrigger) {
    const targetRect = getEmojiTargetRect(slate, triggerRange);
    if (!targetRect) return;

    emoji.open({
      trigger: match.trigger,
      targetRect,
      triggerRange,
      query: match.query,
    });
    return;
  }

  if (state.query !== match.query) {
    emoji.setQuery(match.query);
  }
}

/**
 * Wraps a block's Slate `onChange` so emoji state stays in sync with the text.
 * Installed lazily from the plugin's DOM event handlers; idempotent per editor.
 */
export function installEmojiSync(editor: YooEditor, slate: SlateEditor, blockId: string): void {
  if (!slate || SYNCED_SLATES.has(slate)) return;
  if (!(editor as EmojiYooEditor).emoji) return;

  SYNCED_SLATES.add(slate);

  const { onChange } = slate;

  slate.onChange = (options) => {
    onChange(options);

    try {
      syncEmojiState(editor, slate, blockId);
    } catch {
      // never let emoji state break the editor's change pipeline
    }
  };
}
