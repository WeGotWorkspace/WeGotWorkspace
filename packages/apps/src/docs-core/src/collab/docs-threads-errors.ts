import { WgwRequestError } from "@/lib/api/wgw/request-error";
import { wgwFeedRequestError, type WgwRequestErrorFactory } from "@/lib/live/wgw-feed-request";

/** A failed `/files/threads` request, with the API error code when the body has one. */
export class DocsThreadsRequestError extends WgwRequestError {}

export const docsThreadsErrorFactory: WgwRequestErrorFactory<DocsThreadsRequestError> = (
  message,
  status,
  code,
) => new DocsThreadsRequestError(message, status, code);

/** The server no longer knows the `since` state (expired, or from before a reset). */
export function isDocsThreadsCannotCalculateChanges(error: unknown): boolean {
  return error instanceof DocsThreadsRequestError && error.code === "cannotCalculateChanges";
}

export function docsThreadsRequestError(
  res: Response,
  request: string,
): Promise<DocsThreadsRequestError> {
  return wgwFeedRequestError(res, request, docsThreadsErrorFactory);
}
