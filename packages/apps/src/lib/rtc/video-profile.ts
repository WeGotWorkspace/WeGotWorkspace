/**
 * Send-side video profiles, best first, mirroring the server's ranking.
 *
 * A profile is a ceiling on what a sender may encode, never a target: which
 * one a client picks stays automatic, driven by peer count. Audio is never
 * affected by any of these.
 */

export const VIDEO_PROFILES_RANKED = ["p720", "p360", "p270", "p180", "audio"] as const;

export type VideoProfile = (typeof VIDEO_PROFILES_RANKED)[number];

export interface VideoProfileSpec {
  /** Longest edge in pixels. `audio` sends no video at all. */
  height: number | null;
  /** Ceiling in bits per second. */
  maxBitrate: number | null;
}

export const VIDEO_PROFILE_SPECS: Record<VideoProfile, VideoProfileSpec> = {
  p720: { height: 720, maxBitrate: 1_200_000 },
  p360: { height: 360, maxBitrate: 500_000 },
  p270: { height: 270, maxBitrate: 250_000 },
  p180: { height: 180, maxBitrate: 120_000 },
  audio: { height: null, maxBitrate: null },
};

/** Admin-facing wording. Video quality only — audio is unaffected. */
export const VIDEO_PROFILE_LABELS: Record<VideoProfile, string> = {
  p720: "720p (high)",
  p360: "360p (medium)",
  p270: "270p (low)",
  p180: "180p (very low)",
  audio: "Audio only (no camera)",
};

export function isVideoProfile(value: unknown): value is VideoProfile {
  return typeof value === "string" && (VIDEO_PROFILES_RANKED as readonly string[]).includes(value);
}

export function normalizeVideoProfile(value: unknown, fallback: VideoProfile): VideoProfile {
  return isVideoProfile(value) ? value : fallback;
}

/**
 * The lower quality of the two. Ceilings compose by taking the worst, so no
 * single cap can raise what another already lowered.
 */
export function clampVideoProfile(profile: VideoProfile, ceiling: VideoProfile): VideoProfile {
  const profileRank = VIDEO_PROFILES_RANKED.indexOf(profile);
  const ceilingRank = VIDEO_PROFILES_RANKED.indexOf(ceiling);
  return VIDEO_PROFILES_RANKED[Math.max(profileRank, ceilingRank)] as VideoProfile;
}
