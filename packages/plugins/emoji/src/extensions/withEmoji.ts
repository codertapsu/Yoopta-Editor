import type { YooEditor } from '@yoopta/editor';

import type {
  EmojiCloseEvent,
  EmojiOpenParams,
  EmojiPluginOptions,
  EmojiState,
  EmojiYooEditor,
} from '../types';
import { INITIAL_EMOJI_STATE } from '../types';

// Type-safe emit helper for emoji events
type EmojiEmit = (event: string, payload: unknown) => void;

/**
 * Close reasons that mean "the user does not want this dropdown right now".
 * The trigger range is remembered so the text sync does not immediately
 * re-open the dropdown for the same still-matching `:query` text.
 */
const DISMISSING_REASONS: EmojiCloseEvent['reason'][] = ['escape', 'click-outside', 'manual'];

export function withEmoji(editor: YooEditor): EmojiYooEditor {
  const emojiEditor = editor as EmojiYooEditor;

  let state: EmojiState = { ...INITIAL_EMOJI_STATE };

  // Cast emit to allow custom emoji events
  const emit = editor.emit as EmojiEmit;
  const { plugins } = editor;

  emojiEditor.emoji = {
    get state() {
      return state;
    },
    setState: (newState: Partial<EmojiState>) => {
      state = { ...state, ...newState };
    },
    open: (params: EmojiOpenParams) => {
      const pluginOptions = plugins.Emoji?.options as EmojiPluginOptions | undefined;
      const query = params.query ?? '';

      state = {
        isOpen: true,
        query,
        trigger: params.trigger,
        targetRect: params.targetRect,
        triggerRange: params.triggerRange,
        dismissedRange: null,
      };

      emit('emoji:open', {
        trigger: params.trigger,
        query,
        targetRect: params.targetRect,
      });

      if (pluginOptions?.onOpen) {
        pluginOptions.onOpen(params.trigger);
      }
    },
    close: (reason: EmojiCloseEvent['reason'] = 'manual') => {
      const pluginOptions = plugins.Emoji?.options as EmojiPluginOptions | undefined;

      const shouldRemember = DISMISSING_REASONS.includes(reason) && state.triggerRange !== null;

      state = {
        ...INITIAL_EMOJI_STATE,
        dismissedRange: shouldRemember ? state.triggerRange : null,
      };

      emit('emoji:close', { reason });

      if (pluginOptions?.onClose) {
        pluginOptions.onClose();
      }
    },
    setQuery: (query: string) => {
      state = { ...state, query };

      emit('emoji:query-change', {
        query,
        trigger: state.trigger,
      });
    },
    selectCurrentItem: null,
    isApplying: false,
  };

  return emojiEditor;
}
