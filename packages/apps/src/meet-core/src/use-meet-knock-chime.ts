import { useEffect, useRef } from "react";
import { useAppToast } from "@/hooks/use-app-toast";
import { playMeetKnockSound, primeMeetKnockSound } from "@/meet-core/src/meet-chat-utils";
import { meetLabels } from "@/meet-core/src/meet-labels";

/**
 * Chime when a knocker id appears that this peer has not already heard, and
 * only while `enabled` (in the call and allowed to admit). Leaving the call
 * forgets the ids so the next call chimes again.
 */
export function useMeetKnockChime(knockerIds: readonly string[], enabled: boolean): void {
  const { show } = useAppToast();
  const seenRef = useRef(new Set<string>());
  const idsKey = knockerIds.join("\u0000");

  useEffect(() => {
    const unlock = () => {
      primeMeetKnockSound();
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      seenRef.current = new Set();
      return;
    }
    const ids = idsKey === "" ? [] : idsKey.split("\u0000");
    const hasNewKnocker = ids.some((id) => !seenRef.current.has(id));
    seenRef.current = new Set(ids);
    if (!hasNewKnocker) return;
    playMeetKnockSound();
    show(meetLabels.someoneKnocking, { severity: "info" });
  }, [enabled, idsKey, show]);
}
