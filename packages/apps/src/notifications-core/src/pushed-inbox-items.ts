import type { NotificationInboxItem, NotificationInboxList } from "./notifications-types";

/**
 * How long a row posted by the service worker stays in the bell while the
 * inbox lists do not carry it yet (#1670). A list that has it confirms it
 * sooner; after this, the server's list wins (the row was read or cleared).
 */
export const PUSHED_ITEM_HOLD_MS = 10_000;

export type PushedInboxItems = ReadonlyMap<
  string,
  { readonly item: NotificationInboxItem; readonly until: number }
>;

export function holdPushedItem(
  pending: PushedInboxItems,
  item: NotificationInboxItem,
  now: number,
): PushedInboxItems {
  const next = new Map(pending);
  next.set(item.id, { item, until: now + PUSHED_ITEM_HOLD_MS });
  return next;
}

export function dropPushedItems(
  pending: PushedInboxItems,
  ids: Iterable<string>,
): PushedInboxItems {
  const next = new Map(pending);
  for (const id of ids) next.delete(id);
  return next;
}

/**
 * The inbox list with the held rows it does not carry yet in front. Rows the
 * list carries, and rows held too long, leave `pending`.
 */
export function mergePushedItems(
  payload: NotificationInboxList,
  pending: PushedInboxItems,
  now: number,
): { payload: NotificationInboxList; pending: PushedInboxItems } {
  if (pending.size === 0) return { payload, pending };
  const listed = new Set(payload.list.map((item) => item.id));
  const next = new Map<string, { item: NotificationInboxItem; until: number }>();
  const extra: NotificationInboxItem[] = [];
  for (const [id, held] of pending) {
    if (listed.has(id) || held.until <= now) continue;
    next.set(id, held);
    extra.push(held.item);
  }
  if (extra.length === 0) return { payload, pending: next };
  return {
    payload: { list: [...extra, ...payload.list], unreadCount: payload.unreadCount + extra.length },
    pending: next,
  };
}
