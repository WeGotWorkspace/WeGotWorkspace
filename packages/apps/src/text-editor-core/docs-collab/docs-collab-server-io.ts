import * as Y from "yjs";
import { wgwErrorMessageFromBody } from "@/lib/api/wgw/http";
import type { CollabSidecarPrecondition } from "./docs-collab-etag";
import { noteTitleForSave } from "./docs-collab-document-title";
import { CollabHttpError, SERVER_ORIGIN } from "./docs-collab-utils";

function withBearerAuth(
  headers: Record<string, string>,
  authToken?: string,
): Record<string, string> {
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  return headers;
}

export async function loadMarkdown(documentUrl: string, authToken?: string): Promise<string> {
  const res = await fetch(documentUrl, {
    headers: withBearerAuth({ Accept: "text/markdown, application/json" }, authToken),
  });
  if (!res.ok) throw new CollabHttpError(`Could not load document (${res.status})`, res.status);
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const data = (await res.json()) as { body?: unknown; markdown?: unknown };
    if (typeof data.markdown === "string") return data.markdown;
    if (typeof data.body === "string") return data.body;
    throw new CollabHttpError("Could not load document (unexpected JSON)", res.status);
  }
  return res.text();
}

/** `update: null` means the server has no sidecar — nothing else does. */
export type YjsSnapshot = {
  update: Uint8Array | null;
  etag: string | null;
};

export type YjsSnapshotLoad = {
  applied: boolean;
  etag: string | null;
};

/**
 * Contract C7: a 204 means "no sidecar". Every other non-2xx is an error and
 * must never be reported as "no snapshot" — a caller that seeds on a token race
 * or a 5xx writes a second copy of the document.
 */
export async function fetchYjsSnapshot(yjsUrl: string, authToken?: string): Promise<YjsSnapshot> {
  const res = await fetch(yjsUrl, {
    headers: withBearerAuth({}, authToken),
  });
  if (res.status === 204) return { update: null, etag: null };
  if (!res.ok) {
    throw new CollabHttpError(`Could not load snapshot (${res.status})`, res.status);
  }

  const update = new Uint8Array(await res.arrayBuffer());
  if (update.length === 0) return { update: null, etag: null };
  return { update, etag: res.headers.get("ETag") };
}

export async function loadYjsSnapshot(
  yjsUrl: string,
  target: Y.Doc,
  authToken?: string,
  origin: string = SERVER_ORIGIN,
): Promise<YjsSnapshotLoad> {
  const snapshot = await fetchYjsSnapshot(yjsUrl, authToken);
  if (!snapshot.update) return { applied: false, etag: snapshot.etag };
  Y.applyUpdate(target, snapshot.update, origin);
  return { applied: true, etag: snapshot.etag };
}

/** Returns the ETag the server assigned to the save, when it reported one. */
export async function saveDocument(
  documentUrl: string,
  markdown: string,
  ydoc: Y.Doc,
  room: string | undefined,
  authToken?: string,
  precondition: CollabSidecarPrecondition = null,
): Promise<string | null> {
  const body: { markdown: string; yjs: number[]; room?: string; title?: string } = {
    markdown,
    yjs: Array.from(Y.encodeStateAsUpdate(ydoc)),
  };
  if (room) body.room = room;
  // A document that adopted a title shared type sends it. Docs never creates that type.
  const title = noteTitleForSave(ydoc);
  if (title !== undefined) body.title = title;

  const headers = withBearerAuth(
    { "Content-Type": "application/json", Accept: "application/json" },
    authToken,
  );
  if (precondition) headers[precondition.name] = precondition.value;

  const res = await fetch(documentUrl, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new CollabHttpError(
      wgwErrorMessageFromBody(text, res.status, res.statusText),
      res.status,
    );
  }

  return res.headers.get("ETag");
}
