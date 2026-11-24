export interface ScrollbarMetricsInput {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  trackHeight: number;
  minThumbHeight?: number;
}

export interface ScrollbarMetrics {
  scrollable: boolean;
  thumbHeight: number;
  thumbTop: number;
  maxScrollTop: number;
  maxThumbTop: number;
}

export interface ScrollbarDragInput {
  startScrollTop: number;
  deltaY: number;
  maxScrollTop: number;
  maxThumbTop: number;
}

const DEFAULT_MIN_THUMB_HEIGHT = 36;
const SCROLLABLE_EPSILON_PX = 2;

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * Computes overlay scrollbar thumb size and vertical offset without DOM access.
 */
export function computeScrollbarMetrics({
  scrollTop,
  scrollHeight,
  clientHeight,
  trackHeight,
  minThumbHeight = DEFAULT_MIN_THUMB_HEIGHT,
}: ScrollbarMetricsInput): ScrollbarMetrics {
  if (
    !isPositiveFinite(scrollHeight) ||
    !isPositiveFinite(clientHeight) ||
    !isPositiveFinite(trackHeight) ||
    scrollHeight <= clientHeight + SCROLLABLE_EPSILON_PX
  ) {
    return {
      scrollable: false,
      thumbHeight: 0,
      thumbTop: 0,
      maxScrollTop: 0,
      maxThumbTop: 0,
    };
  }

  const maxScrollTop = scrollHeight - clientHeight;
  const safeScrollTop = Number.isFinite(scrollTop) ? clamp(scrollTop, 0, maxScrollTop) : 0;
  const safeMinThumb =
    Number.isFinite(minThumbHeight) && minThumbHeight > 0
      ? Math.min(minThumbHeight, trackHeight)
      : Math.min(DEFAULT_MIN_THUMB_HEIGHT, trackHeight);

  const proportionalHeight = (clientHeight / scrollHeight) * trackHeight;
  const thumbHeight = clamp(proportionalHeight, safeMinThumb, trackHeight);
  const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
  const thumbTop = maxScrollTop > 0 ? (safeScrollTop / maxScrollTop) * maxThumbTop : 0;

  return {
    scrollable: true,
    thumbHeight,
    thumbTop,
    maxScrollTop,
    maxThumbTop,
  };
}

/**
 * Maps a vertical pointer drag delta on the overlay thumb back to a clamped document scrollTop.
 */
export function computeScrollTopFromDrag({
  startScrollTop,
  deltaY,
  maxScrollTop,
  maxThumbTop,
}: ScrollbarDragInput): number {
  if (
    !Number.isFinite(startScrollTop) ||
    !Number.isFinite(deltaY) ||
    !isPositiveFinite(maxScrollTop) ||
    !isPositiveFinite(maxThumbTop)
  ) {
    return 0;
  }

  const next = startScrollTop + (deltaY / maxThumbTop) * maxScrollTop;
  return clamp(next, 0, maxScrollTop);
}
