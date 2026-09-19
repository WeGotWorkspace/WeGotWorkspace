import { RefreshCw } from "lucide-react";
import { Button } from "@/button/src/button";
import { Card } from "@/card/src/card";
import type { InstallControllerState } from "@/install-core/src/use-install-controller";
import { InstallStatusDot } from "@/install-core/src/install-status-dot";
import { installWorkspacePaneClasses as c } from "@/install-core/src/install-workspace.styles";

export function InstallServerPane({
  controller,
}: {
  controller: Pick<
    InstallControllerState,
    | "checks"
    | "checkSummary"
    | "showChecks"
    | "setShowChecks"
    | "actionPending"
    | "refreshServerChecks"
  >;
}) {
  const { checks, checkSummary, showChecks, setShowChecks, actionPending, refreshServerChecks } =
    controller;

  return (
    <Card
      title="System checks"
      iconActions={[
        {
          label: "Re-run checks",
          onClick: () => void refreshServerChecks(),
          disabled: actionPending,
          icon: <RefreshCw className={`size-4 ${actionPending ? "animate-spin" : ""}`} />,
        },
      ]}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="install-text-subtle">{checkSummary}</p>
        <Button
          type="button"
          variant="ghost"
          className="h-8 px-2 text-xs"
          onClick={() => setShowChecks((value) => !value)}
        >
          {showChecks ? "Hide checks" : "Show checks"}
        </Button>
      </div>
      {showChecks ? (
        <ul className={c.checkList}>
          {checks.map((check) => (
            <li key={check.id} className={c.checkRow}>
              <span className={c.checkRowIcon}>
                <InstallStatusDot status={check.status} />
              </span>
              <div className="flex-1 min-w-0">
                <div className={c.checkRowLabel}>{check.label}</div>
                <div className={c.checkRowDetail}>{check.detail}</div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
