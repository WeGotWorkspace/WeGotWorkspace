/**
 * The stored member session is still valid, but the server could not renew it right now
 * (5xx from `/auth/refresh`). Not a sign-out: callers retry later.
 */
export class WgwSessionRenewalError extends Error {
  readonly status = 503;

  constructor() {
    super("Could not renew your session right now. Try again in a moment.");
    this.name = "WgwSessionRenewalError";
  }
}
