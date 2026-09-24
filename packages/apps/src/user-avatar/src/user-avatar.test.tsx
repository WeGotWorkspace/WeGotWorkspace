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

  it("uses an explicit accessible name when ariaLabel is set", () => {
    render(<UserAvatar displayName="bob" compact ariaLabel="Signed in as bob" />);

    expect(screen.getByRole("img", { name: "Signed in as bob" }).textContent).toBe("B");
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

  it("applies native lazy-load attributes on photo imgs when requested", () => {
    const { container } = render(
      <UserAvatar
        displayName="Jane Doe"
        imageSrc="https://example.com/photos/jane.jpg"
        compact
        loading="lazy"
        decoding="async"
      />,
    );
    const img = container.querySelector("img.user-avatar__image");
    expect(img?.getAttribute("src")).toBe("https://example.com/photos/jane.jpg");
    expect(img?.getAttribute("loading")).toBe("lazy");
    expect(img?.getAttribute("decoding")).toBe("async");
  });

  it("keeps photo imgs eager when loading is omitted", () => {
    const { container } = render(
      <UserAvatar
        displayName="Jane Doe"
        imageSrc="https://example.com/photos/jane.jpg"
        compact
        size="xl"
      />,
    );
    const img = container.querySelector("img.user-avatar__image");
    expect(img).toBeTruthy();
    expect(img?.getAttribute("loading")).toBeNull();
    expect(img?.getAttribute("decoding")).toBeNull();
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

  it("applies the xs size class for collab / share marks", () => {
    const { container } = render(<UserAvatar displayName="Sam Lee" compact size="xs" />);
    expect(container.querySelector(".user-avatar--xs")).toBeTruthy();
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
