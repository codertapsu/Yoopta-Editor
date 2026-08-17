import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type { VirtualElement } from '@floating-ui/dom';
import type { FloatingContext } from '@floating-ui/react';
import { useTransitionStyles } from '@floating-ui/react';
import { Blocks, getAllowedPluginsFromElement, useYooptaEditor } from '@yoopta/editor';
import { Editor, Path, Range } from 'slate';

import { KEYS, SLASH_TRIGGER } from '../constants';
import type { SlashCommandItem, SlashCommandState } from '../types';
import { useFilter } from './useFilter';
import { getVirtualElementRects, usePositioning } from './usePositioning';

type Action =
  | {
    type: 'OPEN';
    virtualElement: VirtualElement;
    floatingContext: FloatingContext<VirtualElement> | null;
  }
  | { type: 'CLOSE' }
  | { type: 'SET_SEARCH'; search: string }
  | { type: 'SET_SELECTED_INDEX'; index: number }
  | { type: 'RESET_SELECTION' };

const initialState: SlashCommandState = {
  isOpen: false,
  search: '',
  selectedIndex: 0,
  virtualElement: null,
  floatingContext: null,
};

function reducer(state: SlashCommandState, action: Action): SlashCommandState {
  switch (action.type) {
    case 'OPEN':
      return {
        ...state,
        isOpen: true,
        search: '',
        selectedIndex: 0,
        virtualElement: action.virtualElement,
        floatingContext: action.floatingContext,
      };

    case 'CLOSE':
      return {
        ...state,
        isOpen: false,
        search: '',
        selectedIndex: 0,
        virtualElement: null,
        floatingContext: null,
      };

    case 'SET_SEARCH':
      return {
        ...state,
        search: action.search,
        selectedIndex: 0,
      };

    case 'SET_SELECTED_INDEX': {
      return {
        ...state,
        selectedIndex: action.index,
      };
    }

    case 'RESET_SELECTION':
      return {
        ...state,
        selectedIndex: 0,
      };

    default:
      return state;
  }
}

type UseSlashCommandOptions = {
  items: SlashCommandItem[];
  trigger?: string;
  onSelect?: (item: SlashCommandItem) => void;
};

