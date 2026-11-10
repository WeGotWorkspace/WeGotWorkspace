import { isSidebarOverlayViewport } from "@/workspace-shell/src/sidebar-breakpoint";

/** Matches `--breakpoint-sidebar` / Calendar inbox dock (1160px). */
export const MEET_WORKSPACE_PANEL_FLEX_MIN = "72.5rem";

/** @deprecated Use {@link MEET_WORKSPACE_PANEL_FLEX_MIN}. */
export const MEET_CALL_CHAT_PANEL_FLEX_MIN = MEET_WORKSPACE_PANEL_FLEX_MIN;

/**
 * Calendar inbox starts closed. Meet’s right rail opens when it can flex in,
 * and stays closed when it would overlay.
 */
export function defaultMeetWorkspacePanelOpen(): boolean {
  return !isSidebarOverlayViewport();
}

/** @deprecated Use {@link defaultMeetWorkspacePanelOpen}. */
export function defaultMeetCallChatOpen(): boolean {
  return defaultMeetWorkspacePanelOpen();
}
