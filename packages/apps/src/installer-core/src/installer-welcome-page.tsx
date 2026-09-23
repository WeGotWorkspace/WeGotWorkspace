import { Button } from "@/button/src/button";
import { installerCopy as copy } from "@/installer-core/src/installer-copy";
import { InstallerHeadline } from "@/installer-core/src/installer-headline";
import { InstallerLayout } from "@/installer-core/src/installer-layout";

export type InstallerWelcomePageProps = {
  onGetStarted?: () => void;
  includeDatabaseStep?: boolean;
};

function InstallerWelcomePageTitle() {
  return (
    <>
      <InstallerHeadline italic="Your" noun="work" />
      {". "}
      <InstallerHeadline italic="Your" noun="space" />.
    </>
  );
}

export function InstallerWelcomePage({
  onGetStarted,
  includeDatabaseStep = true,
}: InstallerWelcomePageProps) {
  return (
    <InstallerLayout
      title={<InstallerWelcomePageTitle />}
      step="welcome"
      includeDatabaseStep={includeDatabaseStep}
    >
      <p className="installer__lead">{copy.welcomeLead}</p>
      <div className="login-screen__actions">
        <Button
          type="button"
          label={copy.getStarted}
          variant="primary"
          size="xl"
          pill
          className="login-screen__submit"
          onClick={onGetStarted}
        />
      </div>
    </InstallerLayout>
  );
}
