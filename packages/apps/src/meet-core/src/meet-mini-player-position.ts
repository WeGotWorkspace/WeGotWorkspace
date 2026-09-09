export type MeetMiniPlayerPosition = { x: number; y: number };

/** Matches Tailwind `bottom-4 right-4` (1rem) on the default dock. */
export const MEET_MINI_PLAYER_INSET = 16;

/** Ignore jitter so a click to return to the call is not treated as a drag. */
export const MEET_MINI_PLAYER_DRAG_THRESHOLD_PX = 4;

export function meetMiniPlayerDefaultPosition(input: {
  viewportWidth: number;
  viewportHeight: number;
  width: number;
  height: number;
  inset?: number;
}): MeetMiniPlayerPosition {
  const inset = input.inset ?? MEET_MINI_PLAYER_INSET;
  return meetClampMiniPlayerPosition({
    x: input.viewportWidth - input.width - inset,
    y: input.viewportHeight - input.height - inset,
    viewportWidth: input.viewportWidth,
    viewportHeight: input.viewportHeight,
    width: input.width,
    height: input.height,
    inset,
  });
}

export function meetClampMiniPlayerPosition(input: {
  x: number;
  y: number;
  viewportWidth: number;
  viewportHeight: number;
  width: number;
  height: number;
  inset?: number;
}): MeetMiniPlayerPosition {
  const inset = input.inset ?? MEET_MINI_PLAYER_INSET;
  const maxX = Math.max(inset, input.viewportWidth - input.width - inset);
  const maxY = Math.max(inset, input.viewportHeight - input.height - inset);
  return {
    x: Math.max(inset, Math.min(input.x, maxX)),
    y: Math.max(inset, Math.min(input.y, maxY)),
  };
}

export function meetMiniPlayerDragExceededThreshold(
  dx: number,
  dy: number,
  threshold = MEET_MINI_PLAYER_DRAG_THRESHOLD_PX,
): boolean {
  return dx * dx + dy * dy >= threshold * threshold;
}
