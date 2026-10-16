import { JmapSetItemError } from "@/lib/jmap-client";

/**
 * HTTP status for a flush failure. A JMAP `/set` rejection has no HTTP status:
 * `notFound` is 404 and `forbidden` is 403. Other set types stay unset.
 * Request errors keep their `.status`.
 */
export function httpStatusFromFlushError(error: unknown): number | undefined {
  if (error instanceof JmapSetItemError) {
    if (error.setError.type === "notFound") return 404;
    if (error.setError.type === "forbidden") return 403;
    return undefined;
  }
  return (error as { status?: number } | undefined)?.status;
}
