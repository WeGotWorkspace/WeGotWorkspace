import type { ReactElement } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DriveShareAtPath, DriveSharePrincipalEntry } from "@wgw/openapi-types/drive-types";
import { CalendarInviteesCard } from "@/calendar-core/src/calendar-invitees-card";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { SettingsMembershipsPane } from "@/settings-core/src/settings-memberships-pane";
import { viewerHasNoTeam } from "@/lib/sharing/collection-share";
import { CollectionShareSection } from "@/share-ui/collection-share-section";
import { noTeamYetCopy } from "@/share-ui/share-labels";
import { ShareTeamSection } from "@/share-ui/share-team-section";
import type { ShareMutations } from "@/share-ui/use-share-mutations";
import { TooltipProvider } from "@/ui/tooltip";

const COPY = {
  title: "Team access",
  hint: "Grant read or read-and-write access to people or groups.",
  placeholder: "Add people or groups…",
  empty: "No people or groups found",
  offline: "Sharing changes require a connection.",
  removeTitle: "Remove access?",
  removeConfirm: "This person or group will lose access. Continue?",
};

function renderWithTooltips(ui: ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

describe("viewerHasNoTeam", () => {
  it("is true only for a loaded, empty list of own Teams", () => {
    expect(viewerHasNoTeam([])).toBe(true);
    expect(viewerHasNoTeam([{ id: "groups/t1" }])).toBe(false);
    expect(viewerHasNoTeam(undefined)).toBe(false);
    expect(viewerHasNoTeam(null)).toBe(false);
  });
});

describe("collection share section without a Team", () => {
  it("says the viewer is not in a Team instead of the hint", () => {
    renderWithTooltips(
      <CollectionShareSection
        collectionId="list-1"
        copy={COPY}
        noTeam
        onSearchPrincipals={vi.fn().mockResolvedValue([])}
        onPatchShareWith={vi.fn()}
      />,
    );
    expect(screen.getByText(noTeamYetCopy)).toBeTruthy();
    expect(screen.queryByText(COPY.hint)).toBeNull();
  });

  it("keeps the hint for a viewer in a Team", () => {
    renderWithTooltips(
      <CollectionShareSection
        collectionId="list-1"
        copy={COPY}
        onSearchPrincipals={vi.fn().mockResolvedValue([])}
        onPatchShareWith={vi.fn()}
      />,
    );
    expect(screen.getByText(COPY.hint)).toBeTruthy();
    expect(screen.queryByText(noTeamYetCopy)).toBeNull();
  });
});

describe("Drive share section without a Team", () => {
  const atPath = {
    path: "/Documents",
    effectiveGrants: [],
    memberAccess: [],
  } as unknown as DriveShareAtPath;

  function mutationsReturning(entries: DriveSharePrincipalEntry[]): ShareMutations {
    return { searchPrincipals: vi.fn().mockResolvedValue(entries) } as unknown as ShareMutations;
  }

  it("says so when the viewer's own Teams come back empty", async () => {
    renderWithTooltips(<ShareTeamSection atPath={atPath} mutations={mutationsReturning([])} />);
    await waitFor(() => expect(screen.getByText(noTeamYetCopy)).toBeTruthy());
  });

  it("keeps the hint when the viewer has a Team", async () => {
    const mutations = mutationsReturning([
      { principal: "groups/t1", principalType: "group", displayName: "T1", memberCount: 2 },
    ]);
    renderWithTooltips(<ShareTeamSection atPath={atPath} mutations={mutations} />);
    await waitFor(() => expect(mutations.searchPrincipals).toHaveBeenCalledWith(""));
    expect(screen.queryByText(noTeamYetCopy)).toBeNull();
  });
});

describe("attendee picker without a Team", () => {
  it("says it in the description and the empty dropdown", () => {
    renderWithTooltips(
      <CalendarInviteesCard
        attendees={[]}
        invitees={[]}
        labels={defaultCalendarLabels}
        noTeam
        onChange={() => undefined}
      />,
    );
    expect(screen.getByText(noTeamYetCopy)).toBeTruthy();
  });

  it("keeps the email-unavailable hint next to the sentence", () => {
    renderWithTooltips(
      <CalendarInviteesCard
        attendees={[]}
        invitees={[]}
        labels={defaultCalendarLabels}
        noTeam
        canSubmitEmail={false}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByText(noTeamYetCopy)).toBeTruthy();
    expect(screen.getByText(defaultCalendarLabels.eventAttendeesEmailUnavailable)).toBeTruthy();
  });

  it("shows no note for an invitee who only reads the event", () => {
    renderWithTooltips(
      <CalendarInviteesCard
        attendees={[]}
        invitees={[]}
        labels={defaultCalendarLabels}
        noTeam
        readOnly
        onChange={() => undefined}
      />,
    );
    expect(screen.queryByText(noTeamYetCopy)).toBeNull();
  });
});

describe("Settings Teams pane", () => {
  it("says the viewer is not in a Team when there are no memberships", () => {
    render(<SettingsMembershipsPane groups={[]} />);
    expect(screen.getByText(noTeamYetCopy)).toBeTruthy();
  });

  it("lists memberships otherwise", () => {
    render(
      <SettingsMembershipsPane
        groups={[{ id: "principals/groups/t1", displayName: "Editorial" }]}
      />,
    );
    expect(screen.getByText("Editorial")).toBeTruthy();
    expect(screen.queryByText(noTeamYetCopy)).toBeNull();
  });
});
