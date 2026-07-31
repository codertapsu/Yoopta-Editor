import type { VideoSizes } from '../types';

/**
 * Converts a size value (number or string) to a number
 * @param value Size value that can be number or string (e.g. '570px', '100%', 300)
 * @returns Number value without units
 */
const parseSize = (value: string | number): number => {
  if (typeof value === 'number') return value;
  return parseInt(value.replace(/[^\d]/g, ''), 10);
};

/**
 * Limits image sizes to not exceed maximum allowed dimensions
 * @param sizes Current image dimensions
 * @param maxSizes Maximum allowed dimensions
 * @returns New image dimensions that fit within maxSizes
 */
export const limitSizes = (sizes: VideoSizes, maxSizes: VideoSizes): VideoSizes => {
  const currentWidth = parseSize(sizes.width);
  const currentHeight = parseSize(sizes.height);
  const maxWidth = parseSize(maxSizes.width);
  const maxHeight = parseSize(maxSizes.height);

  // No positive max configured (the plugin default) means "do not clamp".
  // Dividing by a 0 max produced an Infinity ratio and collapsed every pasted
  // element to 0x0 — which was then persisted in the document.
  if (maxWidth <= 0 && maxHeight <= 0) {
    return { width: currentWidth, height: currentHeight };
  }

  const effectiveMaxWidth = maxWidth > 0 ? maxWidth : Infinity;
  const effectiveMaxHeight = maxHeight > 0 ? maxHeight : Infinity;

  if (currentWidth <= effectiveMaxWidth && currentHeight <= effectiveMaxHeight) {
    return { width: currentWidth, height: currentHeight };
  }

  const widthRatio = currentWidth / effectiveMaxWidth;
  const heightRatio = currentHeight / effectiveMaxHeight;
  const ratio = Math.max(widthRatio, heightRatio);

  const newWidth = Math.round(currentWidth / ratio);
  const newHeight = Math.round(currentHeight / ratio);

  return {
    width: Math.min(newWidth, effectiveMaxWidth),
    height: Math.min(newHeight, effectiveMaxHeight),
  };
};
