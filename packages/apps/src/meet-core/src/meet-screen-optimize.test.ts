import { describe, expect, it, vi } from "vitest";
import {
  applyScreenOptimize,
  screenCaptureConstraints,
} from "@/meet-core/src/meet-screen-optimize";

describe("screen optimize", () => {
  it("starts text at 8 fps and video at 720p without a new display capture", () => {
    expect(screenCaptureConstraints("text", false)).toEqual({ frameRate: { max: 8 } });
    expect(screenCaptureConstraints("video", false)).toMatchObject({
      frameRate: { max: 24 },
      height: { max: 720 },
    });
    expect(screenCaptureConstraints("video", true).frameRate).toEqual({ max: 4 });
  });

  it("switches a live track with applyConstraints and does not open a new capture", async () => {
    const getDisplayMedia = vi.fn();
    const applyConstraints = vi.fn(async () => {});
    const track = {
      contentHint: "",
      applyConstraints,
    } as unknown as MediaStreamTrack;
    await applyScreenOptimize(track, "video", false);
    expect(track.contentHint).toBe("motion");
    expect(applyConstraints).toHaveBeenCalledWith(
      expect.objectContaining({ frameRate: { max: 24 }, height: { max: 720 } }),
    );
    await applyScreenOptimize(track, "text", true);
    expect(track.contentHint).toBe("detail");
    expect(applyConstraints).toHaveBeenLastCalledWith({ frameRate: { max: 4 } });
    expect(getDisplayMedia).not.toHaveBeenCalled();
  });
});
