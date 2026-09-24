import type { MeetCallStageLayout } from "@/meet-core/src/meet-call-stage-layout";

export type MeetThreadCallLayout = "none" | "split" | "fullscreen";
export type MeetThreadPlacement = "panel" | "drawer";

export function meetCallLayoutToThreadLayout(layout: MeetCallStageLayout): MeetThreadCallLayout {
  if (layout === "side-by-side") return "split";
  if (layout === "fullscreen") return "fullscreen";
  return "none";
}

/**
 * Thread and in-call chat share one workspace right rail. Placement is always
 * `panel` — the old SideDrawer path is gone.
 */
export function meetThreadPlacement(
  _callLayout?: MeetThreadCallLayout | null,
  _callActive = false,
): MeetThreadPlacement {
  return "panel";
}

/** Back to channel chat — only when the expanded call rail is showing a thread. */
export function meetThreadRailShowsBack(expandedCall: boolean, threadVisible: boolean): boolean {
  return expandedCall && threadVisible;
}
