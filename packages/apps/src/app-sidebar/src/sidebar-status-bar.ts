import { isSidebarOverlayViewport } from "@/workspace-shell/src/sidebar-breakpoint";

/**
 * iOS paints the status-bar band from the document background, not from the
 * drawer. While the overlay sidebar is open, that band should match the
 * sidebar fill so the top edge is not a second color.
 */
export function openSidebarStatusBarColor(
  open: boolean,
  overlay: boolean,
  backgroundColor: string,
): string | null {
  if (!open || !overlay) return null;
  const color = backgroundColor.trim();
  if (color === "" || color === "transparent" || color === "rgba(0, 0, 0, 0)") return null;
  return color;
}

export function bindOpenSidebarStatusBar(sidebar: HTMLElement | null, open: boolean): () => void {
  const color = openSidebarStatusBarColor(
    open,
    isSidebarOverlayViewport(),
    sidebar ? getComputedStyle(sidebar).backgroundColor : "",
  );
  if (!color) return () => {};

  const root = document.documentElement;
  const body = document.body;
  const previousRoot = root.style.backgroundColor;
  const previousBody = body.style.backgroundColor;
  root.style.backgroundColor = color;
  body.style.backgroundColor = color;

  return () => {
    root.style.backgroundColor = previousRoot;
    body.style.backgroundColor = previousBody;
  };
}
