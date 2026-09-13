import { wgwFetch, wgwReadJson } from "@/lib/api/wgw/http";
import type {
  DocsFileThread,
  DocsFileThreadChanges,
  DocsFileThreadCreate,
  DocsFileThreadPatch,
  DocsThreadsClient,
} from "./docs-threads-types";
import { threadsQuery } from "./docs-threads-types";

async function readThread(res: Response): Promise<DocsFileThread> {
  if (!res.ok) {
    throw new Error(`Docs threads request failed (${res.status})`);
  }
  return (await wgwReadJson(res)) as DocsFileThread;
}

export function createDocsThreadsLiveClient(): DocsThreadsClient {
  return {
    async list(path) {
      const res = await wgwFetch(`/files/threads?${threadsQuery(path)}`);
      if (!res.ok) throw new Error(`GET /files/threads failed (${res.status})`);
      const payload = (await wgwReadJson(res)) as { list?: DocsFileThread[] };
      return Array.isArray(payload.list) ? payload.list : [];
    },
    async create(path, input: DocsFileThreadCreate) {
      return readThread(
        await wgwFetch(`/files/threads?${threadsQuery(path)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }),
      );
    },
    async reply(path, threadId, input) {
      return readThread(
        await wgwFetch(
          `/files/threads/${encodeURIComponent(threadId)}/replies?${threadsQuery(path)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          },
        ),
      );
    },
    async react(path, threadId, emoji) {
      return readThread(
        await wgwFetch(
          `/files/threads/${encodeURIComponent(threadId)}/reactions?${threadsQuery(path)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ emoji }),
          },
        ),
      );
    },
    async patch(path, threadId, patch: DocsFileThreadPatch) {
      return readThread(
        await wgwFetch(`/files/threads/${encodeURIComponent(threadId)}?${threadsQuery(path)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        }),
      );
    },
    async changes(path, since) {
      const extra = since ? `&since=${encodeURIComponent(since)}` : "";
      const res = await wgwFetch(`/files/threads/changes?${threadsQuery(path)}${extra}`);
      if (!res.ok) throw new Error(`GET /files/threads/changes failed (${res.status})`);
      return (await wgwReadJson(res)) as DocsFileThreadChanges;
    },
  };
}
