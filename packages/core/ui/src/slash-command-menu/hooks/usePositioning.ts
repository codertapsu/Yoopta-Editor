import { useEffect, useLayoutEffect } from 'react';
import type { VirtualElement } from '@floating-ui/react';
import { autoUpdate, flip, inline, offset, shift, size, useFloating } from '@floating-ui/react';

import { MENU_OFFSET } from '../constants';

type UsePositioningOptions = {
  isOpen: boolean;
  virtualElement: VirtualElement | null;
};

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export function usePositioning({ isOpen, virtualElement }: UsePositioningOptions) {
  const { refs, floatingStyles, context, update } = useFloating({
    open: isOpen,
    placement: 'bottom-start',
    whileElementsMounted: autoUpdate,
    middleware: [
      inline(),
      offset(MENU_OFFSET),
      flip({
        fallbackPlacements: ['top-start', 'top', 'bottom'],
        padding: 10,
        crossAxis: false,
        fallbackStrategy: 'bestFit',
      }),
      shift({ padding: 10 }),
      size({
        apply({ availableHeight, elements }) {
          Object.assign(elements.floating.style, {
            maxHeight: `${Math.max(200, availableHeight - 20)}px`,
          });
        },
        padding: 10,
      }),
    ],
    strategy: 'fixed',
  });

  useIsomorphicLayoutEffect(() => {
    if (virtualElement) {
      refs.setReference(virtualElement);
      update();
    }
  }, [refs, isOpen, virtualElement, update]);

  // The visual viewport changes when the on-screen keyboard opens or the user
  // pinch-zooms; autoUpdate does not observe it, so the menu would stay where
  // the caret used to be.
  useEffect(() => {
    if (!isOpen) return;
    if (typeof window === 'undefined' || !window.visualViewport) return;

    const viewport = window.visualViewport;
    const handleViewportChange = () => update();

    viewport.addEventListener('resize', handleViewportChange);
    viewport.addEventListener('scroll', handleViewportChange);

    return () => {
      viewport.removeEventListener('resize', handleViewportChange);
      viewport.removeEventListener('scroll', handleViewportChange);
    };
  }, [isOpen, update]);

  return {
    refs,
    floatingStyles,
    floatingContext: context,
  };
}

function isDegenerateRect(rect: DOMRect | undefined | null): boolean {
  if (!rect) return true;
  // WebKit (every iOS browser and desktop Safari) reports an empty client-rect
  // list and an all-zero bounding rect for collapsed ranges.
  return rect.width === 0 && rect.height === 0 && rect.top === 0 && rect.left === 0;
}

/** Collapses a rect onto its right edge, producing a caret-sized anchor. */
function collapseRectToEnd(rect: DOMRect): DOMRect {
  return new DOMRect(rect.right, rect.top, 0, rect.height);
}

/**
 * Measures the caret from the live DOM selection, working around WebKit's
 * zero rects for collapsed ranges by expanding one character to the left and,
 * failing that, using the caret's element rect.
 */
function measureCaretRect(): { domRect: DOMRect; clientRects: DOMRect[] } | null {
  const domSelection = window.getSelection();
  if (!domSelection || domSelection.rangeCount === 0) return null;

  const domRange = domSelection.getRangeAt(0);

  const rect = domRange.getBoundingClientRect();
  if (!isDegenerateRect(rect)) {
    const rects = Array.from(domRange.getClientRects());
    return { domRect: rect, clientRects: rects.length > 0 ? rects : [rect] };
  }

  // Collapsed range on WebKit — expand one character to the left
  try {
    if (domRange.collapsed && domRange.startOffset > 0) {
      const expanded = domRange.cloneRange();
      expanded.setStart(expanded.startContainer, expanded.startOffset - 1);
      const expandedRect = expanded.getBoundingClientRect();
      if (!isDegenerateRect(expandedRect)) {
        const caret = collapseRectToEnd(expandedRect);
        return { domRect: caret, clientRects: [caret] };
      }
    }
  } catch {
    // fall through to the element fallback
  }

  // Element containing the caret, collapsed to its left edge
  const container = domRange.startContainer;
  const element = container instanceof Element ? container : container.parentElement;
  if (element) {
    const elementRect = element.getBoundingClientRect();
    if (!isDegenerateRect(elementRect)) {
      const caret = new DOMRect(elementRect.left, elementRect.top, 0, elementRect.height);
      return { domRect: caret, clientRects: [caret] };
    }
  }

  return null;
}

/**
 * Returns a LIVE virtual element: every reposition re-measures the caret, so
 * the menu tracks it through scrolling, on-screen keyboard appearance, and
 * block reflow. The last good rect is kept for moments when the selection is
 * transiently unmeasurable (mid-composition, re-render).
 */
export function getVirtualElementRects(): VirtualElement | null {
  let lastGood = measureCaretRect();
  if (!lastGood) return null;

  const measure = () => {
    const live = measureCaretRect();
    if (live) lastGood = live;
    return lastGood!;
  };

  return {
    getBoundingClientRect: () => measure().domRect,
    getClientRects: () => measure().clientRects as unknown as DOMRectList,
  };
}
