import { Check, Database } from "lucide-react";
import { Card } from "@/card/src/card";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import type { InstallControllerState } from "@/install-core/src/use-install-controller";
import { installWorkspacePaneClasses as c } from "@/install-core/src/install-workspace.styles";

export function InstallDatabasePane({
  controller,
}: {
  controller: Pick<
    InstallControllerState,
    "dbType" | "selectDbType" | "sqlitePath" | "setSqlitePath" | "mysql" | "setMysql" | "mysqlTest"
  >;
}) {
  const { dbType, selectDbType, sqlitePath, setSqlitePath, mysql, setMysql, mysqlTest } =
    controller;

  return (
    <>
      <Card title="Database type">
        <div className={c.grid2}>
          {(["sqlite", "mysql"] as const).map((candidate) => {
            const active = dbType === candidate;
            return (
              <button
                key={candidate}
                type="button"
                onClick={() => {
                  selectDbType(candidate);
                }}
                className={`${c.dbTypeOption} ${active ? c.dbTypeOptionActive : ""}`}
              >
                <div className="flex items-center gap-2">
                  <Database className="size-4" />
                  <div className="text-sm font-medium">
                    {candidate === "sqlite" ? "SQLite" : "MySQL / MariaDB"}
                  </div>
                  {active ? (
                    <Check className="size-4 ml-auto" style={{ color: "var(--install-accent)" }} />
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      {dbType === "sqlite" ? (
        <Card title="SQLite settings">
          <div className={c.fieldStack}>
            <FieldLabelRow label="Database file">
              <Input
                value={sqlitePath}
                onChange={(event) => setSqlitePath(event.target.value)}
                placeholder="wgw-content/db.sqlite"
              />
            </FieldLabelRow>
            <p className={c.fieldHint}>Path is relative to the install root.</p>
          </div>
        </Card>
      ) : (
        <Card title="MySQL credentials">
          <div className="space-y-5">
            <div className={c.grid3HostPort}>
              <div className="col-span-2">
                <FieldLabelRow label="Host">
                  <Input
                    value={mysql.host}
                    onChange={(event) =>
                      setMysql((current) => ({ ...current, host: event.target.value }))
                    }
                  />
                </FieldLabelRow>
              </div>
              <FieldLabelRow label="Port">
                <Input
                  value={mysql.port}
                  onChange={(event) =>
                    setMysql((current) => ({ ...current, port: event.target.value }))
                  }
                />
              </FieldLabelRow>
            </div>
            <FieldLabelRow label="Database name">
              <Input
                value={mysql.database}
                onChange={(event) =>
                  setMysql((current) => ({ ...current, database: event.target.value }))
                }
              />
            </FieldLabelRow>
            <div className={c.grid2}>
              <FieldLabelRow label="Username">
                <Input
                  value={mysql.username}
                  onChange={(event) =>
                    setMysql((current) => ({ ...current, username: event.target.value }))
                  }
                />
              </FieldLabelRow>
              <FieldLabelRow label="Password">
                <Input
                  variant="password"
                  value={mysql.password}
                  onChange={(event) =>
                    setMysql((current) => ({ ...current, password: event.target.value }))
                  }
                  placeholder="********"
                />
              </FieldLabelRow>
            </div>
          </div>
          {mysqlTest.state === "error" ? (
            <p className="install-message-error">{mysqlTest.message || "Connection failed."}</p>
          ) : null}
          {mysqlTest.state === "ok" ? (
            <p className="install-message-ok">{mysqlTest.message || "Connection verified."}</p>
          ) : null}
        </Card>
      )}
    </>
  );
}
