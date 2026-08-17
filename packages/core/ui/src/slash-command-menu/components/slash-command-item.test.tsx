import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { SlashCommandContext } from '../context/slash-command-context';
import type { SlashCommandContextValue, SlashCommandItem as ItemData } from '../types';
import { SlashCommandItem } from './slash-command-item';

const ITEMS: ItemData[] = [
  { id: 'Image', title: 'Image' },
  { id: 'Video', title: 'Video' },
  { id: 'Table', title: 'Table' },
];

function renderItems(selectedIndex: number) {
  const actionHandlers = {
    open: vi.fn(),
    close: vi.fn(),
    setSearch: vi.fn(),
    selectItem: vi.fn(),
    executeSelected: vi.fn(),
    executeItem: vi.fn(),
  };

  const value = {
    state: {
      isOpen: true,
      search: '',
      selectedIndex,
      virtualElement: null,
      floatingContext: null,
    },
    actionHandlers,
    items: ITEMS,
    filteredItems: ITEMS,
    groupedItems: new Map(),
    refs: {},
    floatingStyles: {},
  } as unknown as SlashCommandContextValue;

  const wrapper = ({ children }: { children: ReactNode }) => (
    <SlashCommandContext.Provider value={value}>{children}</SlashCommandContext.Provider>
  );

  render(
    <>
      {ITEMS.map((item) => (
        <SlashCommandItem key={item.id} value={item.id} title={item.title} />
      ))}
    </>,
    { wrapper },
  );

  return actionHandlers;
}

describe('SlashCommandItem', () => {
  beforeAll(() => {
    // The selected item scrolls itself into view on mount, and jsdom does not
    // implement scrollIntoView.
    Element.prototype.scrollIntoView = vi.fn();
  });

  /**
   * The regression this file exists for.
   *
   * A tap used to call `selectItem(i)` then `executeSelected()` in the same
   * tick. `selectItem` only schedules a state update, so `executeSelected` read
   * the PRE-TAP index and ran that item instead. On desktop `mouseenter` had
   * already moved the index a tick earlier, so it looked correct; on a touch
   * device nothing ever hovers, the index sits at 0, and every tap inserted the
   * first item in the list.
   *
   * Asserting `executeItem` was called with the tapped index — and that the
   * index-free `executeSelected` was NOT used — pins both halves.
   */
  it('runs the tapped item even when the selection is still on another one', () => {
    const actionHandlers = renderItems(0);

    fireEvent.click(screen.getByText('Table'));

    expect(actionHandlers.executeItem).toHaveBeenCalledWith(2);
    expect(actionHandlers.executeSelected).not.toHaveBeenCalled();
  });

  it('runs the tapped item when the selection is on a different one still', () => {
    const actionHandlers = renderItems(2);

    fireEvent.click(screen.getByText('Video'));

    expect(actionHandlers.executeItem).toHaveBeenCalledWith(1);
  });

  it('still runs the right item when selection and tap agree', () => {
    const actionHandlers = renderItems(1);

    fireEvent.click(screen.getByText('Video'));

    expect(actionHandlers.executeItem).toHaveBeenCalledWith(1);
  });

  it('does nothing when the item is disabled', () => {
    const actionHandlers = renderItems(0);

    render(
      <SlashCommandContext.Provider
        value={
          {
            state: { isOpen: true, search: '', selectedIndex: 0, virtualElement: null, floatingContext: null },
            actionHandlers,
            items: ITEMS,
            filteredItems: ITEMS,
            groupedItems: new Map(),
            refs: {},
            floatingStyles: {},
          } as unknown as SlashCommandContextValue
        }>
        <SlashCommandItem value="Image" title="Disabled one" disabled />
      </SlashCommandContext.Provider>,
    );

    fireEvent.click(screen.getByText('Disabled one'));

    expect(actionHandlers.executeItem).not.toHaveBeenCalled();
  });
});
