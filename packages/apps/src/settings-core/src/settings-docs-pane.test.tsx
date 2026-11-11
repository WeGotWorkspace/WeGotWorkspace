/** @vitest-environment jsdom */
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readDocsPageSetupOverrides,
  readDocsPageSetupPrefs,
  writeDocsPageSetupOverride,
  writeDocsPageSetupPrefs,
} from "@/lib/docs-page-setup";
import { SettingsDocsPane } from "@/settings-core/src/settings-docs-pane";
import {
  editSettingsField,
  waitForSettingsAutosave,
} from "@/settings-core/src/test-utils/settings-autosave";
import { notifySettingsSliceSaved } from "@/settings-core/src/settings-slice-saved";
import { useSettingsDocsForm } from "@/settings-core/src/use-settings-docs-form";

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
  writeDocsPageSetupPrefs({});
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("SettingsDocsPane", () => {
  it("shows the default paper and orientation", () => {
    writeDocsPageSetupPrefs({ format: "legal", orientation: "landscape" });
    render(<SettingsDocsPane />);
    expect(screen.getByRole("combobox", { name: "Default paper size" }).textContent).toBe("Legal");
    expect(screen.getByRole("combobox", { name: "Default orientation" }).textContent).toBe(
      "Landscape",
    );
  });

  it("turns orientation off when there is no paper", () => {
    writeDocsPageSetupPrefs({ format: "none" });
    render(<SettingsDocsPane />);
    expect(screen.getByRole("combobox", { name: "Default paper size" }).textContent).toBe("None");
    expect(screen.getByRole("combobox", { name: "Default orientation" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("shows the default, not a document's own page setup", () => {
    writeDocsPageSetupPrefs({ format: "a5" });
    writeDocsPageSetupOverride("/plan.md", { format: "letter", orientation: "landscape" });
    render(<SettingsDocsPane />);
    expect(screen.getByRole("combobox", { name: "Default paper size" }).textContent).toBe("A5");
    expect(readDocsPageSetupOverrides()["/plan.md"]?.format).toBe("letter");
  });

  it("has no Save button: the default saves itself", () => {
    render(<SettingsDocsPane />);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});

describe("useSettingsDocsForm", () => {
  it("stores a change once the autosave pause has passed", async () => {
    vi.useFakeTimers();
    writeDocsPageSetupPrefs({ format: "a4", orientation: "portrait" });
    const { result } = renderHook(() => useSettingsDocsForm());

    await editSettingsField(result.current.form, "format", "a3");
    await editSettingsField(result.current.form, "orientation", "landscape");
    expect(readDocsPageSetupPrefs()).toEqual({ format: "a4", orientation: "portrait" });

    await waitForSettingsAutosave();
    expect(readDocsPageSetupPrefs()).toEqual({ format: "a3", orientation: "landscape" });
    expect(result.current.form.formState.isDirty).toBe(false);
    expect(notifySettingsSliceSaved).toHaveBeenCalledWith({
      panelId: "docs",
      sliceId: "docs-page-setup",
    });
  });

  it("follows a default saved elsewhere while nothing is changed", () => {
    writeDocsPageSetupPrefs({ format: "a4" });
    const { result } = renderHook(() => useSettingsDocsForm());
    act(() => {
      writeDocsPageSetupPrefs({ format: "legal" });
    });
    expect(result.current.form.getValues("format")).toBe("legal");
  });

  it("keeps unsaved changes when the default changes elsewhere", () => {
    writeDocsPageSetupPrefs({ format: "a4" });
    const { result } = renderHook(() => useSettingsDocsForm());
    act(() => {
      result.current.form.setValue("format", "a5", { shouldDirty: true });
    });
    act(() => {
      writeDocsPageSetupPrefs({ format: "legal" });
    });
    expect(result.current.form.getValues("format")).toBe("a5");
  });

  it("does not report saved when storage rejects the write", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSettingsDocsForm());
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    await editSettingsField(result.current.form, "format", "a3");
    await waitForSettingsAutosave();
    expect(notifySettingsSliceSaved).not.toHaveBeenCalled();
    expect(result.current.form.formState.isDirty).toBe(true);
  });
});
