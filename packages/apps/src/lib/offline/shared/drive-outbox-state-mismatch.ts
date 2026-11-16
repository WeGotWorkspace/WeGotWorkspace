import type { OutboxFlushFailure } from "@/lib/offline/core/outbox-flush";

/**
 * A Drive or Docs write the server refused because the file changed meanwhile
 * (409/412). Every write the Drive and Docs flushes call carries an HTTP status
 * (#1646), so the status alone decides.
 */
export function isDriveOutboxStateMismatch({ status }: OutboxFlushFailure): boolean {
  return status === 409 || status === 412;
}
