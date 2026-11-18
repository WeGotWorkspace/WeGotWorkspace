import { act, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import { ThreadPanel } from "@/thread-ui/src/thread-panel";
import { threadUiLabels } from "@/thread-ui/src/thread-labels";
import { createThreadMemoryClient } from "@/thread-ui/src/thread-memory-client";
import type { ThreadEntry, ThreadSubjectAdapter } from "@/lib/models/thread-types";

const alice = { id: "alice", displayName: "Alice" };
const bob = { id: "bob", displayName: "Bob" };
// Not a task: the panel knows nothing about the subject.
const subject = { type: "note", id: "n1" };

function entry(id: string, overrides: Partial<ThreadEntry> = {}): ThreadEntry {
  return {
    id,
    kind: "comment",
    parentId: null,
    author: { username: "bob", displayName: "Bob" },
    body: `Body ${id}`,
    mentions: [],
    reactions: [],
    createdAt: `2026-11-18T10:00:0${id.length % 10}.000Z`,
    editedAt: null,
    deletedAt: null,
    activity: null,
    ...overrides,
  };
}

function setup(entries: ThreadEntry[], canPost = true) {
  const client = createThreadMemoryClient(alice, [alice, bob]);
  client.seed(subject, entries);
  client.setCanPost(subject, canPost);
  const adapter: ThreadSubjectAdapter = {
    subject,
    scopeId: "s1",
    canPost,
    people: [alice, bob],
    me: alice,
  };
  const view = render(
    <TooltipProvider delayDuration={0}>
      <ThreadPanel client={client} adapter={adapter} />
    </TooltipProvider>,
  );
  return { client, adapter, view };
}

async function loaded() {
  await waitFor(() => expect(screen.queryByText(threadUiLabels.loading)).toBeNull());
}

describe("ThreadPanel", () => {
  it("shows comments with their replies in time order and counts both", async () => {
    setup([
      entry("C1", { createdAt: "2026-11-18T10:00:00.000Z", body: "First" }),
      entry("R1", {
        kind: "reply",
        parentId: "C1",
        createdAt: "2026-11-18T10:01:00.000Z",
        body: "Answer",
      }),
      entry("C2", { createdAt: "2026-11-18T10:02:00.000Z", body: "Second" }),
    ]);
    await loaded();

    expect(screen.getByRole("heading", { name: threadUiLabels.heading })).toBeTruthy();
    expect(screen.getByLabelText(threadUiLabels.count(3))).toBeTruthy();
    const roots = document.querySelectorAll(".thread-panel__root");
    expect(roots).toHaveLength(2);
    expect(within(roots[0] as HTMLElement).getByText("Answer")).toBeTruthy();
    expect(roots[0]?.querySelector(".thread-panel__replies")).not.toBeNull();
  });

  it("runs follow-ups by one author as Chat does, unless replies or time come between", async () => {
    setup([
      entry("C1", { createdAt: "2026-11-18T10:00:00.000Z", body: "One" }),
      entry("C2", { createdAt: "2026-11-18T10:02:00.000Z", body: "Two" }),
      entry("R1", {
        kind: "reply",
        parentId: "C2",
        createdAt: "2026-11-18T10:03:00.000Z",
        body: "Reply",
      }),
      entry("C3", { createdAt: "2026-11-18T10:04:00.000Z", body: "Three" }),
      entry("C4", { createdAt: "2026-11-18T10:30:00.000Z", body: "Four" }),
    ]);
    await loaded();

    const runs = [
      ...document.querySelectorAll(".thread-panel__root > ol > .thread-panel__entry"),
    ].map((row) =>
      row.querySelector(".chat-message")!.classList.contains("chat-message--continuation"),
    );
    // C2 follows C1; C3 comes after C2's reply; C4 is outside the 5-minute window.
    expect(runs).toEqual([false, true, false, false]);
  });

  it("does not show activity entries (comments only, 2026-11-18)", async () => {
    setup([
      entry("C1", { body: "A comment" }),
      entry("A1", { kind: "activity", body: null, activity: { field: "moved" } }),
    ]);
    await loaded();

    expect(document.querySelectorAll(".thread-panel__entry")).toHaveLength(1);
    expect(screen.getByLabelText(threadUiLabels.count(1))).toBeTruthy();
  });

  it("renders a body, a reaction and a mention name with HTML as text", async () => {
    const payload = '<img src=x onerror="window.__threadXss=1">';
    setup([
      entry("C1", {
        body: `Look ${payload} @bob`,
        mentions: [{ id: "bob", displayName: payload }],
        reactions: [{ emoji: payload, authors: ["bob"] }],
      }),
    ]);
    await loaded();

    const panel = document.querySelector(".thread-panel") as HTMLElement;
    await waitFor(() => expect(panel.textContent).toContain("onerror"));
    expect(panel.querySelector("img")).toBeNull();
    expect((window as unknown as { __threadXss?: number }).__threadXss).toBeUndefined();
  });

  it("shows no composer, reply, reaction picker, edit or delete when the adapter cannot post", async () => {
    setup(
      [
        entry("C1", {
          author: { username: "alice", displayName: "Alice" },
          reactions: [{ emoji: "👍", authors: ["bob"] }],
        }),
      ],
      false,
    );
    await loaded();

    expect(document.querySelector(".thread-panel__composer")).toBeNull();
    expect(screen.getByText(threadUiLabels.readOnly)).toBeTruthy();
    expect(document.querySelector(".chat-message__actions")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add reaction" })).toBeNull();
    const reaction = screen.getByRole("button", { pressed: false });
    expect((reaction as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers reply, react, edit and delete on your own comment when you may post", async () => {
    setup([entry("C1", { author: { username: "alice", displayName: "Alice" } })]);
    await loaded();

    expect(document.querySelector(".thread-panel__composer")).not.toBeNull();
    for (const name of ["Reply", "Add reaction", "Edit", "Delete"]) {
      expect(screen.getAllByRole("button", { name }).length).toBeGreaterThan(0);
    }
  });

  it("shows a comment from someone else after the next refresh", async () => {
    const { client } = setup([entry("C1", { body: "Hello" })]);
    await loaded();

    act(() =>
      client.receive(
        subject,
        entry("C2", { body: "From the other tab", createdAt: "2026-11-18T11:00:00.000Z" }),
      ),
    );
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => expect(screen.getByText("From the other tab")).toBeTruthy());
  });

  it("shows a new body after an edit lands", async () => {
    const { client } = setup([
      entry("C1", { author: { username: "alice", displayName: "Alice" }, body: "Before" }),
    ]);
    await loaded();
    await waitFor(() => expect(screen.getByText("Before")).toBeTruthy());

    await act(async () => {
      await client.edit(subject, "C1", "After");
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => expect(screen.getByText("After")).toBeTruthy());
    expect(screen.queryByText("Before")).toBeNull();
  });
});
