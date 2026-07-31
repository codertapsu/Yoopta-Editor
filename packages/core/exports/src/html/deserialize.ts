import type { YooEditor, YooptaContentValue } from '@yoopta/editor';
import { deserializeHTML as parseHTML } from '@yoopta/editor';

export function deserializeHTML(editor: YooEditor, htmlString: string): YooptaContentValue {
  // DOMParser is a browser API. Fail with an actionable message instead of a
  // bare ReferenceError when this is called during SSR / in Node — callers
  // there should parse on the client or polyfill DOMParser (e.g. linkedom).
  if (typeof DOMParser === 'undefined') {
    throw new Error(
      '[Yoopta] deserializeHTML requires a DOM (DOMParser is undefined). ' +
        'Run it in the browser, or provide a DOMParser polyfill when calling it server-side.',
    );
  }

  const parsedHtml = new DOMParser().parseFromString(htmlString, 'text/html');
  const value: YooptaContentValue = {};

  const blocks = parseHTML(editor, parsedHtml.body);

  blocks.forEach((block, i) => {
    const blockData = block;
    blockData.meta.order = i;
    value[block.id] = blockData;
  });

  return value;
}
