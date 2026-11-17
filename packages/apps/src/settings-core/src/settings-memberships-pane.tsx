import { Users } from "lucide-react";
import { SettingsPaneCard } from "@/settings-core/src/settings-pane-card";
import { Tag } from "@/tag/src/tag";
import type { SettingsGroup } from "@/lib/models/settings-types";
import { noTeamYetCopy } from "@/share-ui/share-labels";

export type SettingsMembershipsPaneProps = {
  groups: SettingsGroup[];
};

function memberCountLabel(count: number): string {
  return count === 1 ? "1 member" : `${count} members`;
}

/** The Teams the user is in: one row each, the Team's name and how many members it has. */
export function SettingsMembershipsPane({ groups }: SettingsMembershipsPaneProps) {
  return (
    <SettingsPaneCard>
      {groups.length === 0 ? (
        <p className="settings-memberships-pane__empty">{noTeamYetCopy}</p>
      ) : (
        <ul className="settings-team-list">
          {groups.map((group) => (
            <li key={group.id} className="settings-team-row">
              <span className="settings-team-row__icon" aria-hidden>
                <Users />
              </span>
              <span className="settings-team-row__name">{group.displayName}</span>
              <Tag label={memberCountLabel(group.memberCount)} />
            </li>
          ))}
        </ul>
      )}
    </SettingsPaneCard>
  );
}
