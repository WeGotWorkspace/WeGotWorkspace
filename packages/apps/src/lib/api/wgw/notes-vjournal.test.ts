import { beforeEach, describe, expect, it, vi } from "vitest";
import { noteFromVjournal, type NotesVjournalNotebook } from "@/lib/api/wgw/notes-vjournal";

const wgwFetch = vi.fn();

vi.mock("@/lib/api/wgw/http", () => ({
  wgwFetch: (...args: unknown[]) => wgwFetch(...args),
  wgwFetchPrincipal: vi.fn(),
  wgwReadJson: vi.fn(async () => ({})),
}));

const notebooks: NotesVjournalNotebook[] = [
  { id: "notes-general", name: "General", color: "#14b8a6", isSharee: false },
];

describe("noteFromVjournal", () => {
  it("maps updatedAt onto display date and keeps metadata updatedAt", () => {
    const mapped = noteFromVjournal(
      {
        id: "n-1",
        notebookId: "notes-general",
        title: "Hello",
        body: "Body",
        categories: ["ideas"],
        status: null,
        etag: '"1"',
        updatedAt: "2026-08-10T12:00:00.000Z",
      },
      notebooks,
    );

    expect(mapped.date).toBe("2026-08-10T12:00:00.000Z");
    expect(mapped.updatedAt).toBe("2026-08-10T12:00:00.000Z");
  });

  it("prefers contentUpdatedAt for the footer/list display date", () => {
    const mapped = noteFromVjournal(
      {
        id: "n-2",
        notebookId: "notes-general",
        title: "Hello",
        body: "Body",
        categories: [],
        status: null,
        etag: '"1"',
        updatedAt: "2024-01-01T00:00:00.000Z",
        contentUpdatedAt: "2026-06-01T12:00:00.000Z",
      },
      notebooks,
    );

    expect(mapped.date).toBe("2026-06-01T12:00:00.000Z");
    expect(mapped.updatedAt).toBe("2024-01-01T00:00:00.000Z");
  });

  it("maps STATUS CANCELLED to archived and FINAL/null to not archived", () => {
    const cancelled = noteFromVjournal(
      {
        id: "n-3",
        notebookId: "notes-general",
        title: "Done",
        body: "Body",
        categories: [],
        status: "CANCELLED",
        etag: '"2"',
      },
      notebooks,
    );
    const restored = noteFromVjournal(
      {
        id: "n-4",
        notebookId: "notes-general",
        title: "Open",
        body: "Body",
        categories: [],
        status: "FINAL",
        etag: '"3"',
      },
      notebooks,
    );
    expect(cancelled.archived).toBe(true);
    expect(restored.archived).toBe(false);
  });
});

describe("deleteNotebook", () => {
  beforeEach(() => {
    wgwFetch.mockReset();
    wgwFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
  });

  it("sends onDestroyRemoveContents as a query param, not a DELETE body", async () => {
    const { deleteNotebook } = await import("@/lib/api/wgw/notes-vjournal");
    await deleteNotebook("notes-scratch", { onDestroyRemoveContents: true });
    expect(wgwFetch).toHaveBeenCalledWith(
      "/notes/notebooks/notes-scratch?onDestroyRemoveContents=1",
      expect.objectContaining({ method: "DELETE" }),
    );
    const init = wgwFetch.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBeUndefined();
  });
});
