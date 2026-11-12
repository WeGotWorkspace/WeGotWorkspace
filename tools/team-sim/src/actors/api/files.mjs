import { createHash, randomBytes } from "node:crypto";
import { ulid } from "../../client/ids.mjs";
import { USING, jmap1, setOk } from "../../client/jmap.mjs";
import { need } from "./collab.mjs";
import { baseName, davUrl, parentOf, projectFolder } from "./paths.mjs";

const PART_BYTES = 24 * 1000 * 1000; // under maxSizeUpload (25 MB) and the 32M shared-host limit
const MIME = { ".pdf": "application/pdf", ".png": "image/png", ".zip": "application/zip", ".md": "text/markdown; charset=utf-8" };
const mimeOf = (name) => MIME[name.slice(name.lastIndexOf("."))] ?? "application/octet-stream";

/** Generated file bytes of the target size with a plausible header. */
export function fileBytes(name, bytes) {
  const head = Buffer.from(name.endsWith(".pdf") ? "%PDF-1.7\n% team-sim generated\n" : name.endsWith(".png") ? "\x89PNG\r\n\x1a\n" : "PK\x03\x04team-sim");
  return Buffer.concat([head, randomBytes(Math.max(0, bytes - head.length))]).subarray(0, bytes);
}

async function davPut(c, origin, path, body, { ifNoneMatch = false, type } = {}) {
  const headers = { "content-type": type ?? mimeOf(path) };
  if (ifNoneMatch) headers["if-none-match"] = "*";
  return c.raw("PUT", davUrl(origin, path), { auth: "basic", body, headers, timeoutMs: 600000 });
}

async function davMust(res, what) {
  if (res.status >= 200 && res.status < 300) return res;
  const e = new Error(`${what} → HTTP ${res.status}: ${res.text.slice(0, 200)}`);
  e.status = res.status;
  throw e;
}

/** Free name in a folder: "x.md", then "x 2.md", "x 3.md" … using If-None-Match on PUT. */
async function putNew(c, origin, folder, name, body) {
  const dot = name.lastIndexOf(".");
  for (let i = 1; i < 20; i += 1) {
    const candidate = i === 1 ? name : `${name.slice(0, dot)} ${i}${name.slice(dot)}`;
    const res = await davPut(c, origin, `${folder}/${candidate}`, body, { ifNoneMatch: true });
    if (res.status === 412) continue;
    await davMust(res, `PUT ${folder}/${candidate}`);
    return `${folder}/${candidate}`;
  }
  throw new Error(`no free name for ${name} in ${folder}`);
}

/** FileNode id of a Drive path ("/groups/studio/Project"), walking from the top-level node. */
export async function resolveNode(c, path) {
  const acct = c.username;
  const parts = path.split("/").filter(Boolean).slice(1); // drop "groups"/"users"
  const top = await jmap1(c, USING.files, "FileNode/query", { accountId: acct, filter: { isTopLevel: true } });
  let candidates = await jmap1(c, USING.files, "FileNode/get", { accountId: acct, ids: top.ids, properties: ["id", "name", "nodeType"] });
  let node = null;
  for (const name of parts) {
    node = candidates.list.find((n) => n.name === name);
    if (!node) throw new Error(`Drive path ${path}: "${name}" not found`);
    if (name === parts[parts.length - 1]) break;
    const q = await jmap1(c, USING.files, "FileNode/query", { accountId: acct, filter: { parentId: node.id } });
    candidates = await jmap1(c, USING.files, "FileNode/get", { accountId: acct, ids: q.ids, properties: ["id", "name", "nodeType"] });
  }
  return node.id;
}

