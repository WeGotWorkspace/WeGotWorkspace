import { parseApiErrorJson } from "@/lib/api/wgw/http";
import { WgwRequestError } from "@/lib/api/wgw/request-error";

/** A failed `/files/threads` request, with the API error code when the body has one. */
export class DocsThreadsRequestError extends WgwRequestError {}

/** The server no longer knows the `since` state (expired, or from before a reset). */
export function isDocsThreadsCannotCalculateChanges(error: unknown): boolean {
  return error instanceof DocsThreadsRequestError && error.code === "cannotCalculateChanges";
}

export async function docsThreadsRequestError(
  res: Response,
  request: string,
): Promise<DocsThreadsRequestError> {
  const body = await res.text().catch(() => "");
  const code = parseApiErrorJson(body)?.code;
  return new DocsThreadsRequestError(
    `${request} failed (${res.status})`,
    res.status,
    typeof code === "string" ? code : undefined,
  );
}
