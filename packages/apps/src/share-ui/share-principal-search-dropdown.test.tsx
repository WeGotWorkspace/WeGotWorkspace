/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SharePrincipalSearchDropdown } from "@/share-ui/share-principal-search-dropdown";
import { avatarColorForUserId } from "@/user-avatar/src/user-avatar";

afterEach(() => {
  cleanup();
});

describe("SharePrincipalSearchDropdown", () => {
  it("paints a group with the same mark as the share row", () => {
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
    expect(group.querySelector("svg")).not.toBeNull();
    expect(person.querySelector("svg")).toBeNull();
    expect(person.textContent).toBe("M");
    expect(groupAvatar?.classList.contains("user-avatar--md")).toBe(true);
    expect(personAvatar?.classList.contains("user-avatar--md")).toBe(true);
    expect(groupAvatar?.classList.contains("share-principal-search-dropdown__mark")).toBe(true);
    expect(groupAvatar?.classList.contains("share-dialog__principal-mark--group")).toBe(true);
    expect(groupAvatar?.classList.contains("user-avatar--colored")).toBe(false);
    expect(
      personAvatar?.classList.contains(`user-avatar--color-${avatarColorForUserId("member")}`),
    ).toBe(true);
  });
});
