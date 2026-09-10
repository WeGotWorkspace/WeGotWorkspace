import type { CSSProperties } from "react";

export const WORKSPACE_SIDEBAR_TOGGLE_STYLE: CSSProperties = {
  color: "var(--workspace-sidebar-toggle-color, var(--color-ink))",
  backgroundColor:
    "var(--workspace-sidebar-toggle-bg, color-mix(in oklab, var(--color-ink) 6%, transparent))",
};
