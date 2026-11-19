import * as Y from "yjs";
import { wgwErrorMessageFromBody } from "@/lib/api/wgw/http";
import { parseRetryAfterMs } from "@/lib/offline/core/background-sync-pacer";
import { encodeFramedPayload } from "@/lib/wire/framed-payload";
import type { CollabSidecarPrecondition } from "./docs-collab-etag";
import { noteTitleForSave } from "./docs-collab-document-title";
import { CollabHttpError, SERVER_ORIGIN } from "./docs-collab-utils";

const textEncoder = new TextEncoder();

/** Set on `GET ?format=yjs` when the stored state is not an ancestor of the journal. */
export const EXTERNAL_WRITE_HEADER = "X-Wgw-External-Write";

export function externalWriteFromHeader(headers: Headers): boolean {
  return headers.get(EXTERNAL_WRITE_HEADER) === "1";
}

function withBearerAuth(
  headers: Record<string, string>,
  authToken?: string,
): Record<string, string> {
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  return headers;
}

export type CollabText = {
  markdown: string;
  /** Set when the JSON note carries a title. A markdown file leaves it null. */
  title: string | null;
  /** Entity tag of this text representation. A save names it after an outside write. */
  etag?: string | null;
  /** The object version, from a text-fields resource; a replacement seed is salted with it. */
  objectEtag?: string;
};

export async function loadCollabText(documentUrl: string, authToken?: string): Promise<CollabText> {
  const res = await fetch(documentUrl, {
    headers: withBearerAuth({ Accept: "text/markdown, application/json" }, authToken),
  });
  if (!res.ok) {
    throw new CollabHttpError(
      `Could not load document (${res.status})`,
      res.status,
      parseRetryAfterMs(res.headers.get("Retry-After")),
    );
  }
  const contentType = res.headers.get("content-type") ?? "";
  let etag = res.headers.get("ETag");
  if (contentType.includes("application/json")) {
    const data = (await res.json()) as {
      body?: unknown;
      markdown?: unknown;
      title?: unknown;
      description?: unknown;
      contentEtag?: unknown;
      objectEtag?: unknown;
    };
    const title = typeof data.title === "string" ? data.title : null;
    // A text-fields resource (a task's text) also names the object version a
    // replacement seed is salted with (#2208).
    const objectEtag = typeof data.objectEtag === "string" ? data.objectEtag : undefined;
    // A JSON representation whose own tag also moves with metadata names its text separately.
    if (typeof data.contentEtag === "string") etag = data.contentEtag;
    if (typeof data.markdown === "string")
      return { markdown: data.markdown, title, etag, objectEtag };
    if (typeof data.body === "string") return { markdown: data.body, title, etag, objectEtag };
    if (typeof data.description === "string") {
      return { markdown: data.description, title, etag, objectEtag };
    }
    throw new CollabHttpError("Could not load document (unexpected JSON)", res.status);
  }
  return { markdown: await res.text(), title: null, etag };
}

export async function loadMarkdown(documentUrl: string, authToken?: string): Promise<string> {
  const loaded = await loadCollabText(documentUrl, authToken);
  return loaded.markdown;
}

/**
 * `update: null` means the server has no sidecar — nothing else does.
 * `externalWrite` means those bytes are not an ancestor of the current text.
 */
export type YjsSnapshot = {
  update: Uint8Array | null;
  etag: string | null;
  externalWrite?: boolean;
  /**
   * The content tag of the text the stored state was written from
   * (`X-Wgw-Content-Tag`, Notes and Tasks). The client checks the state
   * against the text only when the text it read has this tag (#2208).
   */
  contentTag?: string | null;
  /**
   * Set only for a `&fallback=markdown` request when there is no sidecar: the
   * server sent the markdown in the same response.
   */
  markdown?: string;
};

/** Response header that marks a `&fallback=markdown` body as markdown, not sidecar bytes. */
export const COLLAB_FALLBACK_HEADER = "X-Wgw-Collab-Fallback";
/** Content tag of the text a stored state was written from (#2208). */
export const COLLAB_CONTENT_TAG_HEADER = "X-Wgw-Content-Tag";

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
  if (res.status === 204) return { update: null, etag: null, externalWrite: false };
  if (!res.ok) {
    throw new CollabHttpError(
      `Could not load snapshot (${res.status})`,
      res.status,
      parseRetryAfterMs(res.headers.get("Retry-After")),
    );
  }

  if (res.headers.get(COLLAB_FALLBACK_HEADER) === "markdown") {
    return { update: null, etag: null, externalWrite: false, markdown: await res.text() };
  }

  const update = new Uint8Array(await res.arrayBuffer());
  if (update.length === 0) return { update: null, etag: null, externalWrite: false };
  return {
    update,
    etag: res.headers.get("ETag"),
    externalWrite: externalWriteFromHeader(res.headers),
    contentTag: res.headers.get(COLLAB_CONTENT_TAG_HEADER),
  };
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

/**
 * Returns the ETag the server assigned to the save, when it reported one.
 * `externalWriteSeen` is the entity tag of the outside text this client
 * showed; without it a save over an outside edit is refused with 409.
 */
export async function saveDocument(
  documentUrl: string,
  markdown: string,
  ydoc: Y.Doc,
  authToken?: string,
  precondition: CollabSidecarPrecondition = null,
  externalWriteSeen: string | null = null,
): Promise<string | null> {
  const documentBytes = textEncoder.encode(markdown);
  const yjsBytes = Y.encodeStateAsUpdate(ydoc);
  // A document that adopted a title shared type sends it. Docs never creates that type.
  const title = noteTitleForSave(ydoc);
  const body = encodeFramedPayload(
    {
      documentLen: documentBytes.byteLength,
      yjsLen: yjsBytes.byteLength,
      ...(title !== undefined ? { title } : {}),
    },
    [documentBytes, yjsBytes],
  );

  const headers = withBearerAuth(
    { "Content-Type": "application/octet-stream", Accept: "application/json" },
    authToken,
  );
  if (precondition) headers[precondition.name] = precondition.value;
  if (externalWriteSeen) headers[EXTERNAL_WRITE_HEADER] = externalWriteSeen;

  const res = await fetch(documentUrl, {
    method: "PUT",
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
