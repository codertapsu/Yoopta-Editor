import type { PluginElementRenderProps, YooptaBlockData } from '@yoopta/editor';
import {
  YooptaPlugin,
  serializeTextNodes,
  serializeTextNodesIntoMarkdown,
  useYooptaEditor,
  useYooptaReadOnly,
} from '@yoopta/editor';

import { TodoListCommands } from '../commands';
import { onKeyDown } from '../events/onKeyDown';
import type { ListElementMap } from '../types';
import { deserializeListNodes } from '../utils/deserializeListNodes';

const todoListProps = {
  checked: false,
};

const TodoListRender = (props: PluginElementRenderProps) => {
  const editor = useYooptaEditor();
  const readOnly = useYooptaReadOnly();
  const checked = Boolean(props.element.props?.checked);

  return (
    <ul {...props.attributes} style={{ listStyleType: 'none' }}>
      <li
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '0.5em',
          textDecoration: checked ? 'line-through' : undefined,
          opacity: checked ? 0.7 : undefined,
        }}
      >
        {/* The list's primary interaction was previously reachable only via
            the Cmd+Enter hotkey — unusable on touch and undiscoverable
            everywhere. contentEditable={false} keeps the checkbox out of
            Slate's editable content. */}
        <span contentEditable={false} style={{ display: 'inline-flex', userSelect: 'none' }}>
          <input
            type="checkbox"
            checked={checked}
            disabled={readOnly}
            onChange={() => {
              TodoListCommands.updateTodoList(editor, props.blockId, { checked: !checked });
            }}
            onPointerDown={(e) => e.stopPropagation()}
            style={{ width: '1em', height: '1em', marginTop: '0.35em', cursor: 'pointer' }}
            aria-label={checked ? 'Mark as not done' : 'Mark as done'}
          />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>{props.children}</span>
      </li>
    </ul>
  );
};

const TodoList = new YooptaPlugin<Pick<ListElementMap, 'todo-list'>>({
  type: 'TodoList',
  elements: <todo-list render={TodoListRender} props={todoListProps} />,
  options: {
    display: {
      title: 'Todo List',
      description: 'Track tasks',
    },
    shortcuts: ['[]'],
  },
  events: {
    onKeyDown,
  },
  commands: TodoListCommands,
  parsers: {
    html: {
      deserialize: {
        nodeNames: ['OL', 'UL'],
        parse(el, editor) {
          if (el.nodeName === 'OL' || el.nodeName === 'UL') {
            const align = (el.getAttribute('data-meta-align') ||
              'left') as YooptaBlockData['meta']['align'];
            const depth = parseInt(el.getAttribute('data-meta-depth') || '0', 10);

            const deserializedList = deserializeListNodes(editor, el, {
              type: 'TodoList',
              depth,
              align,
            });
            if (deserializedList.length > 0) {
              return deserializedList;
            }
          }
        },
      },
      serialize: (element, text, blockMeta) => {
        const { align = 'left', depth = 0 } = blockMeta || {};

        return `<ul data-meta-align="${align}" data-meta-depth="${depth}" style="margin-left: ${
          depth * 20
        }px; text-align: ${align}"><li>[${element.props.checked ? 'x' : ' '}] ${serializeTextNodes(
          element.children,
        )}</li></ul>`;
      },
    },
    markdown: {
      serialize: (element, text, blockMeta) => {
        const { depth = 0 } = blockMeta || {};
        const indent = '  '.repeat(depth);
        return `${indent}- ${
          element.props.checked ? '[x]' : '[ ]'
        } ${serializeTextNodesIntoMarkdown(element.children)}`;
      },
    },
    email: {
      serialize: (element, text, blockMeta) => {
        const { align = 'left', depth = 0 } = blockMeta || {};

        return `
          <table style="width:100%;">
           <tbody style="width:100%;">
              <tr>
                <td>
                  <ul data-meta-align="${align}" data-meta-depth="${depth}" style="margin-left: ${
          depth * 20
        }px; text-align: ${align}; font-size: 16px;
    line-height: 28px;
    padding-bottom: 2px;
    padding-left: 1rem;
    padding-top: 2px;
    margin: 0;
    "><li>[${element.props.checked ? 'x' : ' '}] ${serializeTextNodes(element.children)}</li></ul>
                </td>
              </tr>
            </tbody>
          </table>
        `;
      },
    },
  },
});

export { TodoList };
