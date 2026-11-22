import { parseApiErrorJson, wgwFetch, wgwReadJson } from "@/lib/api/wgw/http";
import { WgwRequestError } from "@/lib/api/wgw/request-error";
import type { PushPulledChangesPage } from "./use-push-pulled-list";

/**
 * The request side of a push-pulled list (#2298): a list feed and its
 * `/changes` feed on the WGW API. Apps pass their URLs and, when they classify
 * failures by their own error class, its constructor.
 */

export type WgwRequestErrorFactory<E extends WgwRequestError = WgwRequestError> = (
  message: string,
  status: number,
  code: string | undefined,
) => E;

const defaultFactory: WgwRequestErrorFactory = (message, status, code) =>
  new WgwRequestError(message, status, code);

/** A failed request, with the API error code when the body has one. */
export async function wgwFeedRequestError<E extends WgwRequestError = WgwRequestError>(
  res: Response,
  request: string,
  make: WgwRequestErrorFactory<E> = defaultFactory as WgwRequestErrorFactory<E>,
): Promise<E> {
  const body = await res.text().catch(() => "");
  const code = parseApiErrorJson(body)?.code;
  return make(
    `${request} failed (${res.status})`,
    res.status,
    typeof code === "string" ? code : undefined,
  );
}

/** `GET url`, answered `{ list: T[] }`; a missing list reads as empty. */
export async function readWgwListFeed<T>(
  url: string,
  request: string,
  make?: WgwRequestErrorFactory,
): Promise<T[]> {
  const res = await wgwFetch(url);
  if (!res.ok) throw await wgwFeedRequestError(res, request, make);
  const payload = (await wgwReadJson(res)) as { list?: T[] };
  return Array.isArray(payload.list) ? payload.list : [];
}

/** One `/changes` page: `url` plus `since` when there is one. */
export async function readWgwChangesPage<P extends PushPulledChangesPage>(
  url: string,
  since: string | null | undefined,
  request: string,
  make?: WgwRequestErrorFactory,
): Promise<P> {
  const separator = url.includes("?") ? "&" : "?";
  const extra = since ? `${separator}since=${encodeURIComponent(since)}` : "";
  const res = await wgwFetch(`${url}${extra}`);
  if (!res.ok) throw await wgwFeedRequestError(res, request, make);
  return (await wgwReadJson(res)) as P;
}
