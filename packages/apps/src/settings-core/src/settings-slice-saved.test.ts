/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import {
  notifySettingsSliceSaved,
  resetSettingsSliceSavedForTests,
  subscribeSettingsSliceSaved,
} from "@/settings-core/src/settings-slice-saved";

describe("settings-slice-saved", () => {
  it("notifies subscribers and unsubscribes", () => {
    resetSettingsSliceSavedForTests();
    const seen: Array<{ panelId: string; sliceId: string }> = [];
    const stop = subscribeSettingsSliceSaved((event) => {
      seen.push(event);
    });
    notifySettingsSliceSaved({ panelId: "profile", sliceId: "profile" });
    expect(seen).toEqual([{ panelId: "profile", sliceId: "profile" }]);
    stop();
    notifySettingsSliceSaved({ panelId: "profile", sliceId: "profile" });
    expect(seen).toHaveLength(1);
    resetSettingsSliceSavedForTests();
  });

  it("re-emits mapped storage events into the slice bus", () => {
    resetSettingsSliceSavedForTests();
    const seen: Array<{ panelId: string; sliceId: string }> = [];
    const stop = subscribeSettingsSliceSaved((event) => {
      seen.push(event);
    });
    const storageEvent = new Event("storage");
    Object.defineProperty(storageEvent, "key", { value: "wgw.ui.calendar.displayPrefs" });
    window.dispatchEvent(storageEvent);
    expect(seen).toEqual([{ panelId: "calendar", sliceId: "calendar-display" }]);
    stop();
    resetSettingsSliceSavedForTests();
  });
});
