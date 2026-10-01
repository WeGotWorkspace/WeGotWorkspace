import { useEffect, useRef } from "react";
import { useAppToast } from "@/hooks/use-app-toast";
import { playMeetKnockSound, primeMeetKnockSound } from "@/meet-core/src/meet-chat-utils";
import { meetLabels } from "@/meet-core/src/meet-labels";

/**
 * Chime when someone new is waiting to join and this peer is already in the
 * call. The person still knocking does not hear their own request.
 */
export function useMeetKnockChime(knockerCount: number, inCall: boolean): void {
  const { show } = useAppToast();
  const previousCountRef = useRef(0);

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
    if (!inCall) return;
    if (knockerCount > previousCountRef.current) {
      playMeetKnockSound();
      show(meetLabels.someoneKnocking, { severity: "info" });
    }
    previousCountRef.current = knockerCount;
  }, [inCall, knockerCount, show]);
}
