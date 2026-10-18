import { JmapSetItemError } from "@/lib/jmap-client";

/**
 * HTTP status for a flush failure. Request errors keep their `.status`.
 * A JMAP `/set` `forbidden` is 403; Calendar and Contacts reach that in the
 * catch-all. `notFound` maps to 404 as defensive coverage. Other set types
 * stay unset.
 */
export function httpStatusFromFlushError(error: unknown): number | undefined {
  if (error instanceof JmapSetItemError) {
    if (error.setError.type === "notFound") return 404;
    if (error.setError.type === "forbidden") return 403;
    return undefined;
  }
  return (error as { status?: number } | undefined)?.status;
}
