
/**
 * Ensures editor has mention state initialized
 * Called lazily when needed
 */

import type { YooEditor } from "@yoopta/editor";

import type { MentionCloseEvent, MentionOpenParams, MentionPluginOptions, MentionState, MentionYooEditor } from "../types";
import { INITIAL_MENTION_STATE } from "../types";

// Type-safe emit helper for mention events
type MentionEmit = (event: string, payload: unknown) => void;

/**
 * Close reasons that mean "the user does not want this dropdown right now".
 * The trigger range is remembered so the text sync does not immediately
 * re-open the dropdown for the same still-matching `@query` text.
 */
const DISMISSING_REASONS: MentionCloseEvent['reason'][] = ['escape', 'click-outside', 'manual'];

// [TODO] - add throw error if this extenstion not applied to editor instance
export function withMentions(editor: YooEditor): MentionYooEditor {
  const mentionEditor = editor as MentionYooEditor;

  let state: MentionState = { ...INITIAL_MENTION_STATE };

  // Cast emit to allow custom mention events
  const emit = editor.emit as MentionEmit;
  const { plugins } = editor;

  mentionEditor.mentions = {
    get state() {
      return state;
    },
    setState: (newState: Partial<MentionState>) => {
      state = { ...state, ...newState };
    },
    open: (params: MentionOpenParams) => {
      const pluginOptions = plugins.Mention?.options as MentionPluginOptions | undefined;
      const query = params.query ?? '';

      state = {
        isOpen: true,
        query,
        trigger: params.trigger,
        targetRect: params.targetRect,
        triggerRange: params.triggerRange,
        dismissedRange: null,
      };

      emit('mention:open', {
        trigger: params.trigger,
        query,
        targetRect: params.targetRect,
      });

      if (pluginOptions?.onOpen) {
        pluginOptions.onOpen(params.trigger);
      }
    },
    close: (reason: MentionCloseEvent['reason'] = 'manual') => {
      const pluginOptions = plugins.Mention?.options as MentionPluginOptions | undefined;

      const shouldRemember = DISMISSING_REASONS.includes(reason) && state.triggerRange !== null;

      state = {
        ...INITIAL_MENTION_STATE,
        dismissedRange: shouldRemember ? state.triggerRange : null,
      };

      emit('mention:close', { reason });

      if (pluginOptions?.onClose) {
        pluginOptions.onClose();
      }
    },
    setQuery: (query: string) => {
      state = { ...state, query };

      emit('mention:query-change', {
        query,
        trigger: state.trigger,
      });
    },
    selectCurrentItem: null,
    isApplying: false,
  };

  return mentionEditor;
}
