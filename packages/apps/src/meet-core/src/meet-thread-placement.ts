import type { MeetCallStageLayout } from "@/meet-core/src/meet-call-stage-layout";

export type MeetThreadCallLayout = "none" | "split" | "fullscreen";
export type MeetThreadPlacement = "panel" | "drawer";

export function meetCallLayoutToThreadLayout(layout: MeetCallStageLayout): MeetThreadCallLayout {
  if (layout === "side-by-side") return "split";
  if (layout === "fullscreen") return "fullscreen";
  return "none";
}

/** Idle chat uses the docs-style right rail; an open call keeps that rail for the stage. */
export function meetThreadPlacement(
  callLayout?: MeetThreadCallLayout | null,
  callActive = false,
): MeetThreadPlacement {
  if (callLayout === "split" || callLayout === "fullscreen") return "drawer";
  if (callLayout === "none") return "panel";
  return callActive ? "drawer" : "panel";
}
