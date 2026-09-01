/** Palette tokens for hashed user tiles (washed fill + saturated ring in CSS). */
export const USER_AVATAR_COLORS = [
  "amber",
  "cyan",
  "orange",
  "violet",
  "rose",
  "lime",
  "teal",
  "sky",
] as const;

export type UserAvatarColor = (typeof USER_AVATAR_COLORS)[number];

/** FNV-1a 32-bit — stable bucket for a user id. */
function hashUserId(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** One stable palette token per user id so new messages pick up a color automatically. */
export function avatarColorForUserId(id: string): UserAvatarColor {
  const key = id.trim();
  if (!key) return USER_AVATAR_COLORS[0];
  return USER_AVATAR_COLORS[hashUserId(key) % USER_AVATAR_COLORS.length];
}
