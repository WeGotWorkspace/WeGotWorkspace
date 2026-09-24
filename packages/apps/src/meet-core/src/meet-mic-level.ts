/** Ignore laptop-fan / room hiss so the lobby meter stays parked at rest. */
export const MEET_MIC_LEVEL_NOISE_FLOOR = 0.045;
/** Close-talk RMS that fills the bar after the floor is removed. */
export const MEET_MIC_LEVEL_SPEECH_PEAK = 0.28;
/** Fraction of the gap closed on a rising sample (faster than release). */
export const MEET_MIC_LEVEL_ATTACK = 0.28;
/** Fraction of the gap closed on a falling sample. */
export const MEET_MIC_LEVEL_RELEASE = 0.08;
/** How often React may see a new width (envelope still runs every frame). */
export const MEET_MIC_LEVEL_PUBLISH_MS = 50;

export function meetMicRms(samples: Uint8Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const value of samples) {
    const normalized = (value - 128) / 128;
    sum += normalized * normalized;
  }
  return Math.sqrt(sum / samples.length);
}

export function smoothMeetMicLevel(previous: number, rms: number): number {
  const span = MEET_MIC_LEVEL_SPEECH_PEAK - MEET_MIC_LEVEL_NOISE_FLOOR;
  const gated = Math.max(0, rms - MEET_MIC_LEVEL_NOISE_FLOOR);
  const target = span <= 0 ? 0 : Math.min(1, gated / span);
  const rate = target > previous ? MEET_MIC_LEVEL_ATTACK : MEET_MIC_LEVEL_RELEASE;
  const next = previous + (target - previous) * rate;
  return next < 0.01 ? 0 : next;
}

export function shouldPublishMeetMicLevel(
  published: number,
  next: number,
  elapsedMs: number,
  lastPublishAt = 0,
): boolean {
  if (next === 0 && published !== 0) return true;
  return elapsedMs - lastPublishAt >= MEET_MIC_LEVEL_PUBLISH_MS;
}
