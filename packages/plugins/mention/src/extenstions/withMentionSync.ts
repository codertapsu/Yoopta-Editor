import type { SlateEditor, YooEditor } from '@yoopta/editor';

import type { MentionPluginOptions, MentionTriggerRange, MentionYooEditor } from '../types';
import { findTriggerMatch, getMentionTargetRect, getTriggers, isSameTriggerRange } from '../utils';

/** Slate editors whose `onChange` has already been wrapped. */
const SYNCED_SLATES = new WeakSet<SlateEditor>();

/**
 * Derives the mention dropdown state from the text around the caret.
 *
 * Runs after every Slate change instead of on keystrokes, because virtual
 * keyboards do not emit usable `keydown` events:
 *   - Android IMEs report `key: 'Unidentified'` / `keyCode: 229` for every
 *     printable character
 *   - iOS autocorrect/predictive text and voice dictation replace text through
 *     composition events
 * All of those still produce Slate operations, so reading the document is the
 * only input-method-agnostic way to detect a trigger.
 */
export function syncMentionState(editor: YooEditor, slate: SlateEditor, blockId: string): void {
  const { mentions } = editor as MentionYooEditor;

  // The `withMentions` editor extension is optional — degrade quietly
  if (!mentions || mentions.isApplying) return;

  const { state } = mentions;

  // A different block owns the open dropdown; its own sync will handle it
  if (state.isOpen && state.triggerRange && state.triggerRange.blockId !== blockId) return;

  const pluginOptions = editor.plugins.Mention?.options as MentionPluginOptions | undefined;
  const triggers = getTriggers(pluginOptions);
  const match = findTriggerMatch(slate, triggers);

  if (!match) {
    if (state.isOpen) mentions.close('no-match');
    else if (state.dismissedRange) mentions.setState({ dismissedRange: null });
    return;
  }

  const triggerRange: MentionTriggerRange = {
    blockId,
    path: [...match.path],
    startOffset: match.startOffset,
  };

  // The user dismissed this exact trigger (Escape / click outside) — the text
  // still matches, so without this the dropdown would immediately re-open.
  if (isSameTriggerRange(state.dismissedRange, triggerRange)) return;

  const isNewTrigger = !state.isOpen || !isSameTriggerRange(state.triggerRange, triggerRange);

  if (isNewTrigger) {
    const targetRect = getMentionTargetRect(slate, triggerRange);
    if (!targetRect) return;

    mentions.open({
      trigger: match.trigger,
      targetRect,
      triggerRange,
      query: match.query,
    });
    return;
  }

  if (state.query !== match.query) {
    mentions.setQuery(match.query);
  }
}

/**
 * Wraps a block's Slate `onChange` so mention state stays in sync with the text.
 *
 * Installed lazily from the plugin's DOM event handlers: a mention can only
 * start existing in a block the user is typing into, and typing always fires
 * `keydown`/`beforeinput` first. Idempotent per Slate editor instance.
 */
export function installMentionSync(editor: YooEditor, slate: SlateEditor, blockId: string): void {
  if (!slate || SYNCED_SLATES.has(slate)) return;
  if (!(editor as MentionYooEditor).mentions) return;

  SYNCED_SLATES.add(slate);

  const { onChange } = slate;

  slate.onChange = (options) => {
    onChange(options);

    try {
      syncMentionState(editor, slate, blockId);
    } catch {
      // never let mention state break the editor's change pipeline
    }
  };
}
