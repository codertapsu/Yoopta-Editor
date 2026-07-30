import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { PluginElementRenderProps } from '@yoopta/editor';
import { YooptaPlugin } from '@yoopta/editor';

import { EmojiCommands } from '../commands/emoji-commands';
import { installEmojiSync } from '../extensions/withEmojiSync';
import type { EmojiElementMap, EmojiPluginOptions, EmojiYooEditor } from '../types';

// Transparent inline render — never actually inserted, exists only so the
// editor's inline-plugin event-handler pipeline picks up Emoji's onKeyDown.
const EmojiRender = (props: PluginElementRenderProps) => (
  <span {...props.attributes}>{props.children}</span>
);

const Emoji = new YooptaPlugin<EmojiElementMap, EmojiPluginOptions>({
  type: 'Emoji',
  // eslint-disable-next-line react/no-unknown-property
  elements: <emoji render={EmojiRender} props={{ nodeType: 'inline' }} nodeType="inline" />,
  options: {
    display: {
      title: 'Emoji',
      description: 'Insert emoji with :shortcode',
    },
  },
  commands: EmojiCommands,
  events: {
    /**
     * Trigger detection and query tracking are NOT done here.
     *
     * They are derived from the document text by `installEmojiSync`, because
     * virtual keyboards (Android IME, iOS autocorrect, voice dictation) do not
     * report the typed character in `keydown` — `event.key` arrives as
     * `'Unidentified'` with `keyCode: 229`. This handler only deals with the
     * physical-keyboard interactions that have no text equivalent.
     */
    onKeyDown: (baseEditor, slate, options) => (event: ReactKeyboardEvent) => {
      const editor = baseEditor as EmojiYooEditor;
      if (!editor.emoji) return;

      const currentBlock = options.currentBlock;
      if (currentBlock) installEmojiSync(editor, slate, currentBlock.id);

      const emojiState = editor.emoji.state;
      if (!emojiState.isOpen) return;

      const pluginOptions = baseEditor.plugins.Emoji?.options as EmojiPluginOptions | undefined;

      // Enter inserts the currently selected emoji and prevents new block creation
      if (options.hotkeys.isEnter(event) && !event.nativeEvent.isComposing) {
        event.preventDefault();
        if (editor.emoji.selectCurrentItem) {
          editor.emoji.selectCurrentItem();
        }
        return;
      }

      // Arrow keys navigate the dropdown — prevent default so the editor
      // doesn't move the cursor or scroll.
      if (options.hotkeys.isArrowUp(event) || options.hotkeys.isArrowDown(event)) {
        event.preventDefault();
        return;
      }

      // Escape closes dropdown
      if (options.hotkeys.isEscape(event) && pluginOptions?.closeOnEscape !== false) {
        event.preventDefault();
        editor.emoji.close('escape');
      }
    },

    /**
     * Primary hook for mobile. `beforeinput` fires for every input method —
     * IME composition, autocorrect replacement, dictation, paste — and runs
     * before Slate applies the change, so wiring the text sync here guarantees
     * the following `onChange` is observed.
     */
    onDOMBeforeInput: (baseEditor, slate, options) => () => {
      const editor = baseEditor as EmojiYooEditor;
      if (!editor.emoji) return;

      const currentBlock = options.currentBlock;
      if (currentBlock) installEmojiSync(editor, slate, currentBlock.id);
    },
  },
});

export { Emoji };
