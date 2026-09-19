import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { InstallFirstRunAccountValues } from "@/install-core/src/install-first-run-account";
import type { InstallFirstRunDatabaseValues } from "@/install-core/src/install-first-run-database";
import {
  buildFirstRunDatabasePayload,
  buildFirstRunInstallPayload,
  buildFirstRunSitePayload,
  firstRunBlockingChecks,
  firstRunDefaultEngine,
  firstRunScreenFromState,
  formatInstallDatabaseError,
  installerHasDatabaseFromEnv,
  isUsernameTakenError,
  type InstallFirstRunScreen,
} from "@/install-core/src/install-first-run-flow";
import type {
  WgwInstallerActionResponse,
  WgwInstallerRuntimeState,
} from "@/install-core/src/install-types";
import type { InstallWorkspaceProps } from "@/install-core/src/install-workspace-props";
import { wgwLoginWithCredentials } from "@/lib/api/wgw/http";

export function useInstallFirstRunController({
  data,
  operations,
}: Pick<InstallWorkspaceProps, "data" | "operations">) {
  const [installerState, setInstallerState] = useState<WgwInstallerRuntimeState | null>(data.state);
  const [screen, setScreen] = useState<InstallFirstRunScreen>(() =>
    firstRunScreenFromState(data.state),
  );
  const [actionPending, setActionPending] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [usernameTaken, setUsernameTaken] = useState(false);
  const [databaseError, setDatabaseError] = useState<string | null>(null);
  const [openingWorkspace, setOpeningWorkspace] = useState(false);
  const freshAdminRef = useRef<{ username: string; password: string } | null>(null);

  useEffect(() => {
    if (!data.state) return;
    setInstallerState(data.state);
    setScreen(firstRunScreenFromState(data.state));
  }, [data.state]);

  const includeDatabaseStep = !installerHasDatabaseFromEnv(installerState);
  const checks = useMemo(() => firstRunBlockingChecks(installerState), [installerState]);
  const defaultEngine = firstRunDefaultEngine(installerState);

  const applyState = useCallback((state: WgwInstallerRuntimeState | undefined) => {
    if (!state) return;
    setInstallerState(state);
  }, []);

  const runAction = useCallback(
    async (fn: () => Promise<WgwInstallerActionResponse>): Promise<WgwInstallerActionResponse> => {
      const response = await fn();
      applyState(response.state);
      if (!response.ok) {
        throw new Error(response.error || response.state?.flash || "Installer action failed.");
      }
      return response;
    },
    [applyState],
  );

  const persistDatabase = useCallback(
    async (values?: InstallFirstRunDatabaseValues) => {
      if (!operations) return;
      const engine = values?.engine ?? defaultEngine;
      const mysql = values && values.engine === "mysql" ? values.mysql : undefined;
      await runAction(() =>
        operations.databaseNext(buildFirstRunDatabasePayload(engine, installerState, mysql)),
      );
    },
    [defaultEngine, installerState, operations, runAction],
  );

  const startSetup = useCallback(async () => {
    if (!operations || actionPending) return;
    setActionPending(true);
    try {
      await runAction(() => operations.welcomeNext());
      const driver = includeDatabaseStep ? "mysql" : (installerState?.db_driver ?? "mysql");
      const checked = await runAction(() => operations.requirementsCheck({ db_driver: driver }));
      if (firstRunBlockingChecks(checked.state ?? null).length > 0) {
        setScreen("interrupt");
        return;
      }
      if (!includeDatabaseStep) {
        await persistDatabase();
        setScreen("account");
        return;
      }
      setScreen("database");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start setup.");
    } finally {
      setActionPending(false);
    }
  }, [
    actionPending,
    includeDatabaseStep,
    installerState?.db_driver,
    operations,
    persistDatabase,
    runAction,
  ]);

  const continueDatabase = useCallback(
    async (values: InstallFirstRunDatabaseValues) => {
      if (!operations || actionPending) return;
      setActionPending(true);
      setDatabaseError(null);
      try {
        if (values.engine === "mysql") {
          const test = await runAction(() =>
            operations.databaseTest(
              buildFirstRunDatabasePayload("mysql", installerState, values.mysql),
            ),
          );
          if (!test.ok) return;
        }
        await persistDatabase(values);
        setScreen("account");
      } catch (error) {
        const raw = error instanceof Error ? error.message : "Could not save the database.";
        setDatabaseError(formatInstallDatabaseError(raw));
      } finally {
        setActionPending(false);
      }
    },
    [actionPending, installerState, operations, persistDatabase, runAction],
  );

  const createWorkspace = useCallback(
    async (values: InstallFirstRunAccountValues) => {
      if (!operations || actionPending || installing) return;
      setUsernameTaken(false);
      setActionPending(true);
      setInstalling(true);
      try {
        if (includeDatabaseStep === false && installerState?.step !== "site") {
          await persistDatabase();
        }
        await runAction(() => operations.siteNext(buildFirstRunSitePayload(installerState)));
        await runAction(() =>
          operations.install(
            buildFirstRunInstallPayload(values.username, values.password, values.email),
          ),
        );
        setScreen("ready");
        freshAdminRef.current = { username: values.username, password: values.password };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not create the workspace.";
        if (isUsernameTakenError(message)) {
          setUsernameTaken(true);
        } else {
          toast.error(message);
        }
      } finally {
        setInstalling(false);
        setActionPending(false);
      }
    },
    [
      actionPending,
      includeDatabaseStep,
      installerState,
      installing,
      operations,
      persistDatabase,
      runAction,
    ],
  );

  const openWorkspace = useCallback(
    async (fallback?: () => void) => {
      if (openingWorkspace) return;
      const credentials = freshAdminRef.current;
      if (!credentials) {
        fallback?.();
        return;
      }
      setOpeningWorkspace(true);
      try {
        await wgwLoginWithCredentials(credentials.username, credentials.password);
        freshAdminRef.current = null;
        window.location.assign("/");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not sign in.");
      } finally {
        setOpeningWorkspace(false);
      }
    },
    [openingWorkspace],
  );

  const rerunChecks = useCallback(async () => {
    if (!operations || actionPending) return;
    setActionPending(true);
    try {
      const driver = installerState?.db_driver ?? "mysql";
      const checked = await runAction(() => operations.requirementsCheck({ db_driver: driver }));
      if (firstRunBlockingChecks(checked.state ?? null).length === 0) {
        setScreen(includeDatabaseStep ? "database" : "account");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not re-run checks.");
    } finally {
      setActionPending(false);
    }
  }, [actionPending, includeDatabaseStep, installerState?.db_driver, operations, runAction]);

  return {
    screen,
    includeDatabaseStep,
    checks,
    defaultEngine,
    installerState,
    actionPending,
    installing,
    usernameTaken,
    databaseError,
    openingWorkspace,
    startSetup,
    continueDatabase,
    createWorkspace,
    openWorkspace,
    rerunChecks,
  };
}

export type InstallFirstRunControllerState = ReturnType<typeof useInstallFirstRunController>;
