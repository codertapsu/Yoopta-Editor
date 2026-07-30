import type { YooEditor } from '@yoopta/editor';
import { Blocks } from '@yoopta/editor';
import { Editor, Node, Path, Range, Text, Transforms } from 'slate';
import { ReactEditor } from 'slate-react';

import type {
  EmojiCloseEvent,
  EmojiItem,
  EmojiPluginOptions,
  EmojiState,
  EmojiTargetRect,
  EmojiTrigger,
  EmojiYooEditor,
} from '../types';
import { INITIAL_EMOJI_STATE } from '../types';

// Helper to safely access emoji state
function getEmojiEditor(editor: YooEditor): EmojiYooEditor {
  return editor as EmojiYooEditor;
}

export type EmojiCommandsType = {
  // Insert emoji as plain text, replacing the trigger + query
  insertEmoji: (editor: YooEditor, item: EmojiItem) => void;

  // Dropdown control
  openDropdown: (
    editor: YooEditor,
    params: {
      trigger: EmojiTrigger;
      targetRect: EmojiTargetRect;
      triggerRange: EmojiState['triggerRange'];
    },
  ) => void;
  closeDropdown: (editor: YooEditor, reason?: EmojiCloseEvent['reason']) => void;

  // State
  getState: (editor: YooEditor) => EmojiState;
  getQuery: (editor: YooEditor) => string;
  setQuery: (editor: YooEditor, query: string) => void;
  getTrigger: (editor: YooEditor) => EmojiTrigger | null;

  // Utilities
  getTriggers: (editor: YooEditor) => EmojiTrigger[];
  getTriggerByChar: (editor: YooEditor, char: string) => EmojiTrigger | undefined;
};

export const EmojiCommands: EmojiCommandsType = {
  insertEmoji: (editor, item) => {
    const emojiEditor = getEmojiEditor(editor);
    const state = emojiEditor.emoji.state;
    if (!state.triggerRange) return;

    const { blockId, path, startOffset } = state.triggerRange;
    const slateEditor = Blocks.getBlockSlate(editor, { id: blockId });
    if (!slateEditor) return;

    const trigger = state.trigger;
    const query = state.query;
    const triggerLength = trigger?.char.length ?? 1;

    // Resolve the text node the trigger lives in. Bail out instead of throwing
    // if the document moved on since the dropdown opened.
    let node: Node;
    try {
      node = Node.get(slateEditor, path);
    } catch {
      emojiEditor.emoji.close('no-match');
      return;
    }
    if (!Text.isText(node) || startOffset > node.text.length) {
      emojiEditor.emoji.close('no-match');
      return;
    }

    // Prefer the live caret position over the tracked query length — they can
    // diverge when an IME replaces a whole word at once.
    const caretOffset =
      slateEditor.selection &&
      Range.isCollapsed(slateEditor.selection) &&
      Path.equals(slateEditor.selection.anchor.path, path)
        ? slateEditor.selection.anchor.offset
        : startOffset + triggerLength + query.length;

    const endOffset = Math.min(
      Math.max(caretOffset, startOffset + triggerLength),
      node.text.length,
    );

    // Suppress the text sync: the intermediate states below would otherwise be
    // read as "the trigger text changed" and re-open the dropdown.
    emojiEditor.emoji.isApplying = true;

    try {
      Editor.withoutNormalizing(slateEditor, () => {
        // Select the range from trigger start to current position
        Transforms.select(slateEditor, {
          anchor: { path, offset: startOffset },
          focus: { path, offset: endOffset },
        });

        // Delete the trigger + query text, then insert the emoji unicode character
        Transforms.delete(slateEditor);
        Transforms.insertText(slateEditor, item.emoji);
      });
    } finally {
      emojiEditor.emoji.isApplying = false;
    }

    // Close dropdown
    const pluginOptions = editor.plugins.Emoji?.options as EmojiPluginOptions | undefined;
    if (pluginOptions?.closeOnSelect !== false) {
      emojiEditor.emoji.close('select');
    }

    // Ensure DOM focus stays on the Slate editor without moving the cursor.
    // (focusBlock would reset cursor to start; ReactEditor.focus preserves selection)
    ReactEditor.focus(slateEditor as ReactEditor);

    // Trigger onSelect callback
    if (pluginOptions?.onSelect && trigger) {
      pluginOptions.onSelect(item, trigger);
    }
  },

  openDropdown: (editor, params) => {
    getEmojiEditor(editor).emoji.open(params);
  },

  closeDropdown: (editor, reason = 'manual') => {
    getEmojiEditor(editor).emoji.close(reason);
  },

  getState: (editor) => getEmojiEditor(editor).emoji?.state ?? INITIAL_EMOJI_STATE,

  getQuery: (editor) => getEmojiEditor(editor).emoji?.state.query ?? '',

  setQuery: (editor, query) => {
    getEmojiEditor(editor).emoji.setQuery(query);
  },

  getTrigger: (editor) => getEmojiEditor(editor).emoji?.state.trigger ?? null,

  getTriggers: (editor) => {
    const options = editor.plugins.Emoji?.options as EmojiPluginOptions | undefined;
    if (!options) return [{ char: ':' }];

    if (options.triggers && options.triggers.length > 0) {
      return options.triggers;
    }

    return [{ char: options.char ?? ':' }];
  },

  getTriggerByChar: (editor, char) => {
    const triggers = EmojiCommands.getTriggers(editor);
    return triggers.find((t) => t.char === char);
  },
};
