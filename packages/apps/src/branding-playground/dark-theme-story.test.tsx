import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { withDarkTheme } from "@/branding-playground/dark-theme-story";

function Story() {
  return <p>story body</p>;
}

describe("withDarkTheme", () => {
  afterEach(() => {
    delete document.documentElement.dataset.theme;
  });

  it("renders the story inside the wrapper", () => {
    render(withDarkTheme(Story));
    expect(screen.getByText("story body")).toBeTruthy();
  });

  it("sets the dark theme on <html> while the story is mounted", () => {
    render(withDarkTheme(Story));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("removes the theme attribute on unmount when none was set before", () => {
    const { unmount } = render(withDarkTheme(Story));
    unmount();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("puts the previous theme back on unmount", () => {
    document.documentElement.dataset.theme = "soft";
    const { unmount } = render(withDarkTheme(Story));
    expect(document.documentElement.dataset.theme).toBe("dark");
    unmount();
    expect(document.documentElement.dataset.theme).toBe("soft");
  });
});
