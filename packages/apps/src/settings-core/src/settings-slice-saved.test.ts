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
    notifySettingsSliceSaved({ panelId: "mail", sliceId: "mail-accounts" });
    expect(seen).toEqual([{ panelId: "mail", sliceId: "mail-accounts" }]);
    stop();
    notifySettingsSliceSaved({ panelId: "mail", sliceId: "mail-accounts" });
    expect(seen).toHaveLength(1);
    resetSettingsSliceSavedForTests();
  });
});
