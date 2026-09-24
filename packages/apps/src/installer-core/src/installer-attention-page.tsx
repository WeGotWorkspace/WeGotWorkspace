import { Button } from "@/button/src/button";
import { installerCopy as copy } from "@/installer-core/src/installer-copy";
import { InstallerHeadline } from "@/installer-core/src/installer-headline";
import { InstallerLayout } from "@/installer-core/src/installer-layout";
import { InstallerStatusDot } from "@/installer-core/src/installer-status-dot";
import type { InstallerServerCheck } from "@/installer-core/src/installer-types";

export type InstallerAttentionPageProps = {
  checks: InstallerServerCheck[];
  rechecking?: boolean;
  onRerun?: () => void;
};

function InstallerAttentionTitle() {
  return (
    <>
      <InstallerHeadline italic="Needs" noun="attention" />.
    </>
  );
}

export function InstallerAttentionPage({
  checks,
  rechecking = false,
  onRerun,
}: InstallerAttentionPageProps) {
  const blocking = checks.filter((check) => check.status === "error");

  return (
    <InstallerLayout title={<InstallerAttentionTitle />} step="interrupt">
      <p className="installer__lead">{copy.serverLead}</p>
      <ul className="installer__checks" role="list">
        {blocking.map((check) => (
          <li key={check.id} className="installer__check">
            <span className="installer__check-icon">
              <InstallerStatusDot status={check.status} />
            </span>
            <div>
              <div className="installer__check-label">{check.label}</div>
              <div className="installer__check-detail">{check.detail}</div>
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
    </InstallerLayout>
  );
}
