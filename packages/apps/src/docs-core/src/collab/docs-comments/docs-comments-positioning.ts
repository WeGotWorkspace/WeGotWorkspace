export type FloatingCommentLayoutItem = {
  id: string;
  idealTop: number;
  height: number;
};

/** Viewport `top` for fixed-position margin cards (not clipped by sheet overflow). */
export function measureCommentMarkViewportTop(mark: Element | null): number | null {
  if (!mark) return null;
  return mark.getBoundingClientRect().top;
}

/** Viewport `left` just to the right of the sheet surface. */
export function measureCommentCardViewportLeft(
  surfaceElement: HTMLElement | null,
  gapPx: number,
): number | null {
  if (!surfaceElement) return null;
  return surfaceElement.getBoundingClientRect().right + gapPx;
}

/** Minimum viewport `top` for margin cards (below workspace chrome such as the doc header). */
export function measureCommentCardsViewportTopInset(
  headerElement: HTMLElement | null,
  gapPx = 8,
): number {
  if (!headerElement) return gapPx;
  return headerElement.getBoundingClientRect().bottom + gapPx;
}

/** Minimum viewport `top` for the floating comments layer (header + editor format bar). */
export function measureCommentFloatingLayerTop(
  headerElement: HTMLElement | null,
  formatBarElement: HTMLElement | null,
  gapPx = 8,
): number {
  const headerTop = measureCommentCardsViewportTopInset(headerElement, gapPx);
  if (!formatBarElement) return headerTop;
  return Math.max(headerTop, formatBarElement.getBoundingClientRect().bottom + gapPx);
}

/** Viewport `top` for the floating comments layer — aligned with the sheet surface top. */
export function measureCommentFloatingLayerTopFromSurface(
  surfaceElement: HTMLElement | null,
  fallbackTopPx = 0,
): number {
  if (!surfaceElement) return fallbackTopPx;
  return surfaceElement.getBoundingClientRect().top;
}

/** Maximum viewport `top + height` for margin cards (above stats footer). */
export function measureCommentCardsViewportBottomLimit(
  footerElement: HTMLElement | null,
  gapPx = 16,
  viewportHeight = typeof window !== "undefined" ? window.innerHeight : 0,
): number {
  if (footerElement) {
    return footerElement.getBoundingClientRect().top - gapPx;
  }
  return viewportHeight - gapPx;
}

function clampFloatingCardTop(
  top: number,
  height: number,
  minTopPx: number,
  maxBottomPx: number,
): number {
  const maxTop = maxBottomPx - height;
  if (maxTop <= minTopPx) return minTopPx;
  return Math.min(Math.max(top, minTopPx), maxTop);
}

/** Pin a margin card to its mark, clamped into the viewport between header and footer. */
export function resolveFloatingCardTop(
  idealTop: number,
  height: number,
  minTopPx: number,
  maxBottomPx: number,
): number {
  return clampFloatingCardTop(idealTop, height, minTopPx, maxBottomPx);
}

export type FloatingCommentOverlapItem = {
  id: string;
  top: number;
  height: number;
};

function verticalRangesOverlap(
  topA: number,
  heightA: number,
  topB: number,
  heightB: number,
  overlapGapPx = 8,
): boolean {
  return topA < topB + heightB - overlapGapPx && topB < topA + heightA - overlapGapPx;
}

export type FloatingCommentOverlapLayout = {
  indents: Map<string, number>;
  /** Monotonic stack depth for z-index (not capped like indents). */
  levels: Map<string, number>;
};

/** Stagger overlapping margin cards horizontally so stacked threads stay peekable. */
export function layoutFloatingCommentOverlapIndents(
  items: FloatingCommentOverlapItem[],
  indentStepPx = 18,
  maxIndentPx = 108,
): FloatingCommentOverlapLayout {
  const sorted = [...items].sort((a, b) => a.top - b.top || a.id.localeCompare(b.id));
  const indents = new Map<string, number>();
  const levels = new Map<string, number>();

  for (let index = 0; index < sorted.length; index += 1) {
    const item = sorted[index]!;
    let level = 0;

    for (let prior = 0; prior < index; prior += 1) {
      const other = sorted[prior]!;
      if (!verticalRangesOverlap(item.top, item.height, other.top, other.height)) continue;
      const otherLevel = levels.get(other.id) ?? 0;
      level = Math.max(level, otherLevel + 1);
    }

    levels.set(item.id, level);
    indents.set(item.id, Math.min(level * indentStepPx, maxIndentPx));
  }

  return { indents, levels };
}

/** Max card height in px so cards stay above the stats footer and viewport bottom. */
export function measureCommentCardMaxHeightPx(
  cardTopPx: number,
  footerElement: HTMLElement | null,
  bottomGapPx = 16,
  viewportHeight = typeof window !== "undefined" ? window.innerHeight : 0,
): number {
  const viewportLimit = viewportHeight - cardTopPx - bottomGapPx;

  if (!footerElement) {
    return Math.max(viewportLimit, 0);
  }

  const footerLimit = footerElement.getBoundingClientRect().top - cardTopPx - bottomGapPx;
  if (footerLimit <= 0) {
    return Math.max(viewportLimit, 0);
  }

  return Math.max(Math.min(viewportLimit, footerLimit), 0);
}

/** Stack floating cards with a minimum gap so overlapping threads stay readable. */
export function layoutFloatingCommentTops(
  items: FloatingCommentLayoutItem[],
  minGapPx: number,
  minTopPx = 0,
  maxBottomPx = Number.POSITIVE_INFINITY,
  prioritizeId?: string | null,
): Map<string, number> {
  const tops = new Map<string, number>();
  const bottomLimit = Number.isFinite(maxBottomPx) ? maxBottomPx : Number.POSITIVE_INFINITY;
  const sorted = [...items].sort((a, b) => a.idealTop - b.idealTop);
  const priorityItem = prioritizeId ? items.find((item) => item.id === prioritizeId) : undefined;
  const stackItems = priorityItem ? sorted.filter((item) => item.id !== prioritizeId) : sorted;

  let cursor = Number.NEGATIVE_INFINITY;

  for (const item of stackItems) {
    const stackedTop = Math.max(item.idealTop, cursor + minGapPx, minTopPx);
    const top = clampFloatingCardTop(stackedTop, item.height, minTopPx, bottomLimit);
    tops.set(item.id, top);
    cursor = top + item.height;
  }

  if (priorityItem) {
    const top = clampFloatingCardTop(
      priorityItem.idealTop,
      priorityItem.height,
      minTopPx,
      bottomLimit,
    );
    tops.set(priorityItem.id, top);
  }

  return tops;
}
