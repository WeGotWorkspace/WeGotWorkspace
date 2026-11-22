// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMockTeamMembersOperations } from "@/lib/api/mock/team-members";
import { SettingsMembershipsPane } from "@/settings-core/src/settings-memberships-pane";
import type { SettingsGroup } from "@/lib/models/settings-types";
import { TooltipProvider } from "@/ui/tooltip";

const GROUPS: SettingsGroup[] = [
  {
    id: "principals/groups/editorial",
    displayName: "Editorial Team",
    memberCount: 6,
    isTeamAdmin: true,
  },
  {
    id: "principals/groups/studio",
    displayName: "Studio Crew",
    memberCount: 4,
    isTeamAdmin: false,
  },
];

function renderPane() {
  const operations = createMockTeamMembersOperations();
  render(
    <TooltipProvider>
      <SettingsMembershipsPane
        groups={GROUPS}
        currentUsername="demo.user"
        operations={operations}
      />
    </TooltipProvider>,
  );
  return operations;
}

async function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: "Manage members of Editorial Team" }));
  const dialog = await screen.findByRole("dialog", { name: "Edit Editorial Team" });
  await within(dialog).findByText("Grace Hopper");
  return dialog;
}

describe("Settings Teams pane for a team admin (#2278)", () => {
  it("offers Manage members only on the Teams the user runs", () => {
    renderPane();

    expect(screen.getByRole("button", { name: "Manage members of Editorial Team" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Manage members of Studio Crew" })).toBeNull();
  });

  it("adds someone found by the search and updates the member count", async () => {
    const operations = renderPane();
    const dialog = await openDialog();

    fireEvent.change(within(dialog).getByPlaceholderText("Add by name or email"), {
      target: { value: "soph" },
    });
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Sophie Wilson/ }));

    await within(dialog).findByText("Sophie Wilson");
    expect((await operations.listMembers("editorial")).map((m) => m.username)).toContain("sophie");
    await waitFor(() => expect(screen.getByTitle("7 members")).toBeTruthy());
  });

  it("does not offer someone who is already a member", async () => {
    renderPane();
    const dialog = await openDialog();

    fireEvent.change(within(dialog).getByPlaceholderText("Add by name or email"), {
      target: { value: "grace" },
    });

    expect(await screen.findByText("No one found")).toBeTruthy();
  });

  it("removes a member after a confirmation", async () => {
    const operations = renderPane();
    const dialog = await openDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: "Remove Katherine Johnson" }));
    const confirm = await screen.findByRole("alertdialog", {
      name: "Remove Katherine Johnson from Editorial Team?",
    });
    fireEvent.click(within(confirm).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(within(dialog).queryByText("Katherine Johnson")).toBeNull());
    expect((await operations.listMembers("editorial")).map((m) => m.username)).not.toContain(
      "katherine",
    );
  });

  it("drops the Team from the list when the user leaves it", async () => {
    renderPane();
    const dialog = await openDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: "Remove Demo User" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Leave Editorial Team?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Leave" }));

    await waitFor(() => expect(screen.queryByText("Editorial Team")).toBeNull());
    expect(screen.getByText("Studio Crew")).toBeTruthy();
  });

  it("shows the server's message when a change is refused", async () => {
    const operations = createMockTeamMembersOperations();
    operations.removeMember = async () => {
      throw new Error("DELETE /teams/editorial/members/grace failed (404): Team not found.");
    };
    render(
      <TooltipProvider>
        <SettingsMembershipsPane
          groups={GROUPS}
          currentUsername="demo.user"
          operations={operations}
        />
      </TooltipProvider>,
    );
    const dialog = await openDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: "Remove Grace Hopper" }));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Remove" }),
    );

    expect((await within(dialog).findByRole("alert")).textContent).toContain("Team not found");
    expect(within(dialog).getByText("Grace Hopper")).toBeTruthy();
  });
});
