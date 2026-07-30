import { describe, expect, it } from 'vitest';

import type { MentionTrigger } from '../types';

import { findTriggerMatch, isSameTriggerRange } from './index';

/**
 * Minimal Slate-shaped stub. `findTriggerMatch` only reads `selection` and
 * resolves the anchor text node, so a single-paragraph document is enough and
 * avoids pulling a full editor into a pure-function test.
 */
function slateWithText(text: string, caretOffset = text.length) {
  const path = [0, 0];

  return {
    children: [{ type: 'paragraph', children: [{ text }] }],
    selection: {
      anchor: { path, offset: caretOffset },
      focus: { path, offset: caretOffset },
    },
  } as never;
}

const AT: MentionTrigger = { char: '@' };
const HASH: MentionTrigger = { char: '#' };

describe('findTriggerMatch', () => {
  it('matches a bare trigger at the start of a block', () => {
    const match = findTriggerMatch(slateWithText('@'), [AT]);

    expect(match).toMatchObject({ query: '', startOffset: 0 });
    expect(match?.trigger.char).toBe('@');
  });

  it('collects the query typed after the trigger', () => {
    const match = findTriggerMatch(slateWithText('hey @joh'), [AT]);

    expect(match).toMatchObject({ query: 'joh', startOffset: 4 });
  });

  it('does not match a trigger glued to the end of a word', () => {
    expect(findTriggerMatch(slateWithText('mail@example'), [AT])).toBeNull();
  });

  it('stops matching once the query contains a space', () => {
    expect(findTriggerMatch(slateWithText('@john doe'), [AT])).toBeNull();
  });

  it('keeps matching across spaces when the trigger allows them', () => {
    const match = findTriggerMatch(slateWithText('@john doe'), [
      { char: '@', allowSpaces: true },
    ]);

    expect(match).toMatchObject({ query: 'john doe' });
  });

  it('picks the trigger closest to the caret', () => {
    const match = findTriggerMatch(slateWithText('@alice #gen'), [AT, HASH]);

    expect(match?.trigger.char).toBe('#');
    expect(match).toMatchObject({ query: 'gen', startOffset: 7 });
  });

  it('only considers text before the caret', () => {
    const match = findTriggerMatch(slateWithText('@jo world', 3), [AT]);

    expect(match).toMatchObject({ query: 'jo' });
  });

  it('does not match when the caret sits mid-word', () => {
    // `charAfter` must be whitespace or end-of-text — preserves the upstream
    // rule that a mention is only offered at the end of a token.
    expect(findTriggerMatch(slateWithText('@john', 3), [AT])).toBeNull();
  });

  it('bails out on an over-long query', () => {
    expect(findTriggerMatch(slateWithText(`@${'x'.repeat(65)}`), [AT])).toBeNull();
  });

  it('requires a collapsed selection', () => {
    const slate = slateWithText('@john');
    (slate as { selection: { focus: { offset: number } } }).selection.focus.offset = 2;

    expect(findTriggerMatch(slate, [AT])).toBeNull();
  });

  it('returns null when there is no selection', () => {
    expect(findTriggerMatch({ selection: null } as never, [AT])).toBeNull();
  });
});

describe('isSameTriggerRange', () => {
  const base = { blockId: 'a', path: [0, 0], startOffset: 4 };

  it('matches an identical range', () => {
    expect(isSameTriggerRange(base, { ...base, path: [0, 0] })).toBe(true);
  });

  it('distinguishes blocks, offsets and paths', () => {
    expect(isSameTriggerRange(base, { ...base, blockId: 'b' })).toBe(false);
    expect(isSameTriggerRange(base, { ...base, startOffset: 5 })).toBe(false);
    expect(isSameTriggerRange(base, { ...base, path: [0, 1] })).toBe(false);
    expect(isSameTriggerRange(base, { ...base, path: [0] })).toBe(false);
  });

  it('treats null as never matching', () => {
    expect(isSameTriggerRange(null, base)).toBe(false);
    expect(isSameTriggerRange(base, null)).toBe(false);
  });
});
