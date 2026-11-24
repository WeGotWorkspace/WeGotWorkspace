// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeamMembersCard, type TeamMembersCardMember } from "@/share-ui/team-members-card";
import { teamMembersLabels as labels } from "@/share-ui/team-members-labels";
import { TooltipProvider } from "@/ui/tooltip";

afterEach(cleanup);

function member(username: string, isTeamAdmin: boolean): TeamMembersCardMember {
  return { id: username, username, displayName: username, isTeamAdmin };
}

function renderCard(members: TeamMembersCardMember[]) {
  render(
    <TooltipProvider>
      <TeamMembersCard
        members={members}
        query=""
        onQueryChange={vi.fn()}
        candidates={[]}
        onAdd={vi.fn()}
        onRoleChange={vi.fn()}
        onRemove={vi.fn()}
      />
    </TooltipProvider>,
  );
}

describe("TeamMembersCard", () => {
  it("locks the role and the remove control of the only team admin, and says why", () => {
    renderCard([member("ada", true), member("bo", false)]);
    expect(
      (screen.getByRole("button", { name: labels.removeLabel("ada") }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: labels.removeLabel("bo") }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(screen.getByText(labels.soleTeamAdminHint)).toBeTruthy();
  });

  it("keeps everything open with two team admins", () => {
    renderCard([member("ada", true), member("bo", true)]);
    expect(
      (screen.getByRole("button", { name: labels.removeLabel("ada") }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(screen.queryByText(labels.soleTeamAdminHint)).toBeNull();
  });

  it("locks nothing when the Team has no team admin yet", () => {
    renderCard([member("ada", false)]);
    expect(
      (screen.getByRole("button", { name: labels.removeLabel("ada") }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
});
