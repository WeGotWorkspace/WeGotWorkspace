import { SettingsPaneCard } from "@/settings-core/src/settings-pane-card";
import { ProjectsManagePane } from "@/settings-core/src/settings-projects-pane";
import type { SettingsGroup } from "@/lib/models/settings-types";
import type { ProjectsStore } from "@/lib/projects/projects-store";
import { noTeamYetCopy } from "@/share-ui/share-labels";

export type SettingsMembershipsPaneProps = {
  groups: SettingsGroup[];
  store?: ProjectsStore;
};

/** The Teams the user is in, each with its Projects, role and member count (#818). */
export function SettingsMembershipsPane({ groups, store }: SettingsMembershipsPaneProps) {
  if (groups.length === 0) {
    return (
      <SettingsPaneCard>
        <p className="settings-memberships-pane__empty">{noTeamYetCopy}</p>
      </SettingsPaneCard>
    );
  }
  return <ProjectsManagePane groups={groups} store={store} />;
}
