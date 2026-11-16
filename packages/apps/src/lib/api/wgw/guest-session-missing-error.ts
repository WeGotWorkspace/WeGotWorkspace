/**
 * A guest (share link) request has no usable share session in this tab: the
 * token is gone or expired, or the stored share path is missing. The guest has
 * to open the link again. No request was sent, so there is no HTTP status.
 *
 * Sets no `name`, so `String(error)` and the message stay the same as when this
 * was a bare `Error`.
 */
export class WgwGuestSessionMissingError extends Error {}
