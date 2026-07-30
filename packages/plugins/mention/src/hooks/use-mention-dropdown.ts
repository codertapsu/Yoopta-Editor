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

import { MentionCommands } from '../commands/mention-commands';
import type {
  MentionCloseEvent,
  MentionItem,
  MentionPluginOptions,
  MentionState,
  MentionTargetRect,
  UseMentionDropdownOptions,
  UseMentionDropdownReturn,
} from '../types';
import { INITIAL_MENTION_STATE } from '../types';
import { measureTriggerRect } from '../utils';

const EMPTY_RECT = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 } as DOMRect;

/** Minimum height worth showing before flipping to the other side of the caret */
const MIN_DROPDOWN_HEIGHT = 120;

/**
 * Hook for building mention dropdown UI
 * Provides state, actions, and floating-ui refs
 */
export function useMentionDropdown<TMeta = Record<string, unknown>>(
  options: UseMentionDropdownOptions = {},
): UseMentionDropdownReturn<TMeta> {
  const editor = useYooptaEditor();
  const pluginOptions = useYooptaPluginOptions<MentionPluginOptions<TMeta>>('Mention');

  // Local state for items/loading
  const [items, setItems] = useState<MentionItem<TMeta>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Track mention state from editor
  const [mentionState, setMentionState] = useState<MentionState>(INITIAL_MENTION_STATE);

  // Portal target — resolved on the client only, so SSR output stays stable
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);

  // Debounce timer ref
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQueryRef = useRef<string>('');

  // Last successfully measured anchor rect, reused when the caret is momentarily
  // unmeasurable (mid-composition, block re-render, …)
  const lastRectRef = useRef<MentionTargetRect | null>(null);

  // Debounce settings
  const debounceMs = options.debounceMs ?? pluginOptions?.debounceMs ?? 300;
  const minQueryLength = pluginOptions?.minQueryLength ?? 0;

  // Floating UI setup.
  // `fixed` strategy keeps the dropdown positioned against the viewport instead
  // of an offset parent, so ancestors with `overflow`/`transform` (chat
  // composers, scroll containers) cannot displace it.
  const { refs, floatingStyles, update } = useFloating({
    placement: 'bottom-start',
    strategy: 'fixed',
    open: mentionState.isOpen,
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
    setPortalRoot(editor.refElement?.ownerDocument?.body ?? document.body);
  }, [editor.refElement]);

  // Sync editor mention state to local state
  useEffect(() => {
    const handleMentionOpen = () => {
      setMentionState({ ...editor.mentions.state });
      setSelectedIndex(0);
      setItems([]);
      setError(null);
      lastQueryRef.current = '';
    };

    const handleMentionClose = () => {
      setMentionState({ ...INITIAL_MENTION_STATE });
      setItems([]);
      setSelectedIndex(0);
      setError(null);
      lastRectRef.current = null;
    };

    const handleQueryChange = () => {
      setMentionState({ ...editor.mentions.state });
    };

    editor.on('mention:open', handleMentionOpen);
    editor.on('mention:close', handleMentionClose);
    editor.on('mention:query-change', handleQueryChange);

    return () => {
      editor.off('mention:open', handleMentionOpen);
      editor.off('mention:close', handleMentionClose);
      editor.off('mention:query-change', handleQueryChange);
    };
  }, [editor]);

  // Anchor the dropdown to a *live* virtual element.
  //
  // Re-measuring on every reposition (rather than caching the rect captured
  // when the trigger was typed) is what keeps the dropdown attached to the
  // caret while the mobile keyboard opens, the page scrolls, or the block
  // reflows — all of which happen right after typing `@` on a phone.
  const { triggerRange, targetRect } = mentionState;

  useEffect(() => {
    if (!triggerRange) return;

    lastRectRef.current = targetRect ?? lastRectRef.current;

    const measure = (): MentionTargetRect | null => {
      const live = measureTriggerRect(editor, triggerRange);
      if (live) lastRectRef.current = live;
      return lastRectRef.current;
    };

    refs.setReference({
      getBoundingClientRect: () => measure()?.domRect ?? EMPTY_RECT,
      getClientRects: () => measure()?.clientRects ?? [],
    });
  }, [triggerRange, targetRect, editor, refs]);

  // The visual viewport changes when the on-screen keyboard opens or the user
  // pinch-zooms. `autoUpdate` does not observe it, so the dropdown would stay
  // where the caret used to be.
  useEffect(() => {
    if (!mentionState.isOpen) return;
    if (typeof window === 'undefined' || !window.visualViewport) return;

    const viewport = window.visualViewport;
    const handleViewportChange = () => update();

    viewport.addEventListener('resize', handleViewportChange);
    viewport.addEventListener('scroll', handleViewportChange);

    return () => {
      viewport.removeEventListener('resize', handleViewportChange);
      viewport.removeEventListener('scroll', handleViewportChange);
    };
  }, [mentionState.isOpen, update]);

  // Fetch items when query changes
  useEffect(() => {
    if (!mentionState.isOpen || !pluginOptions?.onSearch) return;

    const query = mentionState.query;
    const trigger = mentionState.trigger;

    // Skip if query is same as last
    if (query === lastQueryRef.current && items.length > 0) return;
    lastQueryRef.current = query;

    // Check min query length
    if (query.length < minQueryLength) {
      setItems([]);
      return;
    }

    // Clear previous timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Debounce search
    debounceTimerRef.current = setTimeout(async () => {
      if (!trigger) return;

      setLoading(true);
      setError(null);

      try {
        const results = await pluginOptions?.onSearch?.(query, trigger);
        setItems(results as MentionItem<TMeta>[]);
        setSelectedIndex(0);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Search failed'));
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
  }, [mentionState.isOpen, mentionState.query, mentionState.trigger, pluginOptions, debounceMs, minQueryLength, items.length]);

  // Select item action
  const selectItem = useCallback(
    (item: MentionItem<TMeta>) => {
      MentionCommands.insertMention(editor, item, { focus: true });
    },
    [editor],
  );

  // Close action
  const close = useCallback(
    (reason: MentionCloseEvent['reason'] = 'manual') => {
      MentionCommands.closeDropdown(editor, reason);
    },
    [editor],
  );

  // Expose selectCurrentItem on editor.mentions so the plugin's onKeyDown can
  // call it directly on Enter (avoiding event propagation issues with block handlers).
  useEffect(() => {
    if (mentionState.isOpen && items.length > 0) {
      editor.mentions.selectCurrentItem = () => {
        if (items[selectedIndex]) {
          selectItem(items[selectedIndex]);
        }
      };
    } else {
      editor.mentions.selectCurrentItem = null;
    }

    return () => {
      editor.mentions.selectCurrentItem = null;
    };
  }, [mentionState.isOpen, items, selectedIndex, selectItem, editor]);

  // Keyboard navigation (Arrow keys, Escape, Tab)
  // Enter is handled directly by the plugin's onKeyDown via editor.mentions.selectCurrentItem
  useEffect(() => {
    if (!mentionState.isOpen) return;

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
          // Close on tab
          close('escape');
          break;

        default:
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [mentionState.isOpen, items, selectedIndex, close]);

  // Click/tap outside to close.
  // `pointerdown` covers mouse, touch and pen — `mousedown` alone never fires
  // for the synthetic tap sequence on some mobile browsers.
  useEffect(() => {
    if (!mentionState.isOpen) return;
    if (pluginOptions?.closeOnClickOutside === false) return;

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
  }, [mentionState.isOpen, refs.floating, close, pluginOptions?.closeOnClickOutside]);

  return useMemo(
    () => ({
      // State
      isOpen: mentionState.isOpen,
      query: mentionState.query,
      trigger: mentionState.trigger,

      // Results
      items,
      loading,
      error,

      // Navigation
      selectedIndex,
      setSelectedIndex,

      // Actions
      selectItem,
      close,

      // Refs
      refs: {
        setFloating: refs.setFloating,
        setReference: refs.setReference,
      },
      floatingStyles,
      portalRoot,
    }),
    [
      mentionState.isOpen,
      mentionState.query,
      mentionState.trigger,
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
