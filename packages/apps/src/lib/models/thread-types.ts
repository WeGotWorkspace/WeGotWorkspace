import type { components } from "@wgw/openapi-types/openapi-types";

/** One entry as the server returns it (#2173, `GET /threads/{type}/{id}/entries`). */
export type ThreadEntry = components["schemas"]["ThreadEntry"];
export type ThreadEntryMention = components["schemas"]["ThreadEntryMention"];

export type ThreadPage = {
  list: ThreadEntry[];
  nextCursor: string | null;
  state: string;
  canPost: boolean;
};

export type ThreadChanges = components["schemas"]["ThreadChangesResponse"];

export type ThreadPost = {
  /** Client ULID: retrying the same id is a no-op on the server. */
  id: string;
  body: string;
  parentId?: string | null;
  /** The scope the author saw the subject in; a stale one answers 409 `subject_moved`. */
  scopeId?: string | null;
  mentions?: { id: string }[];
};

/** The thing a thread is about, as the server addresses it. */
export type ThreadSubjectRef = { type: string; id: string };

/**
 * The thread API, live or in memory (mock mode, stories, tests). Errors carry
 * the HTTP status and the API `code` ({@link ThreadRequestError}).
 */
export type ThreadClient = {
  list: (
    subject: ThreadSubjectRef,
    cursor?: string | null,
    signal?: AbortSignal,
  ) => Promise<ThreadPage>;
  post: (subject: ThreadSubjectRef, post: ThreadPost) => Promise<ThreadEntry>;
  edit: (subject: ThreadSubjectRef, entryId: string, body: string) => Promise<ThreadEntry>;
  remove: (subject: ThreadSubjectRef, entryId: string) => Promise<ThreadEntry>;
  react: (subject: ThreadSubjectRef, entryId: string, emoji: string) => Promise<ThreadEntry>;
  changes: (
    subject: ThreadSubjectRef,
    since: string,
    signal?: AbortSignal,
  ) => Promise<ThreadChanges>;
};

export class ThreadRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ThreadRequestError";
  }
}

/** Someone who can be mentioned: in the subject's audience. */
export type ThreadPerson = { id: string; displayName: string };

/**
 * What an app hands the shared panel (#2173 spec, UI). The panel knows
 * nothing about tasks; the task adapter lives in tasks-core.
 */
export type ThreadSubjectAdapter = {
  subject: ThreadSubjectRef;
  /** The scope as the user sees it now (for a task, its list id), sent with each post. */
  scopeId: string | null;
  /** The app's own view of write access. The server's `canPost` wins when it says no. */
  canPost: boolean;
  /** People in the audience, for mentions and names. */
  people: readonly ThreadPerson[];
  /** The signed-in user: the author of what this tab posts. */
  me: ThreadPerson;
};
