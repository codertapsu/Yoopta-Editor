import { getHTML } from './getHTML';
import type { YooEditor, YooptaContentValue } from '../editor/types';

export function getPlainText(editor: YooEditor, content: YooptaContentValue) {
  const htmlString = getHTML(editor, content);

  // Browser path: innerText gives layout-aware line breaks
  if (typeof document !== 'undefined') {
    const div = document.createElement('div');
    div.innerHTML = htmlString;
    return div.innerText;
  }

  // Server path (Next.js SSR, Node scripts): getPlainText is a public parser
  // API and must not crash without a DOM. Strip tags with block-level elements
  // mapped to line breaks — coarser than innerText, but faithful for text.
  return htmlString
    .replace(/<(?:br|\/p|\/div|\/h[1-6]|\/li|\/tr|\/blockquote|\/pre)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
