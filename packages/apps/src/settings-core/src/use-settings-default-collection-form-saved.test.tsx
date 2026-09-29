import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_COLLECTION_STORAGE_KEYS } from "@/lib/default-collection-prefs";
import { notifySettingsSliceSaved } from "@/settings-core/src/settings-slice-saved";
import { useSettingsDefaultCollectionForm } from "@/settings-core/src/use-settings-default-collection-form";

vi.mock("@/hooks/use-run-with-app-toast", () => ({
  useRunWithAppToast: () => async (work: () => Promise<unknown>) => work(),
}));

vi.mock("@/settings-core/src/settings-slice-saved", async () => {
  const actual = await vi.importActual<typeof import("@/settings-core/src/settings-slice-saved")>(
    "@/settings-core/src/settings-slice-saved",
  );
  return {
    ...actual,
    notifySettingsSliceSaved: vi.fn(actual.notifySettingsSliceSaved),
  };
});

describe("useSettingsDefaultCollectionForm onSaved", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(notifySettingsSliceSaved).mockClear();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("persists the collection id and emits notifySettingsSliceSaved", async () => {
    const { result } = renderHook(() => useSettingsDefaultCollectionForm("tasks"));

    await act(async () => {
      result.current.form.setValue("collectionId", "work", { shouldDirty: true });
      await result.current.saveDisplay();
    });

    expect(
      JSON.parse(window.localStorage.getItem(DEFAULT_COLLECTION_STORAGE_KEYS.tasks) ?? "{}"),
    ).toEqual({ collectionId: "work" });
    expect(notifySettingsSliceSaved).toHaveBeenCalledWith({
      panelId: "tasks",
      sliceId: "tasks-default-collection",
    });
  });
});
