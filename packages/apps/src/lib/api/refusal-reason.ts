import { isApiError } from "@/lib/api/api-error";
import { JmapSetItemError } from "@/lib/jmap-client";

/**
 * The server's reason when it refused a request for who the caller is (HTTP 403, or a
 * JMAP `forbidden` set error), for example "Only a team admin can add a collection to a
 * team." `null` for any other failure: the caller keeps its generic message.
 */
export function serverRefusalReason(error: unknown): string | null {
  if (error instanceof JmapSetItemError) {
    return error.setError.type === "forbidden" ? clean(error.setError.description) : null;
  }
  if (isApiError(error) && error.status === 403) return clean(error.detail);
  return null;
}

/** `Could not save calendar` + the reason, when the server gave one. */
export function withRefusalReason(base: string, error: unknown): string {
  const reason = serverRefusalReason(error);
  return reason ? `${base.replace(/[.\s]+$/, "")}. ${reason}` : base;
}

function clean(text: string | null | undefined): string | null {
  const trimmed = text?.trim();
  return trimmed ? trimmed : null;
}
