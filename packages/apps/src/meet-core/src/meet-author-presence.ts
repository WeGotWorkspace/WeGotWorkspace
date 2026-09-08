import type { ChatAuthorPresenceMap } from "@/chat-ui/src/chat-types";
import type { PresenceCoworker } from "@/presence-core/src/presence-types";

/** Roster usernames → chat author presence (anyone absent is treated offline). */
export function authorPresenceFromRoster(
  roster: readonly PresenceCoworker[],
): ChatAuthorPresenceMap {
  const map: Record<string, NonNullable<ChatAuthorPresenceMap[string]>> = {};
  for (const coworker of roster) {
    if (!coworker.username) continue;
    map[coworker.username] = coworker.status;
  }
  return map;
}

/**
 * Live roster first, fixture/demo map last so Storybook `authorPresence` still
 * wins when both are present.
 */
export function mergeAuthorPresence(
  live: ChatAuthorPresenceMap | undefined,
  fixture: ChatAuthorPresenceMap | undefined,
): ChatAuthorPresenceMap | undefined {
  if (!live && !fixture) return undefined;
  if (!live) return fixture;
  if (!fixture) return live;
  return { ...live, ...fixture };
}
