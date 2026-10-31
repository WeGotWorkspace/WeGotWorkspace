import { Button } from "@/button/src/button";
import { installerCopy as copy } from "@/installer-core/src/installer-copy";
import { InstallerHeadline } from "@/installer-core/src/installer-headline";
import { InstallerLayout } from "@/installer-core/src/installer-layout";
import { InstallerStatusDot } from "@/installer-core/src/installer-status-dot";

export type InstallerNotSecurePageProps = {
  includeDatabaseStep?: boolean;
  /** The admin read the warning and goes on over http anyway. */
  onContinue?: () => void;
};

function InstallerNotSecureTitle() {
  return (
    <>
      <InstallerHeadline italic="Not" noun="secure" />.
    </>
  );
}

/** Shown after Get started when the page is not a secure context: a warning, not a block. */
export function InstallerNotSecurePage({
  includeDatabaseStep = true,
  onContinue,
}: InstallerNotSecurePageProps) {
  return (
    <InstallerLayout
      title={<InstallerNotSecureTitle />}
      step="welcome"
      includeDatabaseStep={includeDatabaseStep}
    >
      <p className="installer__lead">{copy.notSecureLead}</p>
      <ul className="installer__checks" role="list" aria-label={copy.notSecureListLabel}>
        {copy.notSecureLosses.map((loss) => (
          <li key={loss} className="installer__check">
            <span className="installer__check-icon">
              <InstallerStatusDot status="warn" />
            </span>
            <div className="installer__check-label">{loss}</div>
          </li>
        ))}
      </ul>
      <p className="installer__hint">{copy.notSecureFix}</p>
      <div className="login-screen__actions">
        <Button
          type="button"
          label={copy.notSecureContinue}
          variant="primary"
          size="xl"
          pill
          className="login-screen__submit"
          onClick={onContinue}
        />
      </div>
    </InstallerLayout>
  );
}
