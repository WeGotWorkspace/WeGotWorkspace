import { wgwFetch, wgwReadJson } from "@/lib/api/wgw/http";
import { readWgwChangesPage, readWgwListFeed } from "@/lib/live/wgw-feed-request";
import { docsThreadsErrorFactory, docsThreadsRequestError } from "./docs-threads-errors";
import type {
  DocsFileThread,
  DocsFileThreadChanges,
  DocsFileThreadCreate,
  DocsFileThreadPatch,
  DocsThreadsClient,
} from "./docs-threads-types";
import { threadsQuery } from "./docs-threads-types";

async function readThread(res: Response): Promise<DocsFileThread> {
  if (!res.ok) throw await docsThreadsRequestError(res, "Docs threads request");
  return (await wgwReadJson(res)) as DocsFileThread;
}

export function createDocsThreadsLiveClient(): DocsThreadsClient {
  return {
    list(path) {
      return readWgwListFeed<DocsFileThread>(
        `/files/threads?${threadsQuery(path)}`,
        "GET /files/threads",
        docsThreadsErrorFactory,
      );
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
    changes(path, since) {
      return readWgwChangesPage<DocsFileThreadChanges>(
        `/files/threads/changes?${threadsQuery(path)}`,
        since,
        "GET /files/threads/changes",
        docsThreadsErrorFactory,
      );
    },
  };
}
