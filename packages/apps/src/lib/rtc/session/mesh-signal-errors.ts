/** Signaling rejected the local peer id — the mesh rejoins under a new one. */
export function isUnknownPeerError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("unknown_peer");
}

/** The remote id is not a live peer — a ghost from a stale roster. */
export function isInvalidPeerError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("invalid_peer");
}
