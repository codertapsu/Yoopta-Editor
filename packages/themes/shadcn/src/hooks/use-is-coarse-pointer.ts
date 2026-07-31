import { useEffect, useState } from 'react';

/**
 * True on devices whose primary pointer cannot hover (phones, tablets).
 *
 * Hover-card and hover-reveal affordances never trigger there, so components
 * use this to swap them for tap-driven equivalents. Initial state is false on
 * purpose — it keeps server and first client render identical, and flips in an
 * effect before the user can interact.
 */
export const useIsCoarsePointer = (): boolean => {
  const [coarse, setCoarse] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(pointer: coarse)');
    setCoarse(query.matches);

    const onChange = (e: MediaQueryListEvent) => setCoarse(e.matches);
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);

  return coarse;
};
