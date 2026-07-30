import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  autoUpdate,
  flip,
  inline,
  offset,
  shift,
  size,
  useFloating,
} from '@floating-ui/react';
import { useYooptaEditor, useYooptaPluginOptions } from '@yoopta/editor';

import { EmojiCommands } from '../commands/emoji-commands';
import { defaultEmojiSearch } from '../data/default-search';
import type {
  EmojiCloseEvent,
  EmojiItem,
  EmojiPluginOptions,
  EmojiState,
  EmojiTargetRect,
  EmojiYooEditor,
  UseEmojiDropdownOptions,
  UseEmojiDropdownReturn,
} from '../types';
import { INITIAL_EMOJI_STATE } from '../types';
import { measureTriggerRect } from '../utils';

const EMPTY_RECT = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 } as DOMRect;

/** Minimum height worth showing before flipping to the other side of the caret */
const MIN_DROPDOWN_HEIGHT = 120;

/**
 * Hook for building emoji dropdown UI.
 * Provides state, actions, and floating-ui refs.
 */
export function useEmojiDropdown(
  options: UseEmojiDropdownOptions = {},
): UseEmojiDropdownReturn {
  const baseEditor = useYooptaEditor();
  const editor = baseEditor as unknown as EmojiYooEditor;
  const pluginOptions = useYooptaPluginOptions<EmojiPluginOptions>('Emoji');

  const [items, setItems] = useState<EmojiItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const [emojiState, setEmojiState] = useState<EmojiState>(INITIAL_EMOJI_STATE);

  // Portal target — resolved on the client only, so SSR output stays stable
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);

  // Last successfully measured anchor rect, reused when the caret is momentarily
  // unmeasurable (mid-composition, block re-render, …)
  const lastRectRef = useRef<EmojiTargetRect | null>(null);

  // Debounce timer ref
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQueryRef = useRef<string>('');

  const debounceMs = options.debounceMs ?? pluginOptions?.debounceMs ?? 100;
  const minQueryLength = pluginOptions?.minQueryLength ?? 1;

  // `fixed` strategy keeps the dropdown positioned against the viewport instead
  // of an offset parent, so ancestors with `overflow`/`transform` (chat
  // composers, scroll containers) cannot displace it.
  const { refs, floatingStyles, update } = useFloating({
    placement: 'bottom-start',
    strategy: 'fixed',
    open: emojiState.isOpen,
    middleware: [
      inline(),
      offset(4),
      flip({ fallbackPlacements: ['top-start', 'bottom', 'top'], padding: 8 }),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableHeight, elements }) {
          // Clamp to the space actually left over — on mobile the on-screen
          // keyboard eats most of the viewport below the caret.
          Object.assign(elements.floating.style, {
            maxHeight: `${Math.max(MIN_DROPDOWN_HEIGHT, availableHeight)}px`,
          });
        },
      }),
    ],
    whileElementsMounted: autoUpdate,
  });

  useEffect(() => {
    setPortalRoot(baseEditor.refElement?.ownerDocument?.body ?? document.body);
  }, [baseEditor.refElement]);

  const on = editor.on as (event: string, fn: (...args: any[]) => void) => void;
  const off = editor.off as (event: string, fn: (...args: any[]) => void) => void;

  useEffect(() => {
    const handleOpen = () => {
      setEmojiState({ ...editor.emoji.state });
      setSelectedIndex(0);
      setItems([]);
      setError(null);
      lastQueryRef.current = '';
    };

    const handleClose = () => {
      setEmojiState({ ...INITIAL_EMOJI_STATE });
      setItems([]);
      setSelectedIndex(0);
      setError(null);
      lastRectRef.current = null;
    };

    const handleQueryChange = () => {
      setEmojiState({ ...editor.emoji.state });
    };

    on('emoji:open', handleOpen);
    on('emoji:close', handleClose);
    on('emoji:query-change', handleQueryChange);

    return () => {
      off('emoji:open', handleOpen);
      off('emoji:close', handleClose);
      off('emoji:query-change', handleQueryChange);
    };
  }, [editor]);

  // Anchor the dropdown to a *live* virtual element. Re-measuring on every
  // reposition (rather than caching the rect captured when the trigger was
  // typed) keeps the dropdown attached to the caret while the mobile keyboard
  // opens, the page scrolls, or the block reflows.
  const { triggerRange, targetRect } = emojiState;

  useEffect(() => {
    if (!triggerRange) return;

    lastRectRef.current = targetRect ?? lastRectRef.current;

    const measure = (): EmojiTargetRect | null => {
      const live = measureTriggerRect(baseEditor, triggerRange);
      if (live) lastRectRef.current = live;
      return lastRectRef.current;
    };

    refs.setReference({
      getBoundingClientRect: () => measure()?.domRect ?? EMPTY_RECT,
      getClientRects: () => measure()?.clientRects ?? [],
    });
  }, [triggerRange, targetRect, baseEditor, refs]);

  // The visual viewport changes when the on-screen keyboard opens or the user
  // pinch-zooms. `autoUpdate` does not observe it.
  useEffect(() => {
    if (!emojiState.isOpen) return;
    if (typeof window === 'undefined' || !window.visualViewport) return;

    const viewport = window.visualViewport;
    const handleViewportChange = () => update();

    viewport.addEventListener('resize', handleViewportChange);
    viewport.addEventListener('scroll', handleViewportChange);

    return () => {
      viewport.removeEventListener('resize', handleViewportChange);
      viewport.removeEventListener('scroll', handleViewportChange);
    };
  }, [emojiState.isOpen, update]);

  useEffect(() => {
    if (!emojiState.isOpen) return;

    const query = emojiState.query;
    const trigger = emojiState.trigger;
    const searchFn = pluginOptions?.onSearch ?? defaultEmojiSearch;

    if (query === lastQueryRef.current && items.length > 0) return;
    lastQueryRef.current = query;

    if (query.length < minQueryLength) {
      setItems([]);
      return;
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(async () => {
      if (!trigger) return;

      setLoading(true);
      setError(null);

      try {
        const results = await searchFn(query, trigger);
        setItems(results);
        setSelectedIndex(0);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Emoji search failed'));
        setItems([]);
      } finally {
        setLoading(false);
      }
    }, debounceMs);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [emojiState.isOpen, emojiState.query, emojiState.trigger, pluginOptions, debounceMs, minQueryLength, items.length]);

  const selectItem = useCallback(
    (item: EmojiItem) => {
      EmojiCommands.insertEmoji(editor, item);
    },
    [editor],
  );

  const close = useCallback(
    (reason: EmojiCloseEvent['reason'] = 'manual') => {
      EmojiCommands.closeDropdown(editor, reason);
    },
    [editor],
  );

  // Expose selectCurrentItem on editor.emoji so the plugin's onKeyDown can
  // call it directly on Enter (avoiding event propagation issues).
  useEffect(() => {
    if (emojiState.isOpen && items.length > 0) {
      editor.emoji.selectCurrentItem = () => {
        if (items[selectedIndex]) {
          selectItem(items[selectedIndex]);
        }
      };
    } else {
      editor.emoji.selectCurrentItem = null;
    }

    return () => {
      editor.emoji.selectCurrentItem = null;
    };
  }, [emojiState.isOpen, items, selectedIndex, selectItem, editor]);

  // Keyboard navigation (Arrow keys, Escape, Tab)
  // Enter is handled directly by the plugin's onKeyDown via editor.emoji.selectCurrentItem
  useEffect(() => {
    if (!emojiState.isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % Math.max(items.length, 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + Math.max(items.length, 1)) % Math.max(items.length, 1));
          break;
        case 'Escape':
          e.preventDefault();
          close('escape');
          break;
        case 'Tab':
          close('escape');
          break;
        default:
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [emojiState.isOpen, items, selectedIndex, close]);

  // Click outside to close
  useEffect(() => {
    if (!emojiState.isOpen) return;
    if (pluginOptions?.closeOnClickOutside === false) return;

    // `pointerdown` covers mouse, touch and pen — `mousedown` alone never fires
    // for the synthetic tap sequence on some mobile browsers.
    const handlePointerOutside = (e: Event) => {
      const floatingEl = refs.floating.current;
      if (floatingEl && !floatingEl.contains(e.target as Node)) {
        close('click-outside');
      }
    };

    // Delay to avoid immediate close
    const timer = setTimeout(() => {
      document.addEventListener('pointerdown', handlePointerOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', handlePointerOutside);
    };
  }, [emojiState.isOpen, refs.floating, close, pluginOptions?.closeOnClickOutside]);

  return useMemo(
    () => ({
      isOpen: emojiState.isOpen,
      query: emojiState.query,
      trigger: emojiState.trigger,

      items,
      loading,
      error,

      selectedIndex,
      setSelectedIndex,

      selectItem,
      close,

      refs: {
        setFloating: refs.setFloating,
        setReference: refs.setReference,
      },
      floatingStyles,
      portalRoot,
    }),
    [
      emojiState.isOpen,
      emojiState.query,
      emojiState.trigger,
      items,
      loading,
      error,
      selectedIndex,
      selectItem,
      close,
      refs.setFloating,
      refs.setReference,
      floatingStyles,
      portalRoot,
    ],
  );
}
