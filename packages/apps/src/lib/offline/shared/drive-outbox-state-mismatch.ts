import type { OutboxFlushFailure } from "@/lib/offline/core/outbox-flush";

/**
 * A Drive or Docs write the server refused because the file changed meanwhile
 * (409/412). Some Drive REST writes still throw an Error without a status, so
 * the text is the only sign of a 412 there. Drop the regex once they throw a
 * typed error.
 */
export function isDriveOutboxStateMismatch({ status, message }: OutboxFlushFailure): boolean {
  return (
    status === 409 ||
    status === 412 ||
    // eslint-disable-next-line no-restricted-syntax -- reviewed exception (#1642), see above
    /precondition failed/i.test(message)
  );
}
