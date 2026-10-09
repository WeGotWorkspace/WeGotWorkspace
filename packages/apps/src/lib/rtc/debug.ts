import { readRtcTestOverrides } from "@/lib/rtc/test-overrides";

let serverDebug = false;

/** Set from the room configuration (`rtc.debug`). Admin → Real-time collaboration. */
export function setRtcDebugEnabled(enabled: boolean): void {
  serverDebug = enabled;
}

/** RTC console logging: the admin switch, or a test override. */
export function isRtcDebugEnabled(): boolean {
  return serverDebug || readRtcTestOverrides().debug;
}
