import { useDocumentTitle } from "@/lib/document-title";
import { InstallerAccountPage } from "@/installer-core/src/installer-account-page";
import { InstallerDatabasePage } from "@/installer-core/src/installer-database-page";
import { InstallerReadyPage } from "@/installer-core/src/installer-ready-page";
import { InstallerAttentionPage } from "@/installer-core/src/installer-attention-page";
import { InstallerWelcomePage } from "@/installer-core/src/installer-welcome-page";
import { useInstallerController } from "@/installer-core/src/use-installer-controller";
import type { InstallerWorkspaceProps } from "@/installer-core/src/installer-workspace-props";

export type { InstallerWorkspaceProps };

const SCREEN_TITLES = {
  welcome: "Installer",
  database: "Your data",
  account: "Your account",
  ready: "You got workspace",
  interrupt: "Needs attention",
} as const;

export function InstallerWorkspace({
  data,
  operations,
  onOpenWorkspace,
  onAdminSignedIn,
}: InstallerWorkspaceProps) {
  const controller = useInstallerController({
    data,
    operations,
    onOpenWorkspace,
    onAdminSignedIn,
  });
  useDocumentTitle(SCREEN_TITLES[controller.screen]);

  if (controller.screen === "interrupt") {
    return (
      <InstallerAttentionPage
        checks={controller.checks}
        rechecking={controller.actionPending}
        onRerun={() => void controller.rerunChecks()}
      />
    );
  }

  if (controller.screen === "database") {
    return (
      <InstallerDatabasePage
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
        dataDirPath={controller.installerState?.data_dir?.path}
        dataDirReason={controller.installerState?.data_dir?.reason}
        dataDirInsideWebRoot={controller.installerState?.data_dir?.inside_web_root}
        connectionError={controller.databaseError}
        connectionErrorCode={controller.databaseErrorCode}
        onContinue={(values) => void controller.continueDatabase(values)}
      />
    );
  }

  if (controller.screen === "account") {
    return (
      <InstallerAccountPage
        includeDatabaseStep={controller.includeDatabaseStep}
        initialUsername={controller.installerState?.admin_username}
        initialEmail={controller.installerState?.admin_email}
        usernameTaken={controller.usernameTaken}
        installing={controller.installing}
        onCreateWorkspace={(values) => void controller.createWorkspace(values)}
      />
    );
  }

  if (controller.screen === "ready") {
    return (
      <InstallerReadyPage
        includeDatabaseStep={controller.includeDatabaseStep}
        opening={controller.openingWorkspace}
        onOpenWorkspace={() => void controller.openWorkspace()}
      />
    );
  }

  return (
    <InstallerWelcomePage
      includeDatabaseStep={controller.includeDatabaseStep}
      onGetStarted={() => void controller.startSetup()}
    />
  );
}
