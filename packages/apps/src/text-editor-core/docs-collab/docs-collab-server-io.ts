import * as Y from "yjs";
import { wgwErrorMessageFromBody } from "@/lib/api/wgw/http";
import { encodeFramedPayload } from "@/lib/wire/framed-payload";
import type { CollabSidecarPrecondition } from "./docs-collab-etag";
import { CollabHttpError, SERVER_ORIGIN } from "./docs-collab-utils";

const textEncoder = new TextEncoder();

function withBearerAuth(
  headers: Record<string, string>,
  authToken?: string,
): Record<string, string> {
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  return headers;
}

export async function loadMarkdown(documentUrl: string, authToken?: string): Promise<string> {
  const res = await fetch(documentUrl, {
    headers: withBearerAuth({}, authToken),
  });
  if (!res.ok) throw new Error(`Could not load document (${res.status})`);
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
  authToken?: string,
  method: "POST" | "PUT" | "PATCH" = "POST",
  precondition: CollabSidecarPrecondition = null,
): Promise<string | null> {
  const documentBytes = textEncoder.encode(markdown);
  const yjsBytes = Y.encodeStateAsUpdate(ydoc);
  const body = encodeFramedPayload(
    { documentLen: documentBytes.byteLength, yjsLen: yjsBytes.byteLength },
    [documentBytes, yjsBytes],
  );

  const headers = withBearerAuth(
    { "Content-Type": "application/octet-stream", Accept: "application/json" },
    authToken,
  );
  if (precondition) headers[precondition.name] = precondition.value;

  const res = await fetch(documentUrl, {
    method,
    headers,
    body,
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
