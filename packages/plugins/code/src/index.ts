import { CodeGroup } from './plugin/code-group-plugin';
import { Code } from './plugin/code-plugin';
import {
  CodeElement,
  CodeElementProps,
  CodeGroupElementMap,
  CodeGroupPluginBlockOptions,
} from './types';
import { initHighlighter } from './utils/shiki';

// Warm the highlighter lazily in the browser only: eagerly creating a
// ~60-language shiki instance at import time blocks server renders and pages
// that never mount a code block. useHighlighter still awaits initHighlighter()
// itself, so first paint is unaffected — this just starts the work early
// without blocking module evaluation.
if (typeof window !== 'undefined') {
  const warm = () => {
    initHighlighter().catch(() => {
      // useHighlighter retries on demand
    });
  };

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(warm);
  } else {
    setTimeout(warm, 0);
  }
}

export { HighlightedCodeOverlay, useHighlighter } from './components/highlighted-code-overlay';
export { CodeCommands, type BeautifyCodeResult, type CodeCommandsType } from './commands/code-commands';
export { CodeGroupCommands, type BeautifyTabResult, type CodeGroupCommandsType } from './commands/code-group-commands';
export { SHIKI_CODE_LANGUAGES, SHIKI_CODE_THEMES } from './utils/shiki';
export { isLanguageSupported, type FormatCodeOptions } from './utils/prettier';

export { CodeElement, CodeElementProps };
export { CodeGroupElementMap, CodeGroupPluginBlockOptions };
export { CodeGroup, Code };

const CodePlugins = {
  Code,
  CodeGroup,
};

export default CodePlugins;
