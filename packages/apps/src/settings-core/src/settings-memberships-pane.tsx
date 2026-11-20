import { useState } from "react";
import { Pencil } from "lucide-react";
import { SettingsPaneCard } from "@/settings-core/src/settings-pane-card";
import { SettingsTeamMembersDialog } from "@/settings-core/src/settings-team-members-dialog";
import { teamMembersLabels as labels } from "@/share-ui/team-members-labels";
import { defaultTeamMembersOperations } from "@/settings-core/src/settings-team-members-source";
import { AvatarList, AvatarListAction, AvatarListRow } from "@/ui/avatar-list";
import type { TeamMembersOperations } from "@/lib/api/wgw/teams";
import type { SettingsGroup } from "@/lib/models/settings-types";
import { noTeamYetCopy } from "@/share-ui/share-labels";

export type SettingsMembershipsPaneProps = {
  groups: SettingsGroup[];
  /** The signed-in user. */
  currentUsername: string;
  /** Member management for the Teams the user is team admin of. Defaults to the live or mock source. */
  operations?: TeamMembersOperations;
};

const GROUP_PREFIX = "principals/groups/";

function memberCountLabel(count: number): string {
  return count === 1 ? "1 member" : `${count} members`;
}

function teamSlug(group: SettingsGroup): string {
  return group.id.startsWith(GROUP_PREFIX) ? group.id.slice(GROUP_PREFIX.length) : group.id;
}

/**
 * The Teams the user is in, as the Teams list in Admin shows them: one row each, the name
 * with the member count under it. A team admin gets the edit button on the Teams they run (#2278).
 */
export function SettingsMembershipsPane({
  groups,
  currentUsername,
  operations,
}: SettingsMembershipsPaneProps) {
  const [source] = useState(() => operations ?? defaultTeamMembersOperations());
  const [managing, setManaging] = useState<SettingsGroup | null>(null);
  // Counts after a change in the dialog; the settings state is not re-read for it.
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});
  const [left, setLeft] = useState<Record<string, true>>({});
  const visible = groups.filter((group) => !left[group.id]);

  return (
    <SettingsPaneCard>
      {visible.length === 0 ? (
        <p className="settings-memberships-pane__empty">{noTeamYetCopy}</p>
      ) : (
        <AvatarList>
          {visible.map((group) => (
            <AvatarListRow
              key={group.id}
              displayName={group.displayName}
              subtitle={memberCountLabel(memberCounts[group.id] ?? group.memberCount)}
            >
              {group.isTeamAdmin ? (
                <AvatarListAction
                  label={labels.manageOf(group.displayName)}
                  icon={<Pencil className="size-4" />}
                  onClick={() => setManaging(group)}
                />
              ) : null}
            </AvatarListRow>
          ))}
        </AvatarList>
      )}
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
    </SettingsPaneCard>
  );
}
