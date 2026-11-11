/**
 * Presence pip: online green, away amber, offline transparent + ink ring.
 * `pending` (blue, `--color-sync-pending`) is not a person's status: it marks a save
 * or sync still in flight. Use it for that instead of `away`.
 * The signed-in user's own offline state (sidebar account footer) uses `away` with an
 * overridden accessible label; `offline` stays reserved for other people's presence.
 */
export type UserAvatarPresence = "online" | "offline" | "away" | "pending";
