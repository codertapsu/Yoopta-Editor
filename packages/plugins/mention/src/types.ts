import type { SlateElement, YooEditor } from '@yoopta/editor';

export type MentionType = 'user' | 'channel' | 'page' | 'custom' | string;

export type MentionItem<TMeta = Record<string, unknown>> = {
  id: string;
  type?: MentionType;
  name: string;
  avatar?: string;
  meta?: TMeta;
};

export type MentionElementProps<TMeta = Record<string, unknown>> = MentionItem<TMeta> & {
  nodeType: 'inlineVoid';
};

export type MentionPluginElementKeys = 'mention';
export type MentionElement<TMeta = Record<string, unknown>> = SlateElement<
  'mention',
  MentionElementProps<TMeta>
>;

export type MentionElementMap = {
  mention: MentionElement;
};

export type MentionTrigger = {
  /** Character(s) that trigger the mention dropdown (e.g., '@', '#', '[[') */
  char: string;
  /** Optional type to categorize this trigger */
  type?: MentionType;
  /** Allow spaces in search query (default: false) */
  allowSpaces?: boolean;
  /** Pattern that must precede the trigger (default: /\s|^/ - whitespace or start) */
  allowedAfter?: RegExp;
};

export type MentionTargetRect = {
  domRect: DOMRect;
  /**
   * Rects passed to floating-ui's `inline()` middleware. A real `DOMRectList`
   * when it comes straight from a DOM Range, a plain array when the rect had to
   * be synthesized (WebKit returns no rects for collapsed ranges).
   */
  clientRects: DOMRectList | DOMRect[];
};

export type MentionTriggerRange = {
  blockId: string;
  path: number[];
  startOffset: number;
};

export type MentionState = {
  /** Whether the dropdown is open */
  isOpen: boolean;
  /** Current search query (without trigger char) */
  query: string;
  /** The trigger that opened the dropdown */
  trigger: MentionTrigger | null;
  /** Position for the dropdown */
  targetRect: MentionTargetRect | null;
  /** The range where trigger was typed (for replacement) */
  triggerRange: MentionTriggerRange | null;
  /**
   * A trigger range the user explicitly dismissed (Escape / click outside).
   * The text sync will not re-open the dropdown for this exact range, otherwise
   * the still-matching `@query` text would immediately re-open it.
   */
  dismissedRange: MentionTriggerRange | null;
};

export const INITIAL_MENTION_STATE: MentionState = {
  isOpen: false,
  query: '',
  trigger: null,
  targetRect: null,
  triggerRange: null,
  dismissedRange: null,
};

export type MentionPluginOptions<TMeta = Record<string, unknown>> = {
  /**
   * Multiple triggers configuration
   * Example: [{ char: '@', type: 'user' }, { char: '#', type: 'channel' }]
   */
  triggers?: MentionTrigger[];

  /**
   * Simple single trigger (shorthand for triggers: [{ char }])
   * @default '@'
   */
  char?: string;

  /**
   * Search function called when user types after trigger
   * Receives query (without trigger char) and the active trigger
   */
  onSearch: (query: string, trigger: MentionTrigger) => Promise<MentionItem<TMeta>[]>;

  /**
   * Debounce delay for search in milliseconds
   * @default 300
   */
  debounceMs?: number;

  /**
   * Minimum query length before triggering search
   * @default 0
   */
  minQueryLength?: number;

  /**
   * Called when a mention is selected
   */
  onSelect?: (item: MentionItem<TMeta>, trigger: MentionTrigger) => void;

  /**
   * Called when dropdown opens
   */
  onOpen?: (trigger: MentionTrigger) => void;

  /**
   * Called when dropdown closes
   */
  onClose?: () => void;

  /**
   * Close dropdown when item is selected
   * @default true
   */
  closeOnSelect?: boolean;

  /**
   * Close dropdown on click outside
   * @default true
   */
  closeOnClickOutside?: boolean;

  /**
   * Close dropdown on Escape key
   * @default true
   */
  closeOnEscape?: boolean;
};

export type MentionOpenEvent = {
  trigger: MentionTrigger;
  query: string;
  targetRect: MentionTargetRect;
};

export type MentionCloseEvent = {
  reason:
    | 'escape'
    | 'click-outside'
    | 'select'
    | 'manual'
    | 'backspace'
    /** The text under the caret no longer matches a trigger (caret moved, trigger deleted, …) */
    | 'no-match';
};

export type MentionQueryChangeEvent = {
  query: string;
  trigger: MentionTrigger;
};

export type MentionSelectEvent<TMeta = Record<string, unknown>> = {
  item: MentionItem<TMeta>;
  trigger: MentionTrigger;
};

export type UseMentionDropdownOptions = {
  /** Custom debounce override */
  debounceMs?: number;
};

export type UseMentionDropdownReturn<TMeta = Record<string, unknown>> = {
  // State
  isOpen: boolean;
  query: string;
  trigger: MentionTrigger | null;

  // Results
  items: MentionItem<TMeta>[];
  loading: boolean;
  error: Error | null;

  // Navigation
  selectedIndex: number;
  setSelectedIndex: (index: number) => void;

  // Actions
  selectItem: (item: MentionItem<TMeta>) => void;
  close: (reason?: MentionCloseEvent['reason']) => void;

  // Refs for floating-ui
  refs: {
    setFloating: (el: HTMLElement | null) => void;
    setReference: (virtualEl: {
      getBoundingClientRect: () => DOMRect;
      getClientRects?: () => DOMRectList | DOMRect[];
    }) => void;
  };
  floatingStyles: React.CSSProperties;
  /**
   * Element the dropdown should be portaled into. Rendering the dropdown inline
   * lets any ancestor with `overflow`/`transform` clip it — which is what hides
   * it inside scrollable chat composers on mobile. `null` during SSR.
   */
  portalRoot: HTMLElement | null;
};

export type MentionRenderProps<TMeta = Record<string, unknown>> = {
  element: MentionElement<TMeta>;
  attributes: Record<string, unknown>;
  children: React.ReactNode;
  selected: boolean;
  focused: boolean;
};

export type MentionDropdownRenderProps<TMeta = Record<string, unknown>> =
  UseMentionDropdownReturn<TMeta>;

export type MentionItemRenderProps<TMeta = Record<string, unknown>> = {
  item: MentionItem<TMeta>;
  index: number;
  selected: boolean;
  onSelect: () => void;
};

export type MentionOpenParams = {
  trigger: MentionTrigger;
  targetRect: MentionTargetRect;
  triggerRange: MentionState['triggerRange'];
  /** Initial query, when the trigger is opened from already-typed text */
  query?: string;
};

export type MentionEditor = {
  mentions: {
    state: MentionState;
    setState: (state: Partial<MentionState>) => void;
    open: (params: MentionOpenParams) => void;
    close: (reason?: MentionCloseEvent['reason']) => void;
    setQuery: (query: string) => void;
    /** Set by useMentionDropdown hook — inserts the currently selected mention */
    selectCurrentItem: (() => void) | null;
    /**
     * Set while a mention is being inserted programmatically so the text sync
     * ignores the intermediate Slate states it produces.
     */
    isApplying: boolean;
  };
}

// Extended editor type with mentions support
export type MentionYooEditor = YooEditor & MentionEditor;
