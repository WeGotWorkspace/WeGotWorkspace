import { useDocumentTitle } from "@/lib/document-title";
import { InstallFirstRunAccount } from "@/install-core/src/install-first-run-account";
import { InstallFirstRunDatabase } from "@/install-core/src/install-first-run-database";
import { InstallFirstRunReady } from "@/install-core/src/install-first-run-ready";
import { InstallFirstRunServerAttention } from "@/install-core/src/install-first-run-server";
import { InstallFirstRunWelcome } from "@/install-core/src/install-first-run-welcome";
import { useInstallFirstRunController } from "@/install-core/src/use-install-first-run-controller";
import type { InstallWorkspaceProps } from "@/install-core/src/install-workspace-props";

export type InstallFirstRunWorkspaceProps = InstallWorkspaceProps & {
  onOpenWorkspace?: () => void;
  onOpenServerSettings?: () => void;
};

const SCREEN_TITLES = {
  welcome: "Install",
  database: "Your database",
  account: "Your account",
  ready: "You got workspace",
  interrupt: "Needs attention",
} as const;

export function InstallFirstRunWorkspace({
  data,
  operations,
  onOpenWorkspace,
  onOpenServerSettings,
}: InstallFirstRunWorkspaceProps) {
  const controller = useInstallFirstRunController({ data, operations });
  useDocumentTitle(SCREEN_TITLES[controller.screen]);

  if (controller.screen === "interrupt") {
    return (
      <InstallFirstRunServerAttention
        checks={controller.checks}
        rechecking={controller.actionPending}
        onRerun={() => void controller.rerunChecks()}
      />
    );
  }

  if (controller.screen === "database") {
    return (
      <InstallFirstRunDatabase
        initialEngine={controller.defaultEngine}
        initialMysql={{
          host: controller.installerState?.db.mysql_host,
          port:
            controller.installerState?.db.mysql_port != null
              ? String(controller.installerState.db.mysql_port)
              : undefined,
          database: controller.installerState?.db.mysql_db,
          username: controller.installerState?.db.mysql_user,
        }}
        onContinue={(values) => void controller.continueDatabase(values)}
      />
    );
  }

  if (controller.screen === "account") {
    return (
      <InstallFirstRunAccount
        includeDatabaseStep={controller.includeDatabaseStep}
        initialUsername={controller.installerState?.admin_username}
        usernameTaken={controller.usernameTaken}
        installing={controller.installing}
        progressStepIndex={controller.progressStepIndex}
        onCreateWorkspace={(values) => void controller.createWorkspace(values)}
      />
    );
  }

  if (controller.screen === "ready") {
    return (
      <InstallFirstRunReady
        includeDatabaseStep={controller.includeDatabaseStep}
        onOpenWorkspace={onOpenWorkspace}
        onOpenServerSettings={onOpenServerSettings}
      />
    );
  }

  return (
    <InstallFirstRunWelcome
      includeDatabaseStep={controller.includeDatabaseStep}
      onGetStarted={() => void controller.startSetup()}
    />
  );
}
