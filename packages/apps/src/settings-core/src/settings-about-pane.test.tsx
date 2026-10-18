import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SOURCE_CODE_URL, PROJECT_LICENSE } from "@/lib/source-code";
import { SettingsAboutPane } from "@/settings-core/src/settings-about-pane";

afterEach(() => {
  cleanup();
});

describe("SettingsAboutPane", () => {
  it("states the license and links to the upstream source by default", () => {
    render(<SettingsAboutPane />);
    expect(screen.getByText(new RegExp(PROJECT_LICENSE))).toBeTruthy();
    const link = screen.getByRole("link", { name: "Source code" });
    expect(link.getAttribute("href")).toBe(DEFAULT_SOURCE_CODE_URL);
  });

  it("links to a hoster's own source when configured", () => {
    render(<SettingsAboutPane sourceUrl="https://git.example.org/hoster/wgw" />);
    expect(screen.getByRole("link", { name: "Source code" }).getAttribute("href")).toBe(
      "https://git.example.org/hoster/wgw",
    );
  });
});
