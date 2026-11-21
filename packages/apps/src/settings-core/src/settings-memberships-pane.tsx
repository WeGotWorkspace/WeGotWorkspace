import { useState } from "react";
import { SettingsPaneCard } from "@/settings-core/src/settings-pane-card";
import { SettingsTeamMembersDialog } from "@/settings-core/src/settings-team-members-dialog";
import { teamMembersLabels as labels } from "@/share-ui/team-members-labels";
import { defaultTeamMembersOperations } from "@/settings-core/src/settings-team-members-source";
import type { TeamMembersOperations } from "@/lib/api/wgw/teams";
import { ProjectsManagePane } from "@/settings-core/src/settings-projects-pane";
import type { SettingsGroup } from "@/lib/models/settings-types";
import type { ProjectsStore } from "@/lib/projects/projects-store";
import { noTeamYetCopy } from "@/share-ui/share-labels";

export type SettingsMembershipsPaneProps = {
  groups: SettingsGroup[];
  /** The signed-in user. */
  currentUsername: string;
  /** Member management for the Teams the user is team admin of. Defaults to the live or mock source. */
  operations?: TeamMembersOperations;
  store?: ProjectsStore;
};

const GROUP_PREFIX = "principals/groups/";

function teamSlug(group: SettingsGroup): string {
  return group.id.startsWith(GROUP_PREFIX) ? group.id.slice(GROUP_PREFIX.length) : group.id;
}

/**
 * The Teams the user is in, each with its Projects (#818), its role and member count. A team
 * admin can manage the members of the Teams they run (#2278) and the Projects of those Teams.
 */
export function SettingsMembershipsPane({
  groups,
  currentUsername,
  operations,
  store,
}: SettingsMembershipsPaneProps) {
  const [source] = useState(() => operations ?? defaultTeamMembersOperations());
  const [managing, setManaging] = useState<SettingsGroup | null>(null);
  // Counts after a change in the dialog; the settings state is not re-read for it.
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});
  const [left, setLeft] = useState<Record<string, true>>({});
  const visible = groups.filter((group) => !left[group.id]);

  if (visible.length === 0) {
    return (
      <SettingsPaneCard>
        <p className="settings-memberships-pane__empty">{noTeamYetCopy}</p>
      </SettingsPaneCard>
    );
  }

  return (
    <>
      <ProjectsManagePane
        groups={visible}
        store={store}
        memberCounts={memberCounts}
        onManageMembers={setManaging}
      />
      <SettingsTeamMembersDialog
        open={managing !== null}
        team={managing ? { slug: teamSlug(managing), displayName: managing.displayName } : null}
        currentUsername={currentUsername}
        operations={source}
        onOpenChange={(next) => !next && setManaging(null)}
        onMembersChange={(slug, members) => {
          const group = groups.find((entry) => teamSlug(entry) === slug);
          if (!group) return;
          if (members.length === 0) {
            setLeft((prev) => ({ ...prev, [group.id]: true }));
            return;
          }
          setMemberCounts((prev) => ({ ...prev, [group.id]: members.length }));
        }}
      />
    </>
  );
}