/** Chunked upload: BlobAssembly create → parts → append (within the step budget) → finish → FileNode create. */
export async function chunkedUpload(c, { parentId, name, bytes, stepBudget = 120 * 1024 * 1024 }) {
  const acct = c.username;
  const type = mimeOf(name);
  const created = setOk(await jmap1(c, USING.assembly, "BlobAssembly/set", { accountId: acct, create: { file: { size: bytes, type } } }), "BlobAssembly create");
  const asmId = created.created.file.id;
  const perAppend = Math.max(1, Math.floor(stepBudget / PART_BYTES));
  let pending = [];
  let index = 0;
  const flush = async () => {
    if (!pending.length) return;
    await jmap1(c, USING.assembly, "BlobAssembly/append", { accountId: acct, id: asmId, parts: pending });
    pending = [];
  };
  for (let offset = 0; offset < bytes; offset += PART_BYTES) {
    const part = fileBytes(index === 0 ? name : "x.bin", Math.min(PART_BYTES, bytes - offset));
    const up = await c.must("POST", `/api/v1/jmap/upload/${acct}`, {
      body: part,
      headers: {
        "content-type": "application/octet-stream",
        "wgw-part-length": String(part.length),
        "wgw-part-sha256": createHash("sha256").update(part).digest("hex"),
        "wgw-assembly-id": asmId,
      },
      timeoutMs: 600000,
    });
    pending.push({ index, blobId: up.blobId });
    index += 1;
    if (pending.length >= perAppend) await flush();
  }
  await flush();
  let blobId = null;
  for (let i = 0; i < 200 && !blobId; i += 1) {
    const fin = await jmap1(c, USING.assembly, "BlobAssembly/finish", { accountId: acct, id: asmId });
    blobId = fin.blobId;
    if (!blobId) await new Promise((r) => setTimeout(r, 1000));
  }
  if (!blobId) throw new Error("BlobAssembly/finish never returned a blobId");
  for (let i = 0; i < 60; i += 1) {
    const res = await jmap1(c, USING.files, "FileNode/set", { accountId: acct, create: { up: { parentId, name, blobId } } });
    const err = res.notCreated?.up;
    if (!err) return { nodeId: res.created.up.id, blobId, parts: index };
    if (err.type !== "attachInProgress") setOk(res, "FileNode create");
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("FileNode create stayed attachInProgress");
}

export const fileExecutors = {
  async "doc.create"(a, ctx) {
    const c = ctx.client(a.persona);
    const folder = need(ctx, a.params.folder).ids.path;
    const body = `# ${a.params.title}\n\n${a.params.body}\n`;
    const path = await putNew(c, ctx.origin, folder, `${a.params.title}.md`, body);
    return { ids: { path }, extra: { title: a.params.title } };
  },

  async "doc.edit"(a, ctx) {
    const doc = need(ctx, a.params.doc);
    const c = ctx.client(a.persona);
    const cur = await davMust(await c.raw("GET", davUrl(ctx.origin, doc.ids.path), { auth: "basic" }), `GET ${doc.ids.path}`);
    await davMust(await davPut(c, ctx.origin, doc.ids.path, `${cur.text.trimEnd()}\n\n${a.params.append}\n`), `PUT ${doc.ids.path}`);
    return {};
  },

  async "doc.comment"(a, ctx) {
    const doc = need(ctx, a.params.doc);
    const c = ctx.client(a.persona);
    const cur = await davMust(await c.raw("GET", davUrl(ctx.origin, doc.ids.path), { auth: "basic" }), `GET ${doc.ids.path}`);
    const line = cur.text.split("\n").find((l) => l.trim() && !l.startsWith("#")) ?? cur.text;
    const anchorText = line.trim().split(/\s+/).slice(0, 4).join(" ");
    const id = ulid();
    const thread = await c.post(`/api/v1/files/threads?path=${encodeURIComponent(doc.ids.path)}`, { id, kind: "comment", body: a.params.text, anchorText });
    return { ids: { threadId: thread?.id ?? id, path: doc.ids.path }, extra: { status: "open" } };
  },

  async "doc.resolve"(a, ctx) {
    const t = need(ctx, a.params.comment);
    await ctx.client(a.persona).patch(`/api/v1/files/threads/${t.ids.threadId}?path=${encodeURIComponent(t.ids.path)}`, { resolved: true });
    return { patch: { key: a.params.comment, status: "resolved" } };
  },

  async "drive.upload"(a, ctx) {
    const c = ctx.client(a.persona);
    const folder = need(ctx, a.params.folder).ids.path;
    if (a.params.size === "print") {
      const parentId = await resolveNode(c, folder);
      const up = await chunkedUpload(c, { parentId, name: a.params.name, bytes: a.params.bytes });
      return { ids: { path: `${folder}/${a.params.name}`, nodeId: up.nodeId }, extra: { bytes: a.params.bytes, size: a.params.size }, note: `${up.parts} parts` };
    }
    const path = await putNew(c, ctx.origin, folder, a.params.name, fileBytes(a.params.name, a.params.bytes));
    return { ids: { path }, extra: { bytes: a.params.bytes, size: a.params.size } };
  },

  async "drive.version"(a, ctx) {
    const f = need(ctx, a.params.file);
    await davMust(await davPut(ctx.client(a.persona), ctx.origin, f.ids.path, fileBytes(f.ids.path, a.params.bytes)), `PUT ${f.ids.path}`);
    return { patch: { key: a.params.file, bytes: a.params.bytes, versions: (f.versions ?? 1) + 1 } };
  },

  async "drive.rename"(a, ctx) {
    const f = need(ctx, a.params.file);
    const name = baseName(f.ids.path);
    const dot = name.lastIndexOf(".");
    const next = `${parentOf(f.ids.path)}/${name.slice(0, dot)}${a.params.suffix}${name.slice(dot)}`;
    await davMove(ctx, a.persona, f.ids.path, next);
    return { patch: { key: a.params.file, ids: { ...f.ids, path: next } } };
  },

  async "drive.move"(a, ctx) {
    const f = need(ctx, a.params.file);
    const c = ctx.client(a.persona);
    const sub = `${projectFolder(ctx.world, f.project)}/${a.params.subfolder}`;
    const mk = await c.raw("MKCOL", `${davUrl(ctx.origin, sub)}/`, { auth: "basic" });
    if (![201, 405].includes(mk.status)) throw new Error(`MKCOL ${sub} → HTTP ${mk.status}`);
    const next = `${sub}/${baseName(f.ids.path)}`;
    if (next === f.ids.path) return { note: "already there" };
    await davMove(ctx, a.persona, f.ids.path, next);
    return { patch: { key: a.params.file, ids: { ...f.ids, path: next } } };
  },

  async "drive.delete"(a, ctx) {
    const f = need(ctx, a.params.file);
    const res = await ctx.client(a.persona).raw("DELETE", davUrl(ctx.origin, f.ids.path), { auth: "basic" });
    await davMust(res, `DELETE ${f.ids.path}`);
    return { patch: { key: a.params.file, status: "deleted" } };
  },

  async "drive.share"(a, ctx) {
    const f = need(ctx, a.params.file);
    const res = await ctx.client(a.persona).post("/api/v1/files/shares", { path: f.ids.path, kind: "public", defaultAccess: "view" });
    const share = res.data ?? res;
    return { ids: { shareId: share.id, token: share.publicToken, path: f.ids.path }, extra: { file: a.params.file, bytes: f.bytes } };
  },

  async "drive.guestDownload"(a, ctx) {
    const s = need(ctx, a.params.share);
    const guest = ctx.guestClient();
    const session = await guest.post("/api/v1/files/share-sessions", { token: s.ids.token }, { auth: "none" });
    const auth = { authorization: `Bearer ${session.access_token}` };
    const ticket = await guest.must("POST", "/api/v1/files/download-tickets", { json: { path: session.share?.path ?? s.ids.path }, headers: auth, auth: "none" });
    const url = ticket.url.startsWith("http") ? ticket.url : `${ctx.origin}${ticket.url}`;
    const res = await guest.raw("GET", url, { auth: "none", headers: { accept: "*/*" }, timeoutMs: 600000, countBytes: true });
    if (res.status !== 200) throw new Error(`guest download → HTTP ${res.status}`);
    const file = ctx.registry.get(s.file);
    const got = res.bytes;
    if (file?.bytes && got !== file.bytes) throw new Error(`guest download got ${got} bytes, the file has ${file.bytes}`);
    return { note: `downloaded ${got} bytes` };
  },
};

async function davMove(ctx, persona, from, to) {
  const res = await ctx.client(persona).raw("MOVE", davUrl(ctx.origin, from), { auth: "basic", headers: { destination: davUrl(ctx.origin, to), overwrite: "F" } });
  await davMust(res, `MOVE ${from} → ${to}`);
}
