/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readMeetLowData, writeMeetLowData } from "@/lib/meet-low-data";
import { SettingsMeetPane } from "@/settings-core/src/settings-meet-pane";
import {
  editSettingsField,
  waitForSettingsAutosave,
} from "@/settings-core/src/test-utils/settings-autosave";
import { notifySettingsSliceSaved } from "@/settings-core/src/settings-slice-saved";
import { useSettingsMeetForm } from "@/settings-core/src/use-settings-meet-form";

vi.mock("@/hooks/use-run-with-app-toast", () => ({
  useRunWithAppToast: () => async (work: () => Promise<unknown>) => {
    try {
      return await work();
    } catch {
      return undefined;
    }
  },
}));

vi.mock("@/settings-core/src/settings-slice-saved", async () => {
  const actual = await vi.importActual<typeof import("@/settings-core/src/settings-slice-saved")>(
    "@/settings-core/src/settings-slice-saved",
  );
  return { ...actual, notifySettingsSliceSaved: vi.fn() };
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("SettingsMeetPane", () => {
  it("shows the stored choice", () => {
    writeMeetLowData(true);
    render(<SettingsMeetPane />);
    expect(screen.getByRole("switch", { name: "Low data mode" }).getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("stores the switch once the autosave pause has passed, without a Save button", async () => {
    vi.useFakeTimers();
    render(<SettingsMeetPane />);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();

    fireEvent.click(screen.getByRole("switch", { name: "Low data mode" }));
    expect(readMeetLowData()).toBe(false);

    await waitForSettingsAutosave();
    expect(readMeetLowData()).toBe(true);
    expect(notifySettingsSliceSaved).toHaveBeenCalledWith({
      panelId: "meet",
      sliceId: "meet-device",
    });
  });
});

describe("useSettingsMeetForm", () => {
  it("follows a choice made in a call while nothing is changed", () => {
    const { result } = renderHook(() => useSettingsMeetForm());
    act(() => {
      writeMeetLowData(true);
    });
    expect(result.current.form.getValues("lowData")).toBe(true);
  });

  it("does not report saved when storage rejects the write", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSettingsMeetForm());
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    await editSettingsField(result.current.form, "lowData", true);
    await waitForSettingsAutosave();
    expect(notifySettingsSliceSaved).not.toHaveBeenCalled();
    expect(result.current.form.formState.isDirty).toBe(true);
  });
});
