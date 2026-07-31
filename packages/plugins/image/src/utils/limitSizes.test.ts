import { describe, expect, it } from 'vitest';

import { limitSizes } from './limitSizes';

describe('limitSizes', () => {
  it('returns sizes unchanged when no max is configured (the plugin default)', () => {
    // Regression: dividing by a 0 max produced an Infinity ratio and collapsed
    // every pasted image to 0x0, which was then persisted in the document.
    expect(limitSizes({ width: 650, height: 500 }, { width: 0, height: 0 })).toEqual({
      width: 650,
      height: 500,
    });
    expect(limitSizes({ width: 650, height: 500 }, undefined)).toEqual({
      width: 650,
      height: 500,
    });
  });

  it('clamps proportionally when both maxes are set', () => {
    expect(limitSizes({ width: 650, height: 500 }, { width: 300, height: 300 })).toEqual({
      width: 300,
      height: 231,
    });
  });

  it('leaves sizes within the max untouched', () => {
    expect(limitSizes({ width: 100, height: 80 }, { width: 300, height: 300 })).toEqual({
      width: 100,
      height: 80,
    });
  });

  it('treats a single configured max as the only constraint', () => {
    expect(limitSizes({ width: 650, height: 500 }, { width: 325, height: 0 })).toEqual({
      width: 325,
      height: 250,
    });
    expect(limitSizes({ width: 650, height: 500 }, { width: 0, height: 250 })).toEqual({
      width: 325,
      height: 250,
    });
  });

  it('parses px-suffixed string sizes', () => {
    expect(limitSizes({ width: '650px', height: '500px' }, { width: '325px', height: 0 })).toEqual({
      width: 325,
      height: 250,
    });
  });
});
