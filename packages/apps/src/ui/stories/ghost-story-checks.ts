import { expect } from "storybook/test";

const TRANSPARENT = "rgba(0, 0, 0, 0)";

/**
 * A ghost control shows no fill or border at rest. In a test run the real pointer can
 * rest on the story (where an earlier test left it), and a hovered or focused ghost
 * shows its wash: the fill is only checked at rest, the border always.
 */
export async function expectGhostAtRest(element: HTMLElement, { border = true } = {}) {
  const style = getComputedStyle(element);
  if (border) await expect(style.borderTopColor).toBe(TRANSPARENT);
  if (element.matches(":hover, :focus")) {
    await expect(style.backgroundColor).not.toBe(TRANSPARENT);
    return;
  }
  await expect(style.backgroundColor).toBe(TRANSPARENT);
}

/** The ghost's wash while it is hovered or being typed in. */
export async function expectGhostWash(element: HTMLElement) {
  await expect(getComputedStyle(element).backgroundColor).not.toBe(TRANSPARENT);
}
