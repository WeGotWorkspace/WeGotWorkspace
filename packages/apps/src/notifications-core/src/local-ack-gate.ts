/**
 * A local-ack tells the server that someone saw the notification here, so the
 * VAPID sweep skips push on every device. Only a window the user is looking at
 * may say that, or a window that holds the user's live Meet call (the user is
 * busy there even when they switch to another app).
 */
export function canLocalAck(visibilityState: string, inMeetCall: boolean): boolean {
  return visibilityState === "visible" || inMeetCall;
}
