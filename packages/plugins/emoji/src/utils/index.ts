import type { SlateEditor, YooEditor } from '@yoopta/editor';
import { Blocks } from '@yoopta/editor';
import type { Path } from 'slate';
import { Node, Range, Text } from 'slate';
import { ReactEditor } from 'slate-react';

import type {
  EmojiPluginOptions,
  EmojiTargetRect,
  EmojiTrigger,
  EmojiTriggerRange,
} from '../types';

/** Emoji shortcodes are short — anything longer is not a shortcode being typed. */
const MAX_QUERY_LENGTH = 32;

export function getTriggers(options: EmojiPluginOptions | undefined): EmojiTrigger[] {
  if (!options) return [{ char: ':' }];

  if (options.triggers && options.triggers.length > 0) {
    return options.triggers;
  }

  return [{ char: options.char ?? ':' }];
}

export function shouldTriggerActivate(
  trigger: EmojiTrigger,
  charBefore: string,
  charAfter: string,
): boolean {
  const allowedAfter = trigger.allowedAfter ?? /^$|\s/;

  // Check if character before trigger matches pattern (whitespace or start)
  const isLeftClear = allowedAfter.test(charBefore);
  // Check if character after is whitespace or end
  const isRightClear = charAfter === '' || /\s/.test(charAfter);

  return isLeftClear && isRightClear;
}

export type EmojiTriggerMatch = {
  trigger: EmojiTrigger;
  /** Text typed after the trigger char, up to the caret */
  query: string;
  /** Path of the text node holding the trigger */
  path: Path;
  /** Offset of the trigger char inside that text node */
  startOffset: number;
};

/**
 * Finds an active emoji trigger by reading the text to the left of the caret.
 *
 * Derived from document state rather than keystrokes: virtual keyboards
 * (Android IME, iOS autocorrect) and dictation never produce a reliable
 * `keydown.key`, but they always end up as text in the document.
 */
export function findTriggerMatch(
  slate: SlateEditor,
  triggers: EmojiTrigger[],
): EmojiTriggerMatch | null {
  const { selection } = slate;
  if (!selection || !Range.isCollapsed(selection)) return null;

  const { path, offset } = selection.anchor;

  let node: Node;
  try {
    node = Node.get(slate, path);
  } catch {
    return null;
  }
  if (!Text.isText(node)) return null;

  const textBefore = node.text.slice(0, offset);
  const charAfter = node.text[offset] ?? '';

  let match: EmojiTriggerMatch | null = null;

  for (const trigger of triggers) {
    const { char } = trigger;
    if (!char) continue;

    const startOffset = textBefore.lastIndexOf(char);
    if (startOffset === -1) continue;

    const query = textBefore.slice(startOffset + char.length);
    if (query.length > MAX_QUERY_LENGTH) continue;
    if (/[\n\r]/.test(query)) continue;
    if (!trigger.allowSpaces && /\s/.test(query)) continue;

    const charBefore = textBefore[startOffset - 1] ?? '';
    if (!shouldTriggerActivate(trigger, charBefore, charAfter)) continue;

    if (!match || startOffset > match.startOffset) {
      match = { trigger, query, path, startOffset };
    }
  }

  return match;
}

function isDegenerateRect(rect: DOMRect | undefined | null): boolean {
  if (!rect) return true;
  // WebKit returns an all-zero rect (and an empty DOMRectList) for collapsed ranges
  return rect.width === 0 && rect.height === 0 && rect.top === 0 && rect.left === 0;
}

function toTargetRect(range: globalThis.Range): EmojiTargetRect | null {
  const domRect = range.getBoundingClientRect();
  if (isDegenerateRect(domRect)) return null;

  const clientRects = range.getClientRects();
  return {
    domRect,
    clientRects: clientRects.length > 0 ? clientRects : [domRect],
  };
}

function collapseRectToEnd(rect: DOMRect): DOMRect {
  return new DOMRect(rect.right, rect.top, 0, rect.height);
}

function getDOMRangeFromSlate(slate: SlateEditor, range: Range): globalThis.Range | null {
  try {
    return ReactEditor.toDOMRange(slate, range);
  } catch {
    return null;
  }
}

