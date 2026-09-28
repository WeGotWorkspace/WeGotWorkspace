import { useId, useState, type FormEvent } from "react";
import { Button } from "@/button/src/button";
import { installerCopy as copy } from "@/installer-core/src/installer-copy";
import { InstallerHeadline } from "@/installer-core/src/installer-headline";
import { InstallerLayout } from "@/installer-core/src/installer-layout";
import { SegmentedControl } from "@/segmented-control/src/segmented-control";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";

export type InstallerDatabaseEngine = "sqlite" | "mysql";

export type InstallerMysqlDraft = {
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
};

export type InstallerDatabaseValues =
  { engine: "sqlite" } | { engine: "mysql"; mysql: InstallerMysqlDraft };

export type InstallerDatabasePageProps = {
  initialEngine?: InstallerDatabaseEngine;
  initialMysql?: Partial<InstallerMysqlDraft>;
  onContinue?: (values: InstallerDatabaseValues) => void;
  connectionError?: string | null;
};

const DEFAULT_MYSQL: InstallerMysqlDraft = {
  host: "127.0.0.1",
  port: "3306",
  database: "wgw",
  username: "wgw",
  password: "",
};

/** Object spread keeps explicit `undefined` keys, which would wipe these defaults. */
function mysqlDraftFromInitial(initial?: Partial<InstallerMysqlDraft>): InstallerMysqlDraft {
  return {
    host: initial?.host ?? DEFAULT_MYSQL.host,
    port: initial?.port ?? DEFAULT_MYSQL.port,
    database: initial?.database ?? DEFAULT_MYSQL.database,
    username: initial?.username ?? DEFAULT_MYSQL.username,
    password: initial?.password ?? DEFAULT_MYSQL.password,
  };
}

const ENGINE_OPTIONS = [
  { value: "mysql" as const, label: copy.mysql },
  { value: "sqlite" as const, label: copy.sqlite },
];

function InstallerDatabasePageTitle() {
  return (
    <>
      <InstallerHeadline italic="Your" noun="database" />.
    </>
  );
}

function enginePanelProps(active: boolean) {
  return {
    className: active
      ? "installer__engine-panel"
      : "installer__engine-panel installer__engine-panel--hidden",
    "aria-hidden": !active,
    inert: !active,
  };
}

export function InstallerDatabasePage({
  initialEngine = "mysql",
  initialMysql,
  onContinue,
  connectionError,
}: InstallerDatabasePageProps) {
  const mysqlHostId = useId();
  const mysqlPortId = useId();
  const mysqlDatabaseId = useId();
  const mysqlUserId = useId();
  const mysqlPasswordId = useId();

  const [engine, setEngine] = useState<InstallerDatabaseEngine>(initialEngine);
  const [mysql, setMysql] = useState<InstallerMysqlDraft>(() =>
    mysqlDraftFromInitial(initialMysql),
  );

  const mysqlReady =
    mysql.host.trim().length > 0 &&
    mysql.port.trim().length > 0 &&
    mysql.database.trim().length > 0 &&
    mysql.username.trim().length > 0;
  const canSubmit = engine === "sqlite" || mysqlReady;

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!canSubmit) return;
    onContinue?.(engine === "sqlite" ? { engine: "sqlite" } : { engine: "mysql", mysql });
  };

  return (
    <InstallerLayout title={<InstallerDatabasePageTitle />} step="database">
      <form className="login-screen__form" onSubmit={handleSubmit}>
        <FieldLabelRow label={copy.databaseType}>
          <div className="installer__engine">
            <SegmentedControl
              aria-label={copy.databaseType}
              value={engine}
              onChange={setEngine}
              options={ENGINE_OPTIONS}
            />
          </div>
        </FieldLabelRow>

        <div className="installer__engine-panels">
          <div {...enginePanelProps(engine === "mysql")}>
            <div className="installer__mysql">
              <div className="installer__mysql-row installer__mysql-row--host-port">
                <FieldLabelRow
                  className="installer__mysql-host"
                  htmlFor={mysqlHostId}
                  label={copy.mysqlHost}
                >
                  <Input
                    id={mysqlHostId}
                    name="mysqlHost"
                    value={mysql.host}
                    onChange={(event) =>
                      setMysql((current) => ({ ...current, host: event.target.value }))
                    }
                  />
                </FieldLabelRow>
                <FieldLabelRow htmlFor={mysqlPortId} label={copy.mysqlPort}>
                  <Input
                    id={mysqlPortId}
                    name="mysqlPort"
                    inputMode="numeric"
                    value={mysql.port}
                    onChange={(event) =>
                      setMysql((current) => ({ ...current, port: event.target.value }))
                    }
                  />
                </FieldLabelRow>
              </div>
              <FieldLabelRow htmlFor={mysqlDatabaseId} label={copy.mysqlDatabase}>
                <Input
                  id={mysqlDatabaseId}
                  name="mysqlDatabase"
                  value={mysql.database}
                  onChange={(event) =>
                    setMysql((current) => ({ ...current, database: event.target.value }))
                  }
                />
              </FieldLabelRow>
              <div className="installer__mysql-row">
                <FieldLabelRow htmlFor={mysqlUserId} label={copy.mysqlUser}>
                  <Input
                    id={mysqlUserId}
                    name="mysqlUser"
                    value={mysql.username}
                    onChange={(event) =>
                      setMysql((current) => ({ ...current, username: event.target.value }))
                    }
                  />
                </FieldLabelRow>
                <FieldLabelRow htmlFor={mysqlPasswordId} label={copy.mysqlPassword}>
                  <Input
                    id={mysqlPasswordId}
                    name="mysqlPassword"
                    variant="password"
                    value={mysql.password}
                    autoComplete="new-password"
                    onChange={(event) =>
                      setMysql((current) => ({ ...current, password: event.target.value }))
                    }
                  />
                </FieldLabelRow>
              </div>
            </div>
          </div>
          <div {...enginePanelProps(engine === "sqlite")}>
            <p className="installer__hint">{copy.sqliteHint}</p>
          </div>
        </div>

        {engine === "mysql" && connectionError ? (
          <p className="installer__hint installer__hint--error" role="alert">
            {connectionError}
          </p>
        ) : null}

        <div className="login-screen__actions">
          <Button
            type="submit"
            label={copy.continueSetup}
            variant="primary"
            size="xl"
            pill
            className="login-screen__submit"
            disabled={!canSubmit}
          />
        </div>
      </form>
    </InstallerLayout>
  );
}
