import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { PluginElementRenderProps } from '@yoopta/editor';
import { YooptaPlugin, generateId } from '@yoopta/editor';

import { MentionCommands } from '../commands/mention-commands';
import { installMentionSync } from '../extenstions/withMentionSync';
import type {
  MentionElementMap,
  MentionElementProps,
  MentionPluginOptions,
  MentionYooEditor,
} from '../types';

const DefaultMentionRender = (props: PluginElementRenderProps) => {
  const { element, attributes, children } = props;
  const { name } = element.props as MentionElementProps;

  return (
    <span {...attributes} contentEditable={false} data-mention>
      @{name}
      {children}
    </span>
  );
};

const defaultMentionProps = {
  id: '',
  name: '',
  avatar: '',
  type: undefined,
  meta: undefined,
};

const Mention = new YooptaPlugin<MentionElementMap, MentionPluginOptions>({
  type: 'Mention',
  elements: (
    <mention
      render={DefaultMentionRender}
      props={defaultMentionProps}
      nodeType="inlineVoid"
    />
  ),
  options: {
    display: {
      title: 'Mention',
      description: 'Mention a user or resource',
    },
    char: '@',
  },
  commands: MentionCommands,
  parsers: {
    html: {
      deserialize: {
        nodeNames: ['SPAN'],
        parse: (el) => {
          if (el.nodeName === 'SPAN' && el.dataset.mentionId) {
            return {
              id: generateId(),
              type: 'mention',
              children: [{ text: '' }],
              props: {
                id: el.dataset.mentionId ?? '',
                name: el.dataset.mentionName ?? el.textContent ?? '',
                avatar: el.dataset.mentionAvatar ?? '',
                type: el.dataset.mentionType ?? undefined,
                nodeType: 'inlineVoid',
              },
            };
          }
        },
      },
      serialize: (element) => {
        const { id, name, avatar, type } = element.props ?? {};
        return `<span data-mention data-mention-id="${id}" data-mention-name="${name}" data-mention-avatar="${avatar ?? ''}" data-mention-type="${type ?? ''}" style="color: #2563eb; font-weight: 500;">@${name}</span>`;
      },
    },
    markdown: {
      serialize: (element) => `@${element.props?.name ?? ''}`,
    },
    email: {
      serialize: (element) => {
        const { name } = element.props ?? {};
        return `<span style="color: #2563eb; font-weight: 500;">@${name}</span>`;
      },
    },
  },
  extensions: (slate) => {
    const { markableVoid, isInline } = slate;

    slate.markableVoid = (element) => element.type === 'mention' || markableVoid(element);
    slate.isInline = (element) => element.type === 'mention' || isInline(element);

    return slate;
  },
  events: {
    /**
     * Trigger detection and query tracking are NOT done here.
     *
     * They are derived from the document text by `installMentionSync`, because
     * virtual keyboards (Android IME, iOS autocorrect, voice dictation) do not
     * report the typed character in `keydown` — `event.key` arrives as
     * `'Unidentified'` with `keyCode: 229`. This handler only deals with the
     * physical-keyboard interactions that have no text equivalent.
     */
    onKeyDown: (baseEditor, slate, options) => (event: ReactKeyboardEvent) => {
      const editor = baseEditor as MentionYooEditor;
      if (!editor.mentions) return;

      const currentBlock = options.currentBlock;
      if (currentBlock) installMentionSync(editor, slate, currentBlock.id);

      const mentionState = editor.mentions.state;
      if (!mentionState.isOpen) return;

      const pluginOptions = baseEditor.plugins.Mention?.options as MentionPluginOptions | undefined;
      const { key } = event;

      // Enter inserts the currently selected mention and prevents block handlers
      if (key === 'Enter' && !event.nativeEvent.isComposing) {
        event.preventDefault();
        if (editor.mentions.selectCurrentItem) {
          editor.mentions.selectCurrentItem();
        }
        return;
      }

      // Arrow keys navigate the dropdown — prevent block handlers from running
      if (key === 'ArrowUp' || key === 'ArrowDown') {
        event.preventDefault();
        return;
      }

      // Escape closes dropdown
      if (key === 'Escape' && pluginOptions?.closeOnEscape !== false) {
        event.preventDefault();
        editor.mentions.close('escape');
      }
    },

    /**
     * Primary hook for mobile. `beforeinput` fires for every input method —
     * IME composition, autocorrect replacement, dictation, paste — and runs
     * before Slate applies the change, so wiring the text sync here guarantees
     * the following `onChange` is observed.
     */
    onDOMBeforeInput: (baseEditor, slate, options) => () => {
      const editor = baseEditor as MentionYooEditor;
      if (!editor.mentions) return;

      const currentBlock = options.currentBlock;
      if (currentBlock) installMentionSync(editor, slate, currentBlock.id);
    },
  },
});

export { Mention };
