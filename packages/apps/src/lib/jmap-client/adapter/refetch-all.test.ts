import { describe, expect, it, vi } from "vitest";
import { JmapClient, type JmapFetch } from "../core/JmapClient.js";
import { MockJmapServer, type MockRecordType } from "../mock/MockJmapServer.js";
import { JmapChatAdapter } from "./JmapChatAdapter.js";
import { JmapContactsAdapter } from "./JmapContactsAdapter.js";
import type { JmapInboundAdapter } from "./JmapInboundAdapter.js";
import { JmapNotesAdapter } from "./JmapNotesAdapter.js";

/**
 * #1792: after `cannotCalculateChanges` the adapters re-list every record.
 * The server refuses a get-all above `maxObjectsInGet` (500), so the re-list
 * must go through `/query` and explicit-id `/get` chunks.
 */
const COUNT = 1200;
const MAX_OBJECTS_IN_GET = 500;

type Case = {
  type: MockRecordType;
  container: { type: MockRecordType; id: string };
  record: (index: number) => { id: string; [key: string]: unknown };
  adapter: (
    client: JmapClient,
    hooks: {
      onRefetchAll: (ids: string[]) => void;
      onRemote: (id: string) => void;
      onSyncError: (error: unknown) => void;
    },
  ) => JmapInboundAdapter;
};

const cases: Case[] = [
  {
    type: "Note",
    container: { type: "Notebook", id: "notes-general" },
    record: (index) => ({ id: `note-${index}`, notebookId: "notes-general", title: `${index}` }),
    adapter: (client, hooks) =>
      new JmapNotesAdapter({
        client,
        onSyncError: hooks.onSyncError,
        onRemoteNote: (note) => hooks.onRemote(note.id),
        onRefetchAll: ({ notes }) => hooks.onRefetchAll(notes.map((note) => note.id)),
      }),
  },
  {
    type: "ChatMessage",
    container: { type: "ChatChannel", id: "chat-general" },
    record: (index) => ({ id: `msg-${index}`, channelId: "chat-general", body: `${index}` }),
    adapter: (client, hooks) =>
      new JmapChatAdapter({
        client,
        onSyncError: hooks.onSyncError,
        onRemoteMessage: (message) => hooks.onRemote(message.id),
        onRefetchAll: ({ messages }) => hooks.onRefetchAll(messages.map((message) => message.id)),
      }),
  },
  {
    type: "ContactCard",
    container: { type: "AddressBook", id: "default" },
    record: (index) => ({ id: `card-${index}`, addressBookIds: { default: true } }),
    adapter: (client, hooks) =>
      new JmapContactsAdapter({
        client,
        onSyncError: hooks.onSyncError,
        onRemoteContactCard: (card) => hooks.onRemote(card.id),
        onRefetchAll: ({ cards }) => hooks.onRefetchAll(cards.map((card) => card.id)),
      }),
  },
];

function setup(testCase: Case, fetchOverride?: (fetch: JmapFetch) => JmapFetch) {
  const server = new MockJmapServer();
  server.seedRecord(testCase.container.type, { id: testCase.container.id, name: "Default" });
  for (let index = 0; index < COUNT; index++) {
    server.seedRecord(testCase.type, testCase.record(index));
  }
  const client = new JmapClient({
    sessionUrl: server.sessionUrl,
    fetch: fetchOverride ? fetchOverride(server.fetch) : server.fetch,
  });
  const hooks = { onRefetchAll: vi.fn(), onRemote: vi.fn(), onSyncError: vi.fn() };
  const adapter = testCase.adapter(client, hooks);
  return { server, client, hooks, adapter };
}

function getCalls(server: MockJmapServer, type: string) {
  return server.methodCalls
    .filter(([name]) => name === `${type}/get`)
    .map(([, args]) => args.ids as string[] | null | undefined);
}

describe.each(cases)("$type refetch after cannotCalculateChanges", (testCase) => {
  it(`delivers all ${COUNT} records without a get-all, in chunks of at most maxObjectsInGet`, async () => {
    const { server, client, hooks, adapter } = setup(testCase);
    await client.connect();
    // The mock cannot compute changes from a state it never issued.
    client.setState(adapter.accountId, testCase.type, "stale");

    await adapter.sync();

    expect(hooks.onSyncError).not.toHaveBeenCalled();
    const delivered = hooks.onRefetchAll.mock.calls[0]?.[0] as string[];
    expect(new Set(delivered)).toEqual(
      new Set(Array.from({ length: COUNT }, (_, index) => testCase.record(index).id)),
    );
    const gets = getCalls(server, testCase.type);
    expect(gets.every((ids) => Array.isArray(ids))).toBe(true);
    expect(Math.max(...gets.map((ids) => ids!.length))).toBeLessThanOrEqual(MAX_OBJECTS_IN_GET);
  });

  it("records the state from before the re-list, so a change made during it still arrives", async () => {
    const { server, client, hooks, adapter } = setup(testCase);
    await client.connect();
    client.setState(adapter.accountId, testCase.type, "stale");
    const startState = server.state;
    const late = { ...testCase.record(COUNT), id: `${testCase.type}-late` };
    server.beforeRequest = (calls) => {
      // First explicit-id get: the listing is done, the bodies are not.
      const bodies = calls.filter(
        ([name, args]) => name === `${testCase.type}/get` && (args.ids as string[]).length > 0,
      );
      if (!bodies.length) return;
      server.beforeRequest = null;
      server.remoteUpsertRecord(testCase.type, late);
    };

    await adapter.sync();

    expect(client.getState(adapter.accountId, testCase.type)).toBe(startState);
    expect(hooks.onRefetchAll.mock.calls[0]?.[0]).not.toContain(late.id);

    await adapter.sync();

    expect(hooks.onRemote).toHaveBeenCalledWith(late.id);
    expect(hooks.onSyncError).not.toHaveBeenCalled();
  });

  it("reports a failed re-list to onSyncError", async () => {
    const failQuery =
      (fetch: JmapFetch): JmapFetch =>
      async (input, init) =>
        String(init?.body ?? "").includes(`"${testCase.type}/query"`)
          ? new Response("{}", { status: 503 })
          : fetch(input, init);
    const { client, hooks, adapter } = setup(testCase, failQuery);
    await client.connect();
    client.setState(adapter.accountId, testCase.type, "stale");

    await expect(adapter.sync()).resolves.toBeUndefined();

    expect(hooks.onSyncError).toHaveBeenCalledTimes(1);
    expect(hooks.onRefetchAll).not.toHaveBeenCalled();
  });
});
