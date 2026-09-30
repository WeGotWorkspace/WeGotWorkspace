import { describe, expect, it } from "vitest";
import {
  loadAppPickerCollections,
  MOCK_APP_PICKER_COLLECTIONS,
  toNotebookPicker,
} from "@/lib/app-picker-collections";

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
  });
});
