import type { ChatAuthorPresenceMap } from "@/lib/models/chat-types";
export { authorPresenceFromRoster } from "@/presence-core/src/use-author-presence";

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
