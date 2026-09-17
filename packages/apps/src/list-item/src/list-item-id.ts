export const LIST_ITEM_ID_ATTR = "data-list-item-id";

export function listItemIdFromTarget(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return target.closest(`[${LIST_ITEM_ID_ATTR}]`)?.getAttribute(LIST_ITEM_ID_ATTR) ?? null;
}
