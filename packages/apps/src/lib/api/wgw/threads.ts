import { wgwFetch, wgwReadJson } from "@/lib/api/wgw/http";
import {
  ThreadRequestError,
  type ThreadChanges,
  type ThreadClient,
  type ThreadEntry,
  type ThreadPage,
  type ThreadSubjectRef,
} from "@/lib/models/thread-types";

/** The shared thread API (#2173): `/api/v1/threads/{subjectType}/{subjectId}`. */
function base(subject: ThreadSubjectRef): string {
  return `/threads/${encodeURIComponent(subject.type)}/${encodeURIComponent(subject.id)}`;
}

async function request(
  path: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const headers = new Headers();
  if (body !== undefined) headers.set("Content-Type", "application/json");
  const res = await wgwFetch(path, {
    method,
    signal,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    let code: string | undefined;
    try {
      const json = (await res.json()) as { code?: unknown };
      if (typeof json.code === "string") code = json.code;
    } catch {
      // The status alone is enough when the body is not JSON.
    }
    throw new ThreadRequestError(`${method} ${path} failed (${res.status})`, res.status, code);
  }
  return wgwReadJson(res);
}

export const liveThreadClient: ThreadClient = {
  async list(subject, cursor, signal) {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    return (await request(
      `${base(subject)}/entries${query}`,
      "GET",
      undefined,
      signal,
    )) as ThreadPage;
  },
  async post(subject, post) {
    return (await request(`${base(subject)}/entries`, "POST", post)) as ThreadEntry;
  },
  async edit(subject, entryId, body) {
    return (await request(`${base(subject)}/entries/${encodeURIComponent(entryId)}`, "PATCH", {
      body,
    })) as ThreadEntry;
  },
  async remove(subject, entryId) {
    return (await request(
      `${base(subject)}/entries/${encodeURIComponent(entryId)}`,
      "DELETE",
    )) as ThreadEntry;
  },
  async react(subject, entryId, emoji) {
    return (await request(
      `${base(subject)}/entries/${encodeURIComponent(entryId)}/reactions`,
      "POST",
      { emoji },
    )) as ThreadEntry;
  },
  async changes(subject, since, signal) {
    return (await request(
      `${base(subject)}/changes?since=${encodeURIComponent(since)}`,
      "GET",
      undefined,
      signal,
    )) as ThreadChanges;
  },
};
