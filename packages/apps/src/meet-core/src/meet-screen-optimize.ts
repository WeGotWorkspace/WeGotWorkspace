import type { ScreenOptimize } from "@/meet-core/src/meet-video-sender";
import { screenContentHint, screenMaxFramerate } from "@/meet-core/src/meet-video-sender";

export type { ScreenOptimize };

/** Constraints for a share that is starting. Text is the default. */
export function screenCaptureConstraints(
  mode: ScreenOptimize,
  lowData: boolean,
): MediaTrackConstraints {
  const frameRate = { max: screenMaxFramerate(mode, lowData) };
  if (mode === "video" && !lowData) {
    return { frameRate, height: { max: 720 }, width: { max: 1280 } };
  }
  return { frameRate };
}

/**
 * Switch a live share. `applyConstraints` and `contentHint` do not restart
 * `getDisplayMedia` and do not renegotiate.
 */
export async function applyScreenOptimize(
  track: MediaStreamTrack,
  mode: ScreenOptimize,
  lowData: boolean,
): Promise<void> {
  track.contentHint = screenContentHint(mode);
  await track.applyConstraints(screenCaptureConstraints(mode, lowData));
}
