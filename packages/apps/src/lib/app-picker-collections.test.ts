import { afterEach, describe, expect, it, vi } from "vitest";
import {
  initialAppPickerCollections,
  loadAppPickerCollections,
  MOCK_APP_PICKER_COLLECTIONS,
  toNotebookPicker,
} from "@/lib/app-picker-collections";

const taskLists = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock("@/lib/api/wgw/tasks", () => ({
  listTaskLists: () => Promise.resolve(taskLists.current),
}));

afterEach(() => {
  taskLists.current = [];
  vi.unstubAllEnvs();
});

describe("loadAppPickerCollections", () => {
  it("returns mock writable collections when the live API is off", async () => {
    expect(await loadAppPickerCollections("tasks")).toEqual(MOCK_APP_PICKER_COLLECTIONS.tasks);
    expect(MOCK_APP_PICKER_COLLECTIONS.tasks.map((row) => row.id)).toEqual([
      "inbox",
      "default",
      "work",
    ]);
    expect(await loadAppPickerCollections("contacts")).toEqual(
      MOCK_APP_PICKER_COLLECTIONS.contacts,
    );
    expect(MOCK_APP_PICKER_COLLECTIONS.contacts[0]?.name).toBe("Personal");
    expect(await loadAppPickerCollections("notes")).toEqual(MOCK_APP_PICKER_COLLECTIONS.notes);
    expect(MOCK_APP_PICKER_COLLECTIONS.notes.every((row) => row.id === row.name)).toBe(true);
  });

  it("stores live notebook names as picker ids so prefs match personalNotebooks", () => {
    expect(
      toNotebookPicker({
        id: "notes-general",
        name: "General",
        isSharee: false,
      }).id,
    ).toBe("General");
    expect(
      toNotebookPicker({
        id: "notes-general",
        name: "General",
        role: "general",
        isSharee: false,
      }),
    ).toMatchObject({ id: "General", name: "General", isDefault: true });
  });

  it("seeds the provisioned default before a production list returns", () => {
    vi.stubEnv("VITE_WGW_USE_LIVE_API", "1");
    expect(initialAppPickerCollections("tasks")).toEqual([
      { id: "tasks-inbox", name: "Inbox", color: "#6366f1", isDefault: true },
    ]);
    expect(initialAppPickerCollections("notes")[0]).toMatchObject({
      id: "General",
      name: "General",
      isDefault: true,
    });
    expect(initialAppPickerCollections("contacts")[0]).toMatchObject({
      id: "default",
      name: "Personal",
      isDefault: true,
    });
  });

  it("keeps the owned inbox marked default when a live list leads with another list", async () => {
    vi.stubEnv("VITE_WGW_USE_LIVE_API", "1");
    taskLists.current = [
      {
        id: "work",
        name: "Work",
        color: "#f59e0b",
        isDefault: false,
        myRights: { mayWriteAll: true },
      },
      {
        id: "tasks-inbox",
        name: "Inbox",
        color: "#6366f1",
        isDefault: true,
        role: "inbox",
        myRights: { mayWriteAll: true },
      },
    ];
    const loaded = await loadAppPickerCollections("tasks");
    expect(loaded.map((row) => row.id)).toEqual(["work", "tasks-inbox"]);
    expect(loaded.find((row) => row.id === "tasks-inbox")?.isDefault).toBe(true);
    expect(loaded.find((row) => row.id === "work")?.isDefault).toBe(false);
  });
});
