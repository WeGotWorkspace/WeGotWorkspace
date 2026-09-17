/** Device-local mute for the suite inbox chime. Default unmuted (key absent). */
export const NOTIFICATION_INBOX_SOUND_MUTED_KEY = "wgw.ui.notifications.soundMuted";

/** Served from `packages/apps/public/sounds/` (see README there for attribution). */
export const NOTIFICATION_INBOX_CHIME_SRC = "/sounds/notification-chime.mp3";

function hasWindowStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

/** True when the user muted inbox notification sound (localStorage `"1"`). */
export function readNotificationSoundMuted(): boolean {
  if (!hasWindowStorage()) return false;
  try {
    return window.localStorage.getItem(NOTIFICATION_INBOX_SOUND_MUTED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeNotificationSoundMuted(muted: boolean): void {
  if (!hasWindowStorage()) return;
  try {
    if (muted) {
      window.localStorage.setItem(NOTIFICATION_INBOX_SOUND_MUTED_KEY, "1");
    } else {
      window.localStorage.removeItem(NOTIFICATION_INBOX_SOUND_MUTED_KEY);
    }
  } catch {
    // Ignore storage failures (private mode, quota).
  }
}

/**
 * In-app chime when the tab is focused. Hidden tabs use the OS toast path instead
 * (see `shouldShowOsNotification`) so we do not double-signal.
 */
export function shouldPlayInboxNotificationSound(visibilityState: string, muted: boolean): boolean {
  return !muted && visibilityState === "visible";
}

let sharedChime: HTMLAudioElement | null = null;

/** Clears the shared Audio element between Vitest cases. */
export function resetInboxNotificationSoundForTests(): void {
  sharedChime = null;
}

/** Best-effort play of the inbox chime. Callers gate with `shouldPlayInboxNotificationSound`. */
export function playInboxNotificationSound(): void {
  if (typeof Audio === "undefined") return;
  try {
    if (!sharedChime) {
      sharedChime = new Audio(NOTIFICATION_INBOX_CHIME_SRC);
    }
    sharedChime.currentTime = 0;
    void sharedChime.play().catch(() => {
      // Autoplay policies / missing asset — stay silent.
    });
  } catch {
    // Ignore Audio construction failures in odd environments.
  }
}
