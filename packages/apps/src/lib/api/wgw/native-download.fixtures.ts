import { vi } from "vitest";

/**
 * Test fixture: stubs `document` so the anchors `startNativeDownload` clicks
 * are recorded. Call `restore` to put `document` back.
 */
export function stubAnchorClicks() {
  const clicked: Array<{ href: string; download: string }> = [];
  vi.stubGlobal("document", {
    createElement: () => {
      const anchor = {
        href: "",
        download: "",
        rel: "",
        style: {} as Record<string, string>,
        click: () => clicked.push({ href: anchor.href, download: anchor.download }),
        remove: () => undefined,
      };
      return anchor;
    },
    body: { append: () => undefined },
  });
  return { clicked, restore: () => vi.unstubAllGlobals() };
}
