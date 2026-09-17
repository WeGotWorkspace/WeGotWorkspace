import { isSidebarOverlayViewport } from "@/workspace-shell/src/sidebar-breakpoint";

/** Matches `--breakpoint-sidebar` / Calendar inbox dock (1160px). */
export const MEET_WORKSPACE_PANEL_FLEX_MIN = "72.5rem";

/** Right rail width — feeds `--workspace-panel-width` for thread and call chat. */
export const MEET_WORKSPACE_PANEL_WIDTH = "22rem";

/** @deprecated Use {@link MEET_WORKSPACE_PANEL_FLEX_MIN}. */
export const MEET_CALL_CHAT_PANEL_FLEX_MIN = MEET_WORKSPACE_PANEL_FLEX_MIN;

/** @deprecated Use {@link MEET_WORKSPACE_PANEL_WIDTH}. */
export const MEET_CALL_CHAT_PANEL_WIDTH = MEET_WORKSPACE_PANEL_WIDTH;

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