export function useSlashCommand({
  items,
  trigger = SLASH_TRIGGER,
  onSelect,
}: UseSlashCommandOptions) {
  const editor = useYooptaEditor();
  const [state, dispatch] = useReducer(reducer, initialState);

  // Filter items based on injectElementsFromPlugins when menu is open
  const filteredItemsByContext = useMemo(() => {
    // Only filter when menu is open to get current context
    if (!state.isOpen) {
      return items;
    }

    // Check if we're inside an element with injectElementsFromPlugins
    let injectElementsFromPlugins: string[] | null = null;

    if (typeof editor.path.current === 'number') {
      const slate = Blocks.getBlockSlate(editor, { at: editor.path.current });
      if (slate) {
        injectElementsFromPlugins = getAllowedPluginsFromElement(editor, slate);
      }
    }

    // Filter items based on injectElementsFromPlugins
    if (injectElementsFromPlugins && injectElementsFromPlugins.length > 0) {
      return injectElementsFromPlugins.map((pluginType) => {
        const plugin = editor.plugins[pluginType];
        const display = plugin.options?.display;

        return {
          id: pluginType,
          title: display?.title ?? pluginType,
          description: display?.description,
          icon: display?.icon,
        };
      });
    }

    return items;
  }, [items, state.isOpen, editor]);

  const { filteredItems, groupedItems, isEmpty } = useFilter({
    items: filteredItemsByContext,
    search: state.search,
  });

  const { refs, floatingStyles, floatingContext } = usePositioning({
    isOpen: state.isOpen,
    virtualElement: state.virtualElement,
  });

  const { isMounted, styles: transitionStyles } = useTransitionStyles(floatingContext, {
    duration: 100,
  });

  // Set when the keydown fast path has already scheduled an open, so the
  // `input` that follows the same keystroke does not open a second time.
  const openedByKeyRef = useRef(false);

  const open = useCallback((el: VirtualElement, ctx: FloatingContext<VirtualElement>) => {
    dispatch({ type: 'OPEN', virtualElement: el, floatingContext: ctx });
  }, []);

  const close = useCallback(() => {
    // Clear the keydown hand-off too: if the scheduled open never landed (no
    // caret rect, block swapped underneath), a stale flag would swallow the
    // NEXT text-derived open and the trigger would appear to work only every
    // other time.
    openedByKeyRef.current = false;
    dispatch({ type: 'CLOSE' });
  }, []);

  const setSearch = useCallback((search: string) => {
    dispatch({ type: 'SET_SEARCH', search });
  }, []);

  const setSelectedIndex = (index: number) => {
    dispatch({ type: 'SET_SELECTED_INDEX', index });
  };

  const executeSelected = () => {
    const selectedItem = filteredItems[state.selectedIndex];
    if (!selectedItem) return;

    // Execute custom onSelect if provided on item
    if (selectedItem.onSelect) {
      selectedItem.onSelect();
    }

    // Execute global onSelect callback
    if (onSelect) {
      onSelect(selectedItem);
    } else {
      editor.toggleBlock(selectedItem.id, {
        scope: 'auto',
        focus: true,
        preserveContent: false,
      });
    }

    close();
  };

  // Guards the text-sync against re-opening a menu the user dismissed while
  // the bare trigger text is still in the document (Escape leaves the '/').
  const dismissedRef = useRef(false);

  /**
   * Derives the menu state from the text around the caret.
   *
   * This — not keydown — is the authoritative trigger path. Android IMEs report
   * every printable character as key:'Unidentified'/keyCode:229, and iOS
   * autocorrect and dictation replace text through composition events, so the
   * only input-method-agnostic signal is the document itself. The `input` event
   * fires for all of them (including backspace deletions).
   */
  const syncFromText = useCallback(() => {
    const slate = Blocks.getBlockSlate(editor, { at: editor.path.current });
    if (!slate?.selection || !Range.isCollapsed(slate.selection)) {
      if (state.isOpen) close();
      return;
    }

    let text: string;
    let atTriggerStart: boolean;
    try {
      const parentPath = Path.parent(slate.selection.anchor.path);
      text = Editor.string(slate, parentPath);
      atTriggerStart = slate.selection.anchor.offset >= trigger.length;
    } catch {
      return;
    }

    if (!state.isOpen) {
      if (dismissedRef.current) {
        // Re-arm once the bare trigger is gone
        if (!text.startsWith(trigger)) dismissedRef.current = false;
        return;
      }

      // Open only for a trigger just typed on an otherwise empty line
      if (text === trigger && atTriggerStart) {
        if (openedByKeyRef.current) {
          // The hardware-keyboard path already scheduled this open.
          openedByKeyRef.current = false;

          return;
        }
        const virtualElement = getVirtualElementRects();
        if (virtualElement) open(virtualElement, floatingContext);
      }
      return;
    }

    // Menu is open — keep search in sync with the document
    if (text.length === 0 || !text.startsWith(trigger)) {
      close();
      return;
    }

    const searchText = text.slice(trigger.length).trim();
    if (searchText !== state.search) setSearch(searchText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, editor.path.current, state.isOpen, state.search, trigger, open, close, setSearch, floatingContext]);

  useEffect(() => {
    const editorRef = editor.refElement;
    if (!editorRef) return;

    // Runs after every text change from ANY input method. Deferred a tick so
    // Slate has flushed the change (Android's input manager can apply after
    // the native input event).
    const handleInput = () => {
      setTimeout(syncFromText, 0);
    };

    // Physical-keyboard handling: the trigger fast path, plus navigation.
    //
    // The text-sync above cannot carry the trigger on its own, and this is not
    // belt-and-braces — it is the ONLY path that works with a hardware
    // keyboard. slate-react hands insertion to the browser only for
    // `/[a-z ]/i` single characters at a non-zero offset; everything else is
    // applied through Slate after `event.preventDefault()` on `beforeinput`.
    // A cancelled `beforeinput` fires no `input` event, and '/' on an empty
    // line fails BOTH halves of that test — wrong character class, offset 0.
    // Android escapes this because slate-react routes it through
    // `androidInputManagerRef` before reaching that branch, which is exactly
    // why the trigger kept working on phones while dying on desktop.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;

      const slate = Blocks.getBlockSlate(editor, { at: editor.path.current });
      if (!slate?.selection) return;

      const isInsideEditor = editorRef.contains(event.target as Node);
      if (!isInsideEditor) return;

      if (!state.isOpen) {
        // `event.key` is the layout-resolved character, so it is correct across
        // keyboard layouts. It is NEVER produced by an Android IME (key:
        // 'Unidentified'), which is what `syncFromText` covers.
        if (event.key !== trigger || !Range.isCollapsed(slate.selection)) return;
        if (dismissedRef.current) return;

        // keydown runs BEFORE insertion, so the line must be empty right now.
        try {
          const parentPath = Path.parent(slate.selection.anchor.path);
          if (Editor.string(slate, parentPath).length !== 0) return;
        } catch {
          return;
        }

        // Defer so the character is in the document before the menu measures
        // the caret, and so `syncFromText` sees an open menu rather than
        // racing this one to open it a second time.
        openedByKeyRef.current = true;
        setTimeout(() => {
          const virtualElement = getVirtualElementRects();
          if (virtualElement) {
            open(virtualElement, floatingContext);
            return;
          }

          // No caret rect, so nothing opened and `close()` will never run to
          // clear the hand-off. Release it here or the flag outlives this
          // keystroke and silently cancels the NEXT open, making the trigger
          // look like it works every other time.
          openedByKeyRef.current = false;
        }, 0);

        return;
      }

      if (event.key === KEYS.ARROW_DOWN) {
        event.preventDefault();
        event.stopPropagation();
        setSelectedIndex(
          state.selectedIndex === filteredItems.length - 1 ? 0 : state.selectedIndex + 1,
        );
      } else if (event.key === KEYS.ARROW_UP) {
        event.preventDefault();
        event.stopPropagation();
        setSelectedIndex(
          state.selectedIndex === 0 ? filteredItems.length - 1 : state.selectedIndex - 1,
        );
      } else if (event.key === KEYS.ENTER) {
        event.preventDefault();
        event.stopPropagation();
        executeSelected();
      } else if (event.key === KEYS.ESCAPE) {
        event.preventDefault();
        event.stopPropagation();
        dismissedRef.current = true;
        close();
      }
    };

    editorRef.addEventListener('input', handleInput);
    editorRef.addEventListener('keydown', handleKeyDown);

    return () => {
      editorRef.removeEventListener('input', handleInput);
      editorRef.removeEventListener('keydown', handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    editor.path.current,
    editor.refElement,
    state.isOpen,
    state.selectedIndex,
    trigger,
    syncFromText,
    open,
    close,
    setSearch,
    filteredItems.length,
  ]);

  useEffect(() => {
    if (!state.isOpen) return;

    // pointerdown covers mouse, touch and pen — some mobile tap sequences
    // never dispatch mousedown, which would leave the menu stuck open with no
    // Escape key available on a soft keyboard.
    const handlePointerOutside = (event: Event) => {
      const target = event.target as Node;

      if (!refs.floating?.current?.contains(target)) {
        dismissedRef.current = true;
        close();
      }
    };

    const timeoutId = setTimeout(() => {
      document.addEventListener('pointerdown', handlePointerOutside);
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('pointerdown', handlePointerOutside);
    };
  }, [state.isOpen, close, refs.floating]);

  useEffect(() => {
    if (!state.isOpen || !isEmpty || state.search.length === 0) return;

    const timeoutId = setTimeout(() => {
      if (isEmpty) {
        close();
      }
    }, 2000);

    return () => clearTimeout(timeoutId);
  }, [state.isOpen, isEmpty, state.search, close]);

  useEffect(() => {
    if (!state.isOpen) return;

    const originalOverflow = document.body.style.overflow;
    const originalPaddingRight = document.body.style.paddingRight;

    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.paddingRight = originalPaddingRight;
    };
  }, [state.isOpen]);

  const actionHandlers = {
    open,
    close,
    setSearch,
    selectItem: setSelectedIndex,
    executeSelected,
  };

  return {
    refs,
    state,
    items,
    isEmpty,
    actionHandlers,
    groupedItems,
    filteredItems,
    floatingStyles,
    transitionStyles,
    isMounted,
  };
}
