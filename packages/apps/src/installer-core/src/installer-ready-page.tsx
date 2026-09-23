import { Button } from "@/button/src/button";
import { installerCopy as copy } from "@/installer-core/src/installer-copy";
import { InstallerHeadline } from "@/installer-core/src/installer-headline";
import { InstallerLayout } from "@/installer-core/src/installer-layout";

export type InstallerReadyPageProps = {
  includeDatabaseStep?: boolean;
  opening?: boolean;
  onOpenWorkspace?: () => void;
};

function InstallerReadyPageTitle() {
  return <InstallerHeadline italic="You" noun="got workspace" />;
}

export function InstallerReadyPage({
  includeDatabaseStep = true,
  opening = false,
  onOpenWorkspace,
}: InstallerReadyPageProps) {
  return (
    <InstallerLayout
      title={<InstallerReadyPageTitle />}
      step="ready"
      includeDatabaseStep={includeDatabaseStep}
    >
      <p className="installer__lead">{copy.readyLead}</p>
      <div className="login-screen__actions">
        <Button
          type="button"
          label={copy.openWorkspace}
          variant="primary"
          size="xl"
          pill
          className="login-screen__submit"
          disabled={opening}
          onClick={onOpenWorkspace}
        />
      </div>
    </InstallerLayout>
  );
}
