import { ApiError } from "@/lib/api/api-error";

/**
 * The stored member session is still valid, but the server could not renew it right now
 * (5xx from `/auth/refresh`). Not a sign-out: callers retry later.
 */
export class WgwSessionRenewalError extends ApiError {
  constructor() {
    super("Could not renew your session right now. Try again in a moment.", 503);
    this.name = "WgwSessionRenewalError";
  }
}
