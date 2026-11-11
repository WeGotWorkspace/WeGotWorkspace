/**
 * Keyboard focus in item lists (Drive and Docs rows and tiles, pickers). An item is
 * the element with `data-list-item-id`; what takes focus is that element or the one
 * inside it marked `data-list-item-focus` (a tile's hit button).
 */

export const LIST_ITEM_SELECTOR = "[data-list-item-id]";

export function listItemFocusTarget(item: Element): HTMLElement | null {
  if (item instanceof HTMLElement && item.matches("[data-list-item-focus]")) return item;
  return item.querySelector<HTMLElement>("[data-list-item-focus]");
}

/** The id of the item that holds `node` (focus, an event target), if any. */
export function listItemIdOf(node: EventTarget | null): string | null {
  if (!(node instanceof Element)) return null;
  return node.closest(LIST_ITEM_SELECTOR)?.getAttribute("data-list-item-id") ?? null;
}

/** The next (or previous) item in `container` after `fromId` that can be chosen. */
export function adjacentListItem(
  container: Element,
  fromId: string,
  direction: -1 | 1,
): Element | null {
  const items = Array.from(container.querySelectorAll(LIST_ITEM_SELECTOR)).filter(
    (item) => item.getAttribute("aria-disabled") !== "true",
  );
  const index = items.findIndex((item) => item.getAttribute("data-list-item-id") === fromId);
  if (index < 0) return items[direction > 0 ? 0 : items.length - 1] ?? null;
  return items[index + direction] ?? null;
}

/**
 * After a key opened a folder or went up one, the focused item leaves the page and
 * focus falls back to the document, or to a dialog that keeps it inside. Once the new
 * listing is there, put focus on its item that Tab reaches, so the keys keep working.
 * Gives up after `timeoutMs` (a slow listing) or when focus went elsewhere on purpose.
 */
export function refocusListAfterNavigation(scope: Element = document.body, timeoutMs = 3000) {
  const started = Date.now();
  const attempt = () => {
    const current = document.activeElement;
    const item = scope.querySelector<HTMLElement>('[data-list-item-focus][tabindex="0"]');
    // Focus left with the old item: on the page, or on a container around the list.
    const fellBack =
      !current || !current.isConnected || current === document.body || current.contains(scope);
    if (fellBack && item) {
      item.focus();
      return;
    }
    // Still on an item: the old listing is up, or the key opened a file in place.
    if (!fellBack && !listItemIdOf(current)) return;
    if (Date.now() - started < timeoutMs) setTimeout(attempt, 50);
  };
  setTimeout(attempt, 0);
}
