/**
 * Browser Meet paths put type in the URL (`/meet/channels|meetings|dms/{id}`).
 * DAV/API collection ids still use `chat-` / `chat-grp-` / `dm-` prefixes so
 * VJOURNAL families stay distinguishable. These helpers map at the URL edge.
 */

const CHAT_GROUP_PREFIX = "chat-grp-";
const CHAT_PREFIX = "chat-";
const DM_PREFIX = "dm-";
const GROUP_HASH = /^[0-9a-f]{40}$/i;

/** Path segment for `/meet/channels/{id}` — no `chat-` / `chat-grp-`. */
export function meetPublicChannelId(collectionId: string): string {
  const id = collectionId.trim();
  const lower = id.toLowerCase();
  if (lower.startsWith(CHAT_GROUP_PREFIX)) return id.slice(CHAT_GROUP_PREFIX.length);
  if (lower.startsWith(CHAT_PREFIX)) return id.slice(CHAT_PREFIX.length);
  return id;
}

/** API/DAV collection id from a public channel path segment (or a legacy `chat-` id). */
export function meetCollectionIdFromPublic(publicId: string): string {
  const id = publicId.trim();
  const lower = id.toLowerCase();
  if (lower.startsWith(CHAT_PREFIX) || lower.startsWith(DM_PREFIX)) return id;
  if (GROUP_HASH.test(id)) return `${CHAT_GROUP_PREFIX}${lower}`;
  return `${CHAT_PREFIX}${id}`;
}

/** Ids to try against REST (`getChannel`) — public segment first, then collection. */
export function meetCollectionIdCandidates(publicOrCollection: string): string[] {
  const raw = publicOrCollection.trim();
  if (!raw) return [];
  const collection = meetCollectionIdFromPublic(raw);
  return raw.toLowerCase() === collection.toLowerCase() ? [collection] : [collection, raw];
}

export function meetChannelIdsEqual(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const a = left?.trim();
  const b = right?.trim();
  if (!a || !b) return false;
  if (a.toLowerCase() === b.toLowerCase()) return true;
  return meetPublicChannelId(a).toLowerCase() === meetPublicChannelId(b).toLowerCase();
}
