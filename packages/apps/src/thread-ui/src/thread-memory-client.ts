import {
  ThreadRequestError,
  type ThreadClient,
  type ThreadEntry,
  type ThreadPerson,
  type ThreadSubjectRef,
} from "@/lib/models/thread-types";

/**
 * The thread API in memory, for mock mode, stories and tests. It keeps the
 * server's rules that the panel relies on: idempotent ids, one level of
 * replies, author-only edit and delete, tombstones, write access.
 */
export type ThreadMemoryClient = ThreadClient & {
  seed: (subject: ThreadSubjectRef, entries: ThreadEntry[]) => void;
  setActor: (actor: ThreadPerson) => void;
  setCanPost: (subject: ThreadSubjectRef, canPost: boolean) => void;
  /** Adds an entry as someone else, as another tab or person would. */
  receive: (subject: ThreadSubjectRef, entry: ThreadEntry) => void;
  snapshot: (subject: ThreadSubjectRef) => ThreadEntry[];
};

type Store = {
  entries: ThreadEntry[];
  canPost: boolean;
  state: number;
  changedAt: Map<string, number>;
};

const key = (subject: ThreadSubjectRef) => `${subject.type}:${subject.id}`;

export function createThreadMemoryClient(
  actor: ThreadPerson = { id: "demo", displayName: "Demo User" },
  people: readonly ThreadPerson[] = [],
): ThreadMemoryClient {
  let me = actor;
  const stores = new Map<string, Store>();
  const store = (subject: ThreadSubjectRef): Store => {
    let found = stores.get(key(subject));
    if (!found) {
      found = { entries: [], canPost: true, state: 1, changedAt: new Map() };
      stores.set(key(subject), found);
    }
    return found;
  };
  const touch = (s: Store, entry: ThreadEntry) => {
    s.state += 1;
    s.changedAt.set(entry.id, s.state);
  };
  const find = (subject: ThreadSubjectRef, entryId: string) => {
    const entry = store(subject).entries.find((item) => item.id === entryId);
    if (!entry) throw new ThreadRequestError("Entry not found.", 404, "not_found");
    return entry;
  };
  const assertPost = (subject: ThreadSubjectRef) => {
    if (!store(subject).canPost) throw new ThreadRequestError("Read-only.", 403, "forbidden");
  };
  const nameOf = (id: string) => people.find((person) => person.id === id)?.displayName ?? id;
  const copy = (entry: ThreadEntry) => structuredClone(entry);

  return {
    seed(subject, entries) {
      const s = store(subject);
      for (const entry of entries) {
        s.entries.push(structuredClone(entry));
        touch(s, entry);
      }
    },
    setActor(next) {
      me = next;
    },
    setCanPost(subject, canPost) {
      store(subject).canPost = canPost;
    },
    receive(subject, entry) {
      const s = store(subject);
      s.entries.push(structuredClone(entry));
      touch(s, entry);
    },
    snapshot(subject) {
      return store(subject).entries.map(copy);
    },
    async list(subject) {
      const s = store(subject);
      return {
        list: s.entries.map(copy),
        nextCursor: null,
        state: String(s.state),
        canPost: s.canPost,
      };
    },
    async post(subject, post) {
      const s = store(subject);
      const existing = s.entries.find((entry) => entry.id === post.id);
      if (existing) return copy(existing);
      assertPost(subject);
      if (post.parentId) {
        const parent = s.entries.find((entry) => entry.id === post.parentId);
        if (!parent || parent.kind !== "comment") {
          throw new ThreadRequestError("parentId must be a root comment.", 422, "invalidArguments");
        }
      }
      const audience = new Set(people.map((person) => person.id));
      const entry: ThreadEntry = {
        id: post.id,
        kind: post.parentId ? "reply" : "comment",
        parentId: post.parentId ?? null,
        author: { username: me.id, displayName: me.displayName },
        body: post.body,
        mentions: (post.mentions ?? [])
          .filter((mention) => audience.has(mention.id))
          .map((mention) => ({ id: mention.id, displayName: nameOf(mention.id) })),
        reactions: [],
        createdAt: new Date().toISOString(),
        editedAt: null,
        deletedAt: null,
        activity: null,
      };
      s.entries.push(entry);
      touch(s, entry);
      return copy(entry);
    },
    async edit(subject, entryId, body) {
      assertPost(subject);
      const entry = find(subject, entryId);
      if (entry.author.username !== me.id)
        throw new ThreadRequestError("Not yours.", 403, "forbidden");
      if (entry.deletedAt) throw new ThreadRequestError("Deleted.", 409, "conflict");
      entry.body = body;
      entry.editedAt = new Date().toISOString();
      touch(store(subject), entry);
      return copy(entry);
    },
    async remove(subject, entryId) {
      assertPost(subject);
      const entry = find(subject, entryId);
      if (entry.author.username !== me.id)
        throw new ThreadRequestError("Not yours.", 403, "forbidden");
      entry.body = null;
      entry.mentions = [];
      entry.deletedAt = entry.deletedAt ?? new Date().toISOString();
      touch(store(subject), entry);
      return copy(entry);
    },
    async react(subject, entryId, emoji) {
      assertPost(subject);
      const entry = find(subject, entryId);
      const reaction = entry.reactions.find((item) => item.emoji === emoji);
      if (!reaction) entry.reactions.push({ emoji, authors: [me.id] });
      else if (reaction.authors.includes(me.id)) {
        reaction.authors = reaction.authors.filter((author) => author !== me.id);
        if (reaction.authors.length === 0)
          entry.reactions = entry.reactions.filter((item) => item !== reaction);
      } else reaction.authors.push(me.id);
      touch(store(subject), entry);
      return copy(entry);
    },
    async changes(subject, since) {
      const s = store(subject);
      const from = Number(since);
      const changed = [...s.changedAt].filter(([, at]) => at > from).map(([id]) => id);
      return {
        oldState: since,
        newState: String(s.state),
        changed,
        removed: [],
        hasMoreChanges: false,
      };
    },
  };
}
