import { YooptaPlugin } from '@yoopta/editor';

import { TableCommands } from '../commands/table-commands';
import { onKeyDown } from '../events/onKeyDown';
import { withTable } from '../extenstions/withTable';
import { serializeTableToEmail } from '../parsers/email/serialize';
import { deserializeTable } from '../parsers/html/deserialize';
import { serializeMarkown } from '../parsers/markdown/serialize';
import type { TableDataCellElementProps, TableElementMap, TableElementProps } from '../types';
import { TABLE_CELLS_IN_SELECTION, TABLE_SLATE_TO_SELECTION_SET } from '../utils/weakMaps';

const tableDataCellProps: TableDataCellElementProps = {
  asHeader: false,
  verticalAlign: 'top',
  align: 'left',
  colSpan: 1,
  rowSpan: 1,
  backgroundColor: undefined,
  color: undefined,
};

const tableProps: TableElementProps = {
  headerRow: false,
  headerColumn: false,
  columnWidths: [200, 200, 200],
};

const Table = new YooptaPlugin<TableElementMap>({
  type: 'Table',
  elements: (
    <table
      render={(props) => (
        // Slate attributes belong on exactly one element (they carry the node
        // ref — duplicating them on tbody broke the DOM mapping), and the
        // tableProps config object is editor state, not DOM attributes. The
        // wrapper gives wide tables their own scroll context on narrow screens.
        <div {...props.attributes} style={{ overflowX: 'auto', maxWidth: '100%' }}>
          <table>
            <tbody>{props.children}</tbody>
          </table>
        </div>
      )}
      nodeType="block">
      <table-row
        render={(props) => <tr {...props.attributes}>{props.children}</tr>}
        nodeType="block">
        <table-data-cell
          render={(props) => <td {...props.attributes}>{props.children}</td>}
          props={tableDataCellProps}
          nodeType="block"
        />
      </table-row>
    </table>
  ),
  events: {
    onKeyDown,
    onBlur: (_, slate) => () => {
      // Clear selection on blur
      TABLE_SLATE_TO_SELECTION_SET.delete(slate);
      TABLE_CELLS_IN_SELECTION.delete(slate);
    },
  },
  lifecycle: {
    beforeCreate: (editor) => TableCommands.buildTableElements(editor, { rows: 3, columns: 3, columnWidth: 200 }),
  },
  parsers: {
    html: {
      deserialize: {
        nodeNames: ['TABLE'],
        parse: deserializeTable,
      },
    },
    markdown: {
      serialize: serializeMarkown,
    },
    email: {
      serialize: serializeTableToEmail,
    },
  },
  extensions: withTable,
  options: {
    display: {
      title: 'Table',
      description: 'Add simple table',
    },
    shortcuts: ['table', '||', '3x3'],
  },
  commands: TableCommands,
});

export { Table };
