import type { Decorator } from "@storybook/react-vite";

/**
 * #1851: in the installed iPhone app, columns that draw their own header (Docs
 * list, Notes, Contacts) slid under the status bar and the menu toggle could not
 * be tapped. Browsers have no notch, so these stories stand one in with
 * `--workspace-safe-area-top/bottom` and a shaded band where the clock sits.
 */
export const STATUS_BAR_INSET_PX = 47;
export const HOME_INDICATOR_INSET_PX = 34;

export const withStatusBarInset: Decorator = (Story) => (
  <div
    style={{
      position: "relative",
      ["--workspace-safe-area-top" as string]: `${STATUS_BAR_INSET_PX}px`,
      ["--workspace-safe-area-bottom" as string]: `${HOME_INDICATOR_INSET_PX}px`,
    }}
  >
    <Story />
    <div
      aria-hidden
      style={{
        position: "absolute",
        insetInline: 0,
        top: 0,
        height: STATUS_BAR_INSET_PX,
        background: "color-mix(in oklab, black 12%, transparent)",
        pointerEvents: "none",
        zIndex: 60,
      }}
    />
  </div>
);

/** Distance from the top of the story root, so a scrolled canvas does not skew it. */
export function offsetFromStoryTop(canvasElement: HTMLElement, element: Element): number {
  return element.getBoundingClientRect().top - canvasElement.getBoundingClientRect().top;
}
