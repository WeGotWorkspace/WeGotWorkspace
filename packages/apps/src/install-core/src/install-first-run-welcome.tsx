import { Button } from "@/button/src/button";
import { installFirstRunCopy as copy } from "@/install-core/src/install-first-run-copy";
import { InstallFirstRunHero } from "@/install-core/src/install-first-run-hero";
import { InstallFirstRunPage } from "@/install-core/src/install-first-run-page";

export type InstallFirstRunWelcomeProps = {
  onGetStarted?: () => void;
  includeDatabaseStep?: boolean;
};

function InstallFirstRunWelcomeTitle() {
  return (
    <>
      <InstallFirstRunHero italic="Your" noun="work" />
      {". "}
      <InstallFirstRunHero italic="Your" noun="space" />.
    </>
  );
}

export function InstallFirstRunWelcome({
  onGetStarted,
  includeDatabaseStep = true,
}: InstallFirstRunWelcomeProps) {
  return (
    <InstallFirstRunPage
      title={<InstallFirstRunWelcomeTitle />}
      step="welcome"
      includeDatabaseStep={includeDatabaseStep}
    >
      <p className="install-first-run__lead">{copy.welcomeLead}</p>
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
    </InstallFirstRunPage>
  );
}
