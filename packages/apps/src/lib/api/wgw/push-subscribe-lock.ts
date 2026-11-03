/**
 * Web Lock for every change to this browser's push subscription from a page:
 * subscribe runs and the release on logout. Holding it on logout means a
 * subscribe run that already started cannot post the row again after logout
 * deleted it (#1606).
 */
export const PUSH_SUBSCRIBE_LOCK = "wgw-push-subscribe";
