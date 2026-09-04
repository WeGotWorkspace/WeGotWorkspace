export type PresenceJoinMode = "eager" | "lazy";

export type PresenceEnvironment = {
  hasCoarsePointer: boolean;
  viewportWidth: number;
};

/** Viewport at or below this width counts as mobile for join timing. */
export const PRESENCE_MOBILE_VIEWPORT_MAX_PX = 767;

/**
 * Desktop sessions join the principal room eagerly (presence/chat/typing are
 * instant); touch/small-viewport sessions join lazily on first visibility so a
 * backgrounded mobile PWA does not hold a mesh it is not looking at.
 */
export function decidePresenceJoinMode(env: PresenceEnvironment): PresenceJoinMode {
  if (env.hasCoarsePointer || env.viewportWidth <= PRESENCE_MOBILE_VIEWPORT_MAX_PX) {
    return "lazy";
  }
  return "eager";
}

export function readPresenceEnvironment(): PresenceEnvironment {
  const hasCoarsePointer =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(pointer: coarse)").matches
      : false;
  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1024;
  return { hasCoarsePointer, viewportWidth };
}
