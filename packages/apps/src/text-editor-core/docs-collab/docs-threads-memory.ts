import type { DocsCommentAuthor, DocsCommentThread } from "./docs-comments-types";
import type { DocsSuggestionThread } from "./docs-suggestions-types";
import { commentThreadToDocsFile, suggestionThreadToDocsFile } from "./docs-threads-assemble";
import type {
  DocsFileThread,
  DocsFileThreadChanges,
  DocsFileThreadCreate,
  DocsThreadsClient,
} from "./docs-threads-types";

export type DocsThreadsMemoryClient = DocsThreadsClient & {
  seed: (thread: DocsFileThread) => void;
  seedComment: (thread: DocsCommentThread, path?: string) => void;
  seedSuggestion: (thread: DocsSuggestionThread, path?: string) => void;
  snapshot: () => DocsFileThread[];
  get: (id: string) => DocsFileThread | undefined;
  forget: (threadId: string) => void;
  setActor: (actor: DocsCommentAuthor) => void;
};

const TEST_PATH = "/users/bob/docs/plan.md";

function cloneThread(thread: DocsFileThread): DocsFileThread {
  return structuredClone(thread);
}

function upsert(list: DocsFileThread[], thread: DocsFileThread): DocsFileThread[] {
  const next = list.filter((item) => {
    if (item.id === thread.id) return false;
    if (
      thread.kind === "suggestion" &&
      thread.changeId &&
      item.kind === "suggestion" &&
      item.changeId === thread.changeId
    ) {
      return false;
    }
    return true;
  });
  next.push(cloneThread(thread));
  next.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return next;
}

export function createDocsThreadsMemory(
  path = TEST_PATH,
  actor: DocsCommentAuthor = { id: "u-1", name: "Alex" },
): DocsThreadsMemoryClient {
  let threads: DocsFileThread[] = [];
  let currentActor = actor;

  const requireThread = (threadId: string): DocsFileThread => {
    const thread = threads.find((item) => item.id === threadId);
    if (!thread) throw new Error(`Thread ${threadId} not found`);
    return cloneThread(thread);
  };

  return {
    seed(thread) {
      threads = upsert(threads, thread);
    },
    seedComment(thread, seedPath = path) {
      threads = upsert(threads, commentThreadToDocsFile(thread, seedPath));
    },
    seedSuggestion(thread, seedPath = path) {
      threads = upsert(threads, suggestionThreadToDocsFile(thread, seedPath));
    },
    snapshot: () => threads.map(cloneThread),
    get: (id) => {
      const thread = threads.find((item) => item.id === id);
      return thread ? cloneThread(thread) : undefined;
    },
    forget(threadId) {
      threads = threads.filter((item) => item.id !== threadId);
    },
    setActor(next) {
      currentActor = next;
    },
    async list() {
      return threads.map(cloneThread);
    },
    async create(_path, input: DocsFileThreadCreate) {
      const existing = threads.find((item) => item.id === input.id);
      if (existing) return cloneThread(existing);
      const now = new Date().toISOString();
      const created: DocsFileThread = {
        id: input.id,
        kind: input.kind,
        path,
        changeId: input.kind === "suggestion" ? (input.changeId ?? null) : null,
        anchorText: input.anchorText ?? "",
        anchorFrom: input.anchorFrom ?? null,
        anchorTo: input.anchorTo ?? null,
        anchorOccurrence: input.anchorOccurrence ?? null,
        createdAt: now,
        createdBy: { ...currentActor },
        resolved: false,
        archived: false,
        messages: [
          {
            id: input.id,
            body: input.body,
            createdAt: now,
            author: { ...currentActor },
          },
        ],
        reactions: [],
      };
      threads = upsert(threads, created);
      return cloneThread(created);
    },
    async reply(_path, threadId, input) {
      const thread = requireThread(threadId);
      if (thread.messages.some((message) => message.id === input.id)) return thread;
      thread.messages = [
        ...thread.messages,
        {
          id: input.id,
          body: input.body,
          createdAt: new Date().toISOString(),
          author: { ...currentActor },
        },
      ];
      threads = upsert(threads, thread);
      return cloneThread(thread);
    },
    async react(_path, threadId, emoji) {
      const thread = requireThread(threadId);
      const reactions = [...thread.reactions];
      const index = reactions.findIndex((reaction) => reaction.emoji === emoji);
      const userId = currentActor.id;
      if (index >= 0) {
        const current = reactions[index]!;
        const userIds = current.userIds.includes(userId)
          ? current.userIds.filter((id) => id !== userId)
          : [...current.userIds, userId];
        if (userIds.length === 0) reactions.splice(index, 1);
        else reactions[index] = { emoji, userIds };
      } else {
        reactions.push({ emoji, userIds: [userId] });
      }
      thread.reactions = reactions;
      threads = upsert(threads, thread);
      return cloneThread(thread);
    },
    async patch(_path, threadId, patch) {
      const match =
        patch.changeId != null
          ? (threads.find((item) => item.changeId === patch.changeId) ??
            threads.find((item) => item.id === threadId))
          : threads.find((item) => item.id === threadId);
      if (!match) {
        throw new Error(`Thread ${threadId} not found`);
      }
      if (patch.resolved != null) match.resolved = patch.resolved;
      if (patch.archived != null) match.archived = patch.archived;
      if (patch.anchorText != null) match.anchorText = patch.anchorText;
      if (patch.anchorFrom != null) match.anchorFrom = patch.anchorFrom;
      if (patch.anchorTo != null) match.anchorTo = patch.anchorTo;
      threads = upsert(threads, match);
      return cloneThread(match);
    },
    async changes(): Promise<DocsFileThreadChanges> {
      return {
        oldState: "0",
        newState: "0",
        created: [],
        updated: [],
        destroyed: [],
        hasMoreChanges: false,
      };
    },
  };
}
