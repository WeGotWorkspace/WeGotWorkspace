import { wgwCurrentAccessToken } from "@/lib/api/wgw/http";
import { decodeJwtPayload } from "@/lib/api/wgw/jwt-exp";

/**
 * Account that last posted this browser's push subscription. It is not under
 * `wgw.offline.`, so the sign-out wipe keeps it: the next account to sign in
 * needs it to tell that the subscription is not its own.
 */
const PUSH_SUBSCRIBER_KEY = "wgw.push.subscriber";

/**
 * Username in the current access token, lowercased like the server's
 * `principal`, or null without a member session.
 */
export function currentPushAccount(): string | null {
  const token = wgwCurrentAccessToken();
  if (!token) return null;
  const sub = decodeJwtPayload(token)?.sub;
  return typeof sub === "string" && sub.trim() ? normalizeAccount(sub) : null;
}

/**
 * True only when another account is recorded for this browser's subscription.
 * No record (first run, cleared storage) or no signed-in account is unknown,
 * so the subscription stays.
 */
export function isPushSubscribedByOtherAccount(account: string | null): boolean {
  if (!account) return false;
  const recorded = readPushSubscriber();
  return recorded !== null && recorded !== account;
}

export function recordPushSubscriber(account: string | null): void {
  if (!account) return;
  try {
    window.localStorage.setItem(PUSH_SUBSCRIBER_KEY, account);
  } catch {
    // Storage unavailable: the next run treats the subscription as unknown.
  }
}

function readPushSubscriber(): string | null {
  try {
    const value = window.localStorage.getItem(PUSH_SUBSCRIBER_KEY);
    return value?.trim() ? normalizeAccount(value) : null;
  } catch {
    return null;
  }
}

function normalizeAccount(username: string): string {
  return username.trim().toLowerCase();
}
