/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NOTIFICATION_INBOX_CHIME_SRC,
  NOTIFICATION_INBOX_SOUND_MUTED_KEY,
  playInboxNotificationSound,
  readNotificationSoundMuted,
  resetInboxNotificationSoundForTests,
  shouldPlayInboxNotificationSound,
  writeNotificationSoundMuted,
} from "./notification-inbox-sound";

describe("notification-inbox-sound", () => {
  beforeEach(() => {
    window.localStorage.removeItem(NOTIFICATION_INBOX_SOUND_MUTED_KEY);
    resetInboxNotificationSoundForTests();
  });

  afterEach(() => {
    window.localStorage.removeItem(NOTIFICATION_INBOX_SOUND_MUTED_KEY);
    resetInboxNotificationSoundForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("defaults unmuted and persists mute in localStorage", () => {
    expect(readNotificationSoundMuted()).toBe(false);
    writeNotificationSoundMuted(true);
    expect(window.localStorage.getItem(NOTIFICATION_INBOX_SOUND_MUTED_KEY)).toBe("1");
    expect(readNotificationSoundMuted()).toBe(true);
    writeNotificationSoundMuted(false);
    expect(window.localStorage.getItem(NOTIFICATION_INBOX_SOUND_MUTED_KEY)).toBeNull();
    expect(readNotificationSoundMuted()).toBe(false);
  });

  it("plays only when unmuted and the document is visible", () => {
    expect(shouldPlayInboxNotificationSound("visible", false)).toBe(true);
    expect(shouldPlayInboxNotificationSound("visible", true)).toBe(false);
    expect(shouldPlayInboxNotificationSound("hidden", false)).toBe(false);
  });

  it("constructs Audio with the public chime path", () => {
    const play = vi.fn(async () => undefined);
    const AudioMock = vi.fn(function AudioMock(
      this: { src: string; currentTime: number; play: typeof play },
      src: string,
    ) {
      this.src = src;
      this.currentTime = 0;
      this.play = play;
    });
    vi.stubGlobal("Audio", AudioMock);

    playInboxNotificationSound();
    expect(AudioMock).toHaveBeenCalledWith(NOTIFICATION_INBOX_CHIME_SRC);
    expect(play).toHaveBeenCalledTimes(1);

    playInboxNotificationSound();
    expect(AudioMock).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledTimes(2);
  });
});
