import { Card } from "@/card/src/card";
import { UserAvatar } from "@/user-avatar/src/user-avatar";
import type { SettingsGroup } from "@/settings-core/src/settings-types";

export type SettingsMembershipsPaneProps = {
  groups: SettingsGroup[];
};

export function SettingsMembershipsPane({ groups }: SettingsMembershipsPaneProps) {
  return (
    <Card title="Groups">
      <ul className="settings-group-list">
        {groups.map((group) => (
          <li key={group.id} className="settings-group-row">
            <UserAvatar
              displayName={group.displayName}
              subtitle={group.id}
              size="md"
              className="settings-group-avatar"
            />
          </li>
        ))}
      </ul>
    </Card>
  );
}