/**
 * Measures the on-screen rect the dropdown should be anchored to.
 *
 * Collapsed ranges report empty client rects and a zeroed bounding rect on
 * WebKit (every browser on iOS), so the trigger character itself is measured
 * where possible, with progressively looser fallbacks.
 */
export function getEmojiTargetRect(
  slate: SlateEditor,
  triggerRange?: Pick<EmojiTriggerRange, 'path' | 'startOffset'> | null,
): EmojiTargetRect | null {
  // 1. The trigger character
  if (triggerRange) {
    const { path, startOffset } = triggerRange;
    const anchorRange = {
      anchor: { path, offset: startOffset },
      focus: { path, offset: startOffset + 1 },
    } as Range;

    const domRange = getDOMRangeFromSlate(slate, anchorRange);
    const rect = domRange ? toTargetRect(domRange) : null;
    if (rect) return rect;
  }

  const { selection } = slate;

  if (selection && Range.isCollapsed(selection)) {
    const { path, offset } = selection.anchor;

    // 2. Caret expanded one character to the left
    if (offset > 0) {
      const expanded = {
        anchor: { path, offset: offset - 1 },
        focus: { path, offset },
      } as Range;

      const domRange = getDOMRangeFromSlate(slate, expanded);
      if (domRange) {
        const rect = toTargetRect(domRange);
        if (rect) {
          const collapsed = collapseRectToEnd(rect.domRect);
          return { domRect: collapsed, clientRects: [collapsed] };
        }
      }
    }

    // 3. The raw collapsed caret
    const caretRange = getDOMRangeFromSlate(slate, selection);
    if (caretRange) {
      const rect = toTargetRect(caretRange);
      if (rect) return rect;
    }

    // 4. The DOM node of the caret's leaf
    try {
      const domNode = ReactEditor.toDOMNode(slate, Node.get(slate, path.slice(0, -1)));
      const nodeRect = domNode.getBoundingClientRect();
      if (!isDegenerateRect(nodeRect)) {
        return { domRect: nodeRect, clientRects: [nodeRect] };
      }
    } catch {
      // fall through to the native selection fallback below
    }
  }

  // 5. Native selection — used when Slate's DOM maps are unavailable
  if (typeof window !== 'undefined') {
    const domSelection = window.getSelection();
    if (domSelection && domSelection.rangeCount > 0) {
      const nativeRange = domSelection.getRangeAt(0);
      const rect = toTargetRect(nativeRange);
      if (rect) return rect;

      try {
        const expanded = nativeRange.cloneRange();
        if (expanded.collapsed && expanded.startOffset > 0) {
          expanded.setStart(expanded.startContainer, expanded.startOffset - 1);
          const expandedRect = toTargetRect(expanded);
          if (expandedRect) {
            const collapsed = collapseRectToEnd(expandedRect.domRect);
            return { domRect: collapsed, clientRects: [collapsed] };
          }
        }
      } catch {
        // ignore — nothing measurable
      }
    }
  }

  return null;
}

/**
 * Re-measures the anchor rect from the editor for a stored trigger range, so
 * the dropdown tracks the caret while the page scrolls or the mobile keyboard
 * resizes the viewport.
 */
export function measureTriggerRect(
  editor: YooEditor,
  triggerRange: EmojiTriggerRange | null,
): EmojiTargetRect | null {
  if (!triggerRange) return null;

  try {
    const slate = Blocks.getBlockSlate(editor, { id: triggerRange.blockId });
    if (!slate) return null;

    return getEmojiTargetRect(slate, triggerRange);
  } catch {
    return null;
  }
}

/** @deprecated Use {@link getEmojiTargetRect} — it survives collapsed-range quirks. */
export function getCaretRectFromSlate(slate: SlateEditor): EmojiTargetRect | null {
  return getEmojiTargetRect(slate);
}

export function isSameTriggerRange(
  a: EmojiTriggerRange | null,
  b: EmojiTriggerRange | null,
): boolean {
  if (!a || !b) return false;
  if (a.blockId !== b.blockId) return false;
  if (a.startOffset !== b.startOffset) return false;
  if (a.path.length !== b.path.length) return false;

  return a.path.every((segment, index) => segment === b.path[index]);
}
