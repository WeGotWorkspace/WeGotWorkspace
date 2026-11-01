import { createHash } from "node:crypto";
import type { DriveJmapSession } from "@/lib/api/wgw/drive-jmap";
import type { DriveUploadCapabilities } from "@/lib/api/wgw/drive-upload-capabilities";
import {
  BLOB_ASSEMBLY_CAPABILITY,
  BLOB_CAPABILITY,
  JmapMethodError,
  JmapRequestError,
  JmapSetItemError,
  type JmapFileNode,
} from "@/lib/jmap-client";

/**
 * A small in-memory stand-in for the #1500 server: `/jmap/upload` with
 * declared length and sha256, `Blob/upload`, the blob assembly extension,
 * and FileNode query/get/set with the version check. Each knob reproduces a
 * host behaviour the chunked uploader has to survive.
 */
export class FakeDriveServer {
  maxSizeUpload = 1_000;
  /** Bodies above this get a 413 from the "front controller" (a proxy limit). */
  hostLimit = Infinity;
  /** Bodies above this get the RFC 8620 `limit` problem. */
  limitProblemAbove = Infinity;
  /** Bodies above this are stored empty (PHP discarded them): a part mismatch. */
  discardAbove = Infinity;
  /** Every upload and assembly step answers 507. */
  full = false;
  stepBudgetBytes = 600;
  /** An append with more parts than this answers `requestTooLarge`. */
  maxPartsPerStep = Infinity;
  /** The next append calls spend their budget on a hash rebuild only. */
  rebuildOnlyAppends = 0;
  /** The next append calls fail on the network after the server applied them. */
  appendLostResponses = 0;
  maxDataSources = 64;
  /** Blob/upload answers `requestTooLarge`. */
  blobUploadTooLarge = false;
  versionCheck = true;
  assemblyExtension = true;
  blobCapability = true;

  readonly blobs = new Map<string, Uint8Array>();
  readonly uploads: Array<{ length: number; declaredLength?: string; sha256?: string }> = [];
  readonly calls: Array<{ name: string; args: Record<string, unknown>; using: string[] }> = [];
  readonly assemblies = new Map<
    string,
    {
      size: number;
      chunks: Uint8Array[];
      received: number;
      nextIndex: number;
      parts: string[];
      blobId: string | null;
    }
  >();
  nodes: Array<{
    id: string;
    parentId: string;
    name: string;
    blobId: string;
    contentHashPending?: boolean;
  }> = [];
  private sequence = 0;
  private activeUploads = 0;
  maxActiveUploads = 0;

  capabilities(): DriveUploadCapabilities {
    return {
      blob: this.blobCapability
        ? { maxDataSources: this.maxDataSources, maxSizeBlobSet: null }
        : null,
      assembly: this.assemblyExtension
        ? { stepBudgetBytes: this.stepBudgetBytes, maxSizeAssembly: null, assemblyTtlSeconds: 3600 }
        : null,
      versionCheck: this.versionCheck,
    };
  }

  blobIdOf(bytes: Uint8Array): string {
    return `jb-${createHash("sha256").update(bytes).digest("hex").slice(0, 40)}`;
  }

  /** Drop stored parts, as if their TTL ran out. */
  expire(blobIds: readonly string[]): void {
    for (const blobId of blobIds) this.blobs.delete(blobId);
  }

  bytesOf(blobId: string): Uint8Array | undefined {
    return this.blobs.get(blobId);
  }

