import * as Y from "yjs";
import { wgwErrorMessageFromBody } from "@/lib/api/wgw/http";
import { SERVER_ORIGIN } from "./docs-collab-utils";

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

export async function loadYjsSnapshot(
  yjsUrl: string,
  target: Y.Doc,
  authToken?: string,
  origin: string = SERVER_ORIGIN,
): Promise<boolean> {
  const res = await fetch(yjsUrl, {
    headers: withBearerAuth({}, authToken),
  });
  if (res.status === 204 || !res.ok) return false;
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length === 0) return false;
  Y.applyUpdate(target, buf, origin);
  return true;
}

export async function saveDocument(
  documentUrl: string,
  markdown: string,
  ydoc: Y.Doc,
  room: string | undefined,
  authToken?: string,
  method: "POST" | "PUT" | "PATCH" = "POST",
): Promise<void> {
  const body: { markdown: string; yjs: number[]; room?: string } = {
    markdown,
    yjs: Array.from(Y.encodeStateAsUpdate(ydoc)),
  };
  if (room) body.room = room;

  const res = await fetch(documentUrl, {
    method,
    headers: withBearerAuth(
      { "Content-Type": "application/json", Accept: "application/json" },
      authToken,
    ),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(wgwErrorMessageFromBody(text, res.status, res.statusText));
  }
}
