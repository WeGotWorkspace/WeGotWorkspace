/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { initialsFromDisplayName, UserAvatar, UserPresenceDot } from "./user-avatar";
import { avatarColorForUserId } from "./user-avatar-color";

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

  it("announces online presence on the mark", () => {
    const { container } = render(
      <UserAvatar displayName="Ada Lovelace" compact presence="online" />,
    );

    expect(screen.getByRole("img", { name: "Ada Lovelace avatar, online" })).toBeTruthy();
    expect(container.querySelector("[data-presence='online']")).toBeTruthy();
  });

  it("renders an offline presence pip", () => {
    const { container } = render(
      <UserAvatar displayName="Grace Hopper" compact presence="offline" />,
    );

    expect(screen.getByRole("img", { name: "Grace Hopper avatar, offline" })).toBeTruthy();
    expect(container.querySelector("[data-presence='offline']")).toBeTruthy();
  });

  it("renders an away presence pip", () => {
    const { container } = render(
      <UserAvatar displayName="Katherine Johnson" compact presence="away" />,
    );

    expect(screen.getByRole("img", { name: "Katherine Johnson avatar, away" })).toBeTruthy();
    expect(container.querySelector("[data-presence='away']")).toBeTruthy();
  });

  it("applies a hashed color class for a user id", () => {
    const color = avatarColorForUserId("ada.lovelace");
    const { container } = render(<UserAvatar displayName="Ada Lovelace" compact color={color} />);

    expect(
      container.querySelector(`.user-avatar--colored.user-avatar--color-${color}`),
    ).toBeTruthy();
  });
});

describe("UserPresenceDot", () => {
  it("renders a standalone in-flow pip", () => {
    const { container } = render(<UserPresenceDot presence="online" standalone />);
    const dot = container.querySelector("[data-presence='online']");
    expect(dot).toBeTruthy();
    expect(dot?.className).toMatch(/user-avatar__presence--standalone/);
  });

  it("applies away and offline modifiers", () => {
    const { container, rerender } = render(<UserPresenceDot presence="away" standalone />);
    expect(container.querySelector(".user-avatar__presence--away")).toBeTruthy();

    rerender(<UserPresenceDot presence="offline" standalone />);
    expect(container.querySelector(".user-avatar__presence--offline")).toBeTruthy();
  });
});
