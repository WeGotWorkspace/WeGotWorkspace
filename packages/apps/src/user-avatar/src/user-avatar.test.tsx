/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { initialsFromDisplayName, UserAvatar } from "./user-avatar";

afterEach(() => {
  cleanup();
});

describe("initialsFromDisplayName", () => {
  it("returns initials for a normal display name", () => {
    expect(initialsFromDisplayName("Alex Morgan")).toBe("AM");
  });

  it("returns empty string for null, undefined, or blank names", () => {
    expect(initialsFromDisplayName(null)).toBe("");
    expect(initialsFromDisplayName(undefined)).toBe("");
    expect(initialsFromDisplayName("")).toBe("");
    expect(initialsFromDisplayName("   ")).toBe("");
  });
});

describe("UserAvatar", () => {
  it("renders a fallback initial when displayName is null", () => {
    render(<UserAvatar displayName={null} compact />);

    expect(screen.getByRole("img", { name: "Unknown avatar" }).textContent).toBe("U");
  });

  it("renders a fallback initial when displayName is empty", () => {
    render(<UserAvatar displayName="" compact />);

    expect(screen.getByRole("img", { name: "Unknown avatar" }).textContent).toBe("U");
  });

  it("renders a custom fallback instead of initials", () => {
    render(
      <UserAvatar
        displayName="Acme Corp"
        compact
        fallback={<span data-testid="fallback-icon" />}
      />,
    );

    expect(screen.getByTestId("fallback-icon")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Acme Corp avatar" }).textContent).not.toMatch(/A/);
  });
});
