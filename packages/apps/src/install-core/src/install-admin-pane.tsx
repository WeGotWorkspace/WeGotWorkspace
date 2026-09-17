import { Input } from "@/ui/input";
import { Card } from "@/card/src/card";
import { FieldLabelRow } from "@/ui/field-label-row";
import type { InstallControllerState } from "@/install-core/src/use-install-controller";
import { installWorkspacePaneClasses as c } from "@/install-core/src/install-workspace.styles";

export function InstallAdminPane({
  controller,
}: {
  controller: Pick<InstallControllerState, "admin" | "setAdmin">;
}) {
  const { admin, setAdmin } = controller;

  return (
    <Card title="Administrator account">
      <div className={c.grid2}>
        <FieldLabelRow label="Username">
          <Input
            value={admin.username}
            onChange={(event) =>
              setAdmin((current) => ({ ...current, username: event.target.value }))
            }
            placeholder="admin"
            autoComplete="off"
          />
        </FieldLabelRow>
        <FieldLabelRow label="Display name">
          <Input
            value={admin.displayName}
            onChange={(event) =>
              setAdmin((current) => ({ ...current, displayName: event.target.value }))
            }
            placeholder="Jane Doe"
          />
        </FieldLabelRow>
      </div>
      <FieldLabelRow label="Email address">
        <Input
          type="email"
          value={admin.email}
          onChange={(event) => setAdmin((current) => ({ ...current, email: event.target.value }))}
          placeholder="admin@example.com"
        />
      </FieldLabelRow>
      <div className={c.grid2}>
        <div className={c.fieldStack}>
          <FieldLabelRow label="Password">
            <Input
              variant="password"
              value={admin.password}
              onChange={(event) =>
                setAdmin((current) => ({ ...current, password: event.target.value }))
              }
              placeholder="********"
            />
          </FieldLabelRow>
          <p className={c.fieldHint}>At least 10 characters.</p>
        </div>
        <FieldLabelRow label="Confirm password">
          <Input
            variant="password"
            value={admin.password2}
            onChange={(event) =>
              setAdmin((current) => ({ ...current, password2: event.target.value }))
            }
            placeholder="********"
          />
        </FieldLabelRow>
      </div>
    </Card>
  );
}
