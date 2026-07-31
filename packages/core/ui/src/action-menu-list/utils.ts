import { Blocks, getAllowedPluginsFromElement, getRootBlockElement } from '@yoopta/editor';
import type { Plugin, SlateElement, YooEditor, YooptaBlock, YooptaBlockData } from '@yoopta/editor';

import type { ActionMenuItem } from './types';

const filterBy = (
  item: YooptaBlockData | YooptaBlock['options'],
  text: string,
  field: string,
): boolean => {
  if (!item || typeof item[field] === 'undefined') return false;

  const value = item[field];
  const searchText = text.toLowerCase().trim();

  if (Array.isArray(value)) {
    return value
      .filter(Boolean)
      .map((v) => String(v).toLowerCase())
      .some((v) => v.includes(searchText));
  }

  return String(value).toLowerCase().includes(searchText);
};

export const filterActionMenuItems = (
  blockPlugin: Plugin<Record<string, SlateElement>, unknown>,
  searchText: string,
): boolean => {
  if (!searchText.trim()) return true;
  if (!blockPlugin) return false;

  const searchTerms = searchText.toLowerCase().split(/\s+/);

  return searchTerms.every((term) => {
    const typeMatch = filterBy(blockPlugin, term, 'type');
    if (typeMatch) return true;

    const titleMatch =
      blockPlugin.options?.display && filterBy(blockPlugin.options.display, term, 'title');
    if (titleMatch) return true;

    const shortcutMatch = blockPlugin.options && filterBy(blockPlugin.options, term, 'shortcuts');
    if (shortcutMatch) return true;

    const descriptionMatch =
      blockPlugin.options?.display && filterBy(blockPlugin.options.display, term, 'description');
    if (descriptionMatch) return true;

    return false;
  });
};

export function mapActionMenuItems(editor: YooEditor): ActionMenuItem[] {
  const items: string[] | ActionMenuItem[] = Object.keys(editor.plugins);
  // Check if we're inside an element with injectElementsFromPlugins
  let injectElementsFromPlugins: string[] | null = null;

  if (typeof editor.path.current === 'number') {
    const slate = Blocks.getBlockSlate(editor, { at: editor.path.current });
    if (slate) {
      injectElementsFromPlugins = getAllowedPluginsFromElement(editor, slate);
    }
  }

  // Filter items based on injectElementsFromPlugins
  let filteredItems = items;

  if (injectElementsFromPlugins && injectElementsFromPlugins.length > 0) {
    if (typeof items[0] === 'string') {
      filteredItems = (items as string[]).filter((item) =>
        injectElementsFromPlugins!.includes(item),
      );
    } else {
      filteredItems = items.filter((item) => injectElementsFromPlugins!.includes(item.type));
    }
  }

  return filteredItems.map((item: string | ActionMenuItem) => {
    if (typeof item === 'string') {
      const title = editor.plugins[item].options?.display?.title || item;
      const description = editor.plugins[item].options?.display?.description;
      const icon = editor.plugins[item].options?.display?.icon;
      return { type: item, title, description, icon };
    }
    return item;
  });
}

export function filterToggleActions(editor: YooEditor, type: string) {
  const block = editor.plugins[type];
  if (!block) return false;

  const rootBlock = getRootBlockElement(block.elements);
  if (rootBlock?.props?.nodeType === 'void') return false;
  return true;
}

/**
 * True when a physical keyboard produced a '/' keystroke.
 *
 * `event.key` is the layout-resolved character, so it alone is correct across
 * keyboard layouts; the old keyCode-191/code-'Slash' variants matched '?' and
 * other layout-dependent characters. Note this can NEVER fire on Android IME
 * keyboards (they report key:'Unidentified'/keyCode:229 for printable chars) —
 * mobile triggers must be derived from the inserted text instead, as
 * useSlashCommand does via the `input` event.
 */
export function isSlashPressed(event: KeyboardEvent): boolean {
  return event.key === '/' && !event.isComposing;
}
