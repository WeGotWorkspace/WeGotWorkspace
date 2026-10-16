/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SharePrincipalSearchDropdown } from "@/share-ui/share-principal-search-dropdown";
import { avatarColorForUserId } from "@/user-avatar/src/user-avatar";

afterEach(() => {
  cleanup();
});

describe("SharePrincipalSearchDropdown", () => {
  it("paints group hits with the same UserAvatar mark as people", () => {
    render(
      <SharePrincipalSearchDropdown
        query="ad"
        results={[
          {
            id: "groups/administrators",
            displayName: "Administrators",
            principalType: "group",
          },
          { id: "member", displayName: "Member", principalType: "user" },
        ]}
        onSelect={() => {}}
      >
        <input aria-label="Add people or groups" />
      </SharePrincipalSearchDropdown>,
    );

    const group = screen.getByRole("img", { name: "Administrators avatar" });
    const person = screen.getByRole("img", { name: "Member avatar" });
    const groupAvatar = group.closest(".user-avatar");
    const personAvatar = person.closest(".user-avatar");

    expect(group.classList.contains("user-avatar__mark")).toBe(true);
    expect(person.classList.contains("user-avatar__mark")).toBe(true);
    expect(group.textContent).toBe("A");
    expect(person.textContent).toBe("M");
    expect(group.querySelector("svg")).toBeNull();
    expect(groupAvatar?.classList.contains("user-avatar--md")).toBe(true);
    expect(personAvatar?.classList.contains("user-avatar--md")).toBe(true);
    expect(groupAvatar?.classList.contains("share-principal-search-dropdown__mark")).toBe(true);
    expect(groupAvatar?.classList.contains("user-avatar--colored")).toBe(false);
    expect(group.closest(".share-dialog__principal-mark--group")).toBeNull();
    expect(
      personAvatar?.classList.contains(`user-avatar--color-${avatarColorForUserId("member")}`),
    ).toBe(true);
  });
});
