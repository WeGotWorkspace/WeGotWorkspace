import { Button } from "@/button/src/button";
import { installFirstRunCopy as copy } from "@/install-core/src/install-first-run-copy";
import { InstallFirstRunHero } from "@/install-core/src/install-first-run-hero";
import { InstallFirstRunPage } from "@/install-core/src/install-first-run-page";
import { InstallStatusDot } from "@/install-core/src/install-status-dot";
import type { InstallServerCheck } from "@/install-core/src/install-types";

export type InstallFirstRunServerAttentionProps = {
  checks: InstallServerCheck[];
  rechecking?: boolean;
  onRerun?: () => void;
};

function InstallFirstRunServerTitle() {
  return (
    <>
      <InstallFirstRunHero italic="Needs" noun="attention" />.
    </>
  );
}

export function InstallFirstRunServerAttention({
  checks,
  rechecking = false,
  onRerun,
}: InstallFirstRunServerAttentionProps) {
  const blocking = checks.filter((check) => check.status === "error");

  return (
    <InstallFirstRunPage title={<InstallFirstRunServerTitle />} step="interrupt">
      <p className="install-first-run__lead">{copy.serverLead}</p>
      <ul className="install-first-run__checks" role="list">
        {blocking.map((check) => (
          <li key={check.id} className="install-first-run__check">
            <InstallStatusDot status={check.status} />
            <div>
              <div className="install-first-run__check-label">{check.label}</div>
              <div className="install-first-run__check-detail">{check.detail}</div>
            </div>
          </li>
        ))}
      </ul>
      <div className="login-screen__actions">
        <Button
          type="button"
          label={rechecking ? copy.rerunChecksBusy : copy.rerunChecks}
          variant="primary"
          size="xl"
          pill
          className="login-screen__submit"
          disabled={rechecking}
          onClick={onRerun}
        />
      </div>
    </InstallFirstRunPage>
  );
}
