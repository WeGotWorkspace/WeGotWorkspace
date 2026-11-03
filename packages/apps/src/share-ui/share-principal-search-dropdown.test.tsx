/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { SharePrincipalSearchDropdown } from "@/share-ui/share-principal-search-dropdown";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/ui/dialog";
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

  it("closes on Escape, then the next Escape closes the dialog (#1699)", () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      const [query, setQuery] = useState("mem");
      return (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogTitle>Share</DialogTitle>
            <DialogDescription>Invite teammates.</DialogDescription>
            <SharePrincipalSearchDropdown
              query={query}
              results={[{ id: "member", displayName: "Member", principalType: "user" }]}
              onSelect={() => {}}
            >
              <input
                aria-label="Add people or groups"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </SharePrincipalSearchDropdown>
          </DialogContent>
        </Dialog>
      );
    }

    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "Add people or groups" });
    input.focus();
    expect(screen.getByRole("listbox")).toBeTruthy();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.change(input, { target: { value: "memb" } });
    expect(screen.getByRole("listbox")).toBeTruthy();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
