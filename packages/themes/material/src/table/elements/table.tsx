import Box from '@mui/material/Box';
import MuiTable from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import type { PluginElementRenderProps } from '@yoopta/editor';

export const Table = (props: PluginElementRenderProps) => {
  const { attributes, children } = props;

  return (
    // Slate attributes live on the scroll wrapper so wide tables get their own
    // horizontal scroll context instead of forcing page-level overflow on
    // phones
    <Box {...attributes} sx={{ overflowX: 'auto', maxWidth: '100%' }}>
      <MuiTable
        sx={{
          width: '100%',
          borderCollapse: 'collapse',
          '& .MuiTableCell-root': {
            border: '1px solid',
            borderColor: 'divider',
          },
        }}>
        <TableBody>{children}</TableBody>
      </MuiTable>
    </Box>
  );
};