  /** `wgwFetch` stand-in: only `/jmap/upload/…` is served. */
  async fetch(path: string, init?: RequestInit): Promise<Response> {
    if (!String(path).startsWith("/jmap/upload/"))
      return new Response("unexpected", { status: 500 });
    this.activeUploads += 1;
    this.maxActiveUploads = Math.max(this.maxActiveUploads, this.activeUploads);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return await this.upload(init ?? {});
    } finally {
      this.activeUploads -= 1;
    }
  }

  private async upload(init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    const body = new Uint8Array(await (init.body as Blob).arrayBuffer());
    const declaredLength = headers.get("Wgw-Part-Length") ?? undefined;
    const sha256 = headers.get("Wgw-Part-Sha256") ?? undefined;
    this.uploads.push({
      length: body.length,
      ...(declaredLength ? { declaredLength } : {}),
      ...(sha256 ? { sha256 } : {}),
    });
    if (body.length > this.hostLimit)
      return json({ error: "too large", code: "post_too_large" }, 413);
    if (this.full)
      return problem("https://wegotworkspace.org/jmap/problem/insufficient-storage", 507);
    if (body.length > this.maxSizeUpload || body.length > this.limitProblemAbove) {
      return problem("urn:ietf:params:jmap:error:limit", 400);
    }
    const stored = body.length > this.discardAbove ? new Uint8Array() : body;
    const storedSha = createHash("sha256").update(stored).digest("hex");
    if (
      (declaredLength !== undefined && Number(declaredLength) !== stored.length) ||
      (sha256 !== undefined && sha256 !== storedSha)
    ) {
      return problem("https://wegotworkspace.org/jmap/problem/part-mismatch", 400);
    }
    const blobId = this.blobIdOf(stored);
    this.blobs.set(blobId, stored);
    return json({ accountId: "ada", blobId, size: stored.length, type: "x" }, 201);
  }

  /** `JmapClient.call` stand-in for the blob and assembly methods. */
  async call(
    name: string,
    args: Record<string, unknown>,
    options?: { using?: string[] },
  ): Promise<unknown> {
    this.calls.push({ name, args, using: options?.using ?? [] });
    switch (name) {
      case "Blob/upload":
        return this.blobUpload(args);
      case "BlobAssembly/set":
        return this.assemblySet(args);
      case "BlobAssembly/append":
        return this.assemblyAppend(args);
      case "BlobAssembly/finish":
        return this.assemblyFinish(args);
      case "BlobAssembly/get": {
        const id = (args.ids as string[])[0]!;
        const row = this.assemblies.get(id);
        if (!row) return { list: [], notFound: [id] };
        return {
          list: [
            {
              id,
              received: row.received,
              nextIndex: row.nextIndex,
              acceptedParts: row.parts.map((_, index) => index),
              status: row.blobId ? "finished" : "open",
              blobId: row.blobId,
            },
          ],
        };
      }
      default:
        throw new Error(`unexpected method ${name}`);
    }
  }

  private blobUpload(args: Record<string, unknown>) {
    const create = (args.create as Record<string, { data: Array<{ blobId: string }> }>).file!;
    if (this.blobUploadTooLarge) {
      throw new JmapMethodError("Blob/upload", "c1", { type: "requestTooLarge" });
    }
    if (create.data.length > this.maxDataSources) {
      return { notCreated: { file: { type: "tooLarge" } } };
    }
    const missing = create.data.map((d) => d.blobId).filter((id) => !this.blobs.has(id));
    if (missing.length) {
      return { notCreated: { file: { type: "blobNotFound", notFound: [...new Set(missing)] } } };
    }
    const joined = concat(create.data.map((d) => this.blobs.get(d.blobId)!));
    const id = this.blobIdOf(joined);
    this.blobs.set(id, joined);
    return { created: { file: { id, size: joined.length } } };
  }

  private assemblySet(args: Record<string, unknown>) {
    const create = (args.create as Record<string, { size: number }>).file!;
    this.sequence += 1;
    const id = `ba-${this.sequence}`;
    this.assemblies.set(id, {
      size: create.size,
      chunks: [],
      received: 0,
      nextIndex: 0,
      parts: [],
      blobId: null,
    });
    return { created: { file: { id, size: create.size } } };
  }

  private assemblyAppend(args: Record<string, unknown>) {
    if (this.full) throw new JmapRequestError("JMAP request failed (507)", { status: 507 });
    const row = this.assemblies.get(String(args.id));
    if (!row) throw new JmapMethodError("BlobAssembly/append", "c1", { type: "invalidArguments" });
    const parts = args.parts as Array<{ index: number; blobId: string }>;
    if (parts.length > this.maxPartsPerStep) {
      throw new JmapMethodError("BlobAssembly/append", "c1", { type: "requestTooLarge" });
    }
    const accepted: number[] = [];
    const fresh = parts.filter((part) => {
      if (part.index < row.nextIndex) {
        if (row.parts[part.index] !== part.blobId) {
          throw new JmapMethodError("BlobAssembly/append", "c1", { type: "invalidArguments" });
        }
        accepted.push(part.index);
        return false;
      }
      return true;
    });
    if (fresh[0] && fresh[0].index !== row.nextIndex) {
      throw new JmapMethodError("BlobAssembly/append", "c1", { type: "invalidArguments" });
    }
    const missing = fresh.map((p) => p.blobId).filter((id) => !this.blobs.has(id));
    if (missing.length) {
      throw new JmapMethodError("BlobAssembly/append", "c1", {
        type: "blobNotFound",
        notFound: [...new Set(missing)],
      });
    }
    const total = fresh.reduce((sum, p) => sum + this.blobs.get(p.blobId)!.length, 0);
    if (total > this.stepBudgetBytes) {
      throw new JmapMethodError("BlobAssembly/append", "c1", { type: "requestTooLarge" });
    }
    if (this.rebuildOnlyAppends > 0) {
      this.rebuildOnlyAppends -= 1;
      return { accepted, rebuiltOnly: true, received: row.received, nextIndex: row.nextIndex };
    }
    for (const part of fresh) {
      const partBytes = this.blobs.get(part.blobId)!;
      row.chunks.push(partBytes);
      row.received += partBytes.length;
      row.parts[part.index] = part.blobId;
      row.nextIndex = part.index + 1;
      accepted.push(part.index);
      if (!fresh.slice(fresh.indexOf(part) + 1).some((later) => later.blobId === part.blobId)) {
        this.blobs.delete(part.blobId);
      }
    }
    if (this.appendLostResponses > 0) {
      this.appendLostResponses -= 1;
      throw new TypeError("Failed to fetch");
    }
    return { accepted, rebuiltOnly: false, received: row.received, nextIndex: row.nextIndex };
  }

  private assemblyFinish(args: Record<string, unknown>) {
    const row = this.assemblies.get(String(args.id));
    if (!row) throw new JmapMethodError("BlobAssembly/finish", "c1", { type: "invalidArguments" });
    if (row.received !== row.size) {
      throw new JmapMethodError("BlobAssembly/finish", "c1", { type: "invalidArguments" });
    }
    const bytes = concat(row.chunks);
    row.blobId = this.blobIdOf(bytes);
    this.blobs.set(row.blobId, bytes);
    return { blobId: row.blobId, hashRebuildPending: false };
  }

  // FileNode ---------------------------------------------------------------

  private toNode(row: (typeof this.nodes)[number]): JmapFileNode {
    return {
      id: row.id,
      parentId: row.parentId,
      name: row.name,
      nodeType: "file",
      blobId: row.blobId,
      size: this.blobs.get(row.blobId)?.length ?? 0,
      type: "application/octet-stream",
      modified: "2099-01-01T00:00:00Z",
      ...(row.contentHashPending ? { contentHashPending: true } : {}),
    } as JmapFileNode;
  }

  readonly fileNodeSets: Array<Record<string, unknown>> = [];

  fileNodes = {
    queryAndGetFileNodes: async (
      _account: string,
      filter: { parentId: string; name?: string },
    ) => ({
      list: this.nodes
        .filter((row) => row.parentId === filter.parentId)
        .filter((row) => filter.name === undefined || row.name === filter.name)
        .map((row) => this.toNode(row)),
    }),
    getFileNodes: async (_account: string, ids: string[]) => ({
      list: this.nodes.filter((row) => ids.includes(row.id)).map((row) => this.toNode(row)),
    }),
    setFileNodes: async (args: Record<string, unknown>) => {
      this.fileNodeSets.push(args);
      if (args.create) {
        const create = (
          args.create as Record<string, { parentId: string; name: string; blobId: string }>
        ).upload!;
        if (
          this.nodes.some((row) => row.parentId === create.parentId && row.name === create.name)
        ) {
          throw new JmapSetItemError("create", "upload", { type: "alreadyExists" });
        }
        this.sequence += 1;
        const id = `fn-${this.sequence}`;
        this.nodes.push({
          id,
          parentId: create.parentId,
          name: create.name,
          blobId: create.blobId,
        });
        return { created: { upload: { id } } };
      }
      const [id, patch] = Object.entries(args.update as Record<string, Record<string, string>>)[0]!;
      const row = this.nodes.find((node) => node.id === id);
      if (!row) throw new JmapSetItemError("update", id, { type: "notFound" });
      if ("expectedBlobId" in patch) {
        if (!this.versionCheck) {
          throw new JmapSetItemError("update", id, {
            type: "invalidProperties",
            properties: ["expectedBlobId"],
          });
        }
        if (row.contentHashPending || patch.expectedBlobId !== row.blobId) {
          throw new JmapSetItemError("update", id, {
            type: "versionMismatch",
            existingId: id,
            existingBlobId: row.blobId,
          });
        }
      }
      row.blobId = patch.blobId!;
      return { updated: { [id]: null } };
    },
  };

  session(): DriveJmapSession {
    return {
      accountId: "ada",
      maxSizeUpload: this.maxSizeUpload,
      uploadUrl: "/api/v1/jmap/upload/{accountId}/",
      downloadUrl: "/api/v1/jmap/download/{accountId}/{blobId}/{name}?type={type}",
      uploadCapabilities: this.capabilities(),
      client: {
        call: (name: string, args: Record<string, unknown>, options?: { using?: string[] }) =>
          this.call(name, args, options),
      },
      fileNodes: this.fileNodes,
    } as unknown as DriveJmapSession;
  }

  callsNamed(name: string) {
    return this.calls.filter((call) => call.name === name);
  }
}

export const ASSEMBLY_USING = ["urn:ietf:params:jmap:core", BLOB_ASSEMBLY_CAPABILITY];
export const BLOB_USING = ["urn:ietf:params:jmap:core", BLOB_CAPABILITY];

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function problem(type: string, status: number): Response {
  return new Response(JSON.stringify({ type, status }), {
    status,
    headers: { "Content-Type": "application/problem+json" },
  });
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** A file of `size` bytes whose content differs per offset (so parts never share an id). */
export function patternedFile(name: string, size: number): File {
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) bytes[index] = (index * 7 + (index >> 8)) % 251;
  return new File([bytes], name, { type: "application/octet-stream" });
}

export async function fileBytes(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

/** A Map-backed `localStorage` for the node test environment. */
export function memoryLocalStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, String(value)),
  };
}
