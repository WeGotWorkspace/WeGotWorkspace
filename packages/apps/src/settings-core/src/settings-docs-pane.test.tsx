/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  readDocsPageSetupOverrides,
  writeDocsPageSetupOverride,
  writeDocsPageSetupPrefs,
} from "@/lib/docs-page-setup";
import { SettingsDocsPane } from "@/settings-core/src/settings-docs-pane";

afterEach(() => {
  cleanup();
  writeDocsPageSetupPrefs({});
  window.localStorage.clear();
});

describe("SettingsDocsPane", () => {
  it("shows the default paper and orientation", () => {
    writeDocsPageSetupPrefs({ format: "legal", orientation: "landscape" });
    render(<SettingsDocsPane />);
    expect(screen.getByRole("combobox", { name: "Paper size" }).textContent).toBe("Legal");
    expect(screen.getByRole("combobox", { name: "Orientation" }).textContent).toBe("Landscape");
  });

  it("turns orientation off when there is no paper", () => {
    writeDocsPageSetupPrefs({ format: "none" });
    render(<SettingsDocsPane />);
    expect(screen.getByRole("combobox", { name: "Paper size" }).textContent).toBe("None");
    expect(screen.getByRole("combobox", { name: "Orientation" })).toHaveProperty("disabled", true);
  });

  it("shows the default, not a document's own page setup", () => {
    writeDocsPageSetupPrefs({ format: "a5" });
    writeDocsPageSetupOverride("/plan.md", { format: "letter", orientation: "landscape" });
    render(<SettingsDocsPane />);
    expect(screen.getByRole("combobox", { name: "Paper size" }).textContent).toBe("A5");
    expect(readDocsPageSetupOverrides()["/plan.md"]?.format).toBe("letter");
  });
});
