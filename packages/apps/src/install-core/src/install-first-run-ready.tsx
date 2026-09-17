import { Button } from "@/button/src/button";
import { installFirstRunCopy as copy } from "@/install-core/src/install-first-run-copy";
import { InstallFirstRunHero } from "@/install-core/src/install-first-run-hero";
import { InstallFirstRunPage } from "@/install-core/src/install-first-run-page";

export type InstallFirstRunReadyProps = {
  includeDatabaseStep?: boolean;
  onOpenWorkspace?: () => void;
  onOpenServerSettings?: () => void;
};

function InstallFirstRunReadyTitle() {
  return <InstallFirstRunHero italic="You" noun="got workspace" />;
}

export function InstallFirstRunReady({
  includeDatabaseStep = true,
  onOpenWorkspace,
  onOpenServerSettings,
}: InstallFirstRunReadyProps) {
  return (
    <InstallFirstRunPage
      title={<InstallFirstRunReadyTitle />}
      step="ready"
      includeDatabaseStep={includeDatabaseStep}
    >
      <p className="install-first-run__lead">{copy.readyLead}</p>
      <div className="login-screen__actions">
        <Button
          type="button"
          label={copy.openWorkspace}
          variant="primary"
          size="xl"
          pill
          className="login-screen__submit"
          onClick={onOpenWorkspace}
        />
      </div>
      <p className="install-first-run__secondary">
        <button
          type="button"
          className="install-first-run__text-button"
          onClick={onOpenServerSettings}
        >
          {copy.serverSettings}
        </button>
      </p>
    </InstallFirstRunPage>
  );
}
