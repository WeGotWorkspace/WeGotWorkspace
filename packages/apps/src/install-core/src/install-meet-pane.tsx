import { Input } from "@/ui/input";
import { Card } from "@/card/src/card";
import { FieldLabelRow } from "@/ui/field-label-row";
import type { InstallControllerState } from "@/install-core/src/use-install-controller";
import { InstallFeatureRow } from "@/install-core/src/install-workspace-widgets";
import { installWorkspacePaneClasses as c } from "@/install-core/src/install-workspace.styles";

export function InstallMeetPane({
  controller,
}: {
  controller: Pick<InstallControllerState, "meet" | "setMeet">;
}) {
  const { meet, setMeet } = controller;

  return (
    <>
      <Card title="Meet">
        <InstallFeatureRow
          label="Enable Meet"
          desc="Configure STUN/TURN routing for real-time peer connections."
          value={meet.enabled}
          onChange={(value) => setMeet((current) => ({ ...current, enabled: value }))}
        />
      </Card>
      {meet.enabled ? (
        <>
          <Card title="STUN servers">
            <FieldLabelRow label="STUN URLs">
              <Input
                value={meet.stun}
                onChange={(event) =>
                  setMeet((current) => ({ ...current, stun: event.target.value }))
                }
                placeholder="stun:stun.nextcloud.com:443, stun:stun.sipgate.net:3478"
              />
            </FieldLabelRow>
            <p className="text-sm text-muted-foreground">
              Comma-separated URLs. You can replace or remove these defaults at any time.
            </p>
          </Card>
          <Card title="TURN server">
            <FieldLabelRow label="TURN URL">
              <Input
                value={meet.turn}
                onChange={(event) =>
                  setMeet((current) => ({ ...current, turn: event.target.value }))
                }
                placeholder="turn:turn.example.com:3478"
              />
            </FieldLabelRow>
            <div className={c.grid2}>
              <FieldLabelRow label="TURN username">
                <Input
                  value={meet.turnUser}
                  onChange={(event) =>
                    setMeet((current) => ({ ...current, turnUser: event.target.value }))
                  }
                />
              </FieldLabelRow>
              <FieldLabelRow label="TURN password">
                <Input
                  variant="password"
                  value={meet.turnPwd}
                  onChange={(event) =>
                    setMeet((current) => ({ ...current, turnPwd: event.target.value }))
                  }
                  placeholder="********"
                />
              </FieldLabelRow>
            </div>
          </Card>
        </>
      ) : null}
    </>
  );
}
