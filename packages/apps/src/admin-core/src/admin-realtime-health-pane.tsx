import { useEffect, useState } from "react";
import { Button } from "@/button/src/button";
import { Card } from "@/card/src/card";
import { wgwFetch } from "@/lib/api/wgw/http";
import "@/admin-core/src/admin-panes.css";

export type RealtimeHealthWindow = {
  samples: number;
  joinP50Ms: number | null;
  joinP95Ms: number | null;
  relayPercent: number;
  failedPairsPercent: number;
  fallbackPercent: number;
  pollP95Ms: number | null;
  constrainedPercent: number;
  byChannel: { meet: number; collab: number };
};

export type RealtimeHealthDay = {
  date: string;
  issued: number;
  unavailable: number;
  denied: number;
};

export type RealtimeHealthSnapshot = {
  day: RealtimeHealthWindow;
  week: RealtimeHealthWindow;
  relayDays: RealtimeHealthDay[];
  turnConfigured: boolean;
  unavailablePeopleThisWeek: number;
  callout: string | null;
  retentionDays: number;
};

const CALLOUT_LINK = "Set up TURN.";

export type AdminRealtimeHealthPaneProps = {
  health?: RealtimeHealthSnapshot | null;
  onOpenTurnSettings: () => void;
};

export function AdminRealtimeHealthPane({
  health: healthProp,
  onOpenTurnSettings,
}: AdminRealtimeHealthPaneProps) {
  const [health, setHealth] = useState<RealtimeHealthSnapshot | null>(healthProp ?? null);

  useEffect(() => {
    if (healthProp !== undefined) {
      setHealth(healthProp);
      return;
    }
    let cancelled = false;
    void wgwFetch("/admin/realtime-health")
      .then(async (response) =>
        response.ok ? ((await response.json()) as RealtimeHealthSnapshot) : null,
      )
      .then((body) => {
        if (!cancelled && body) setHealth(body);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [healthProp]);

  return (
    <div className="admin-realtime-health">
      <p className="admin-realtime-health__lead">
        Anonymous session samples from this instance. Rooms are counted as Meet or Docs. Addresses,
        room names, and user ids are not stored. Samples are kept for {health?.retentionDays ?? 30}{" "}
        days.
      </p>
      {health?.callout ? (
        <aside className="admin-realtime-health__callout">
          <p>
            {health.callout.endsWith(CALLOUT_LINK)
              ? health.callout.slice(0, -CALLOUT_LINK.length)
              : health.callout}{" "}
            <Button label="Set up TURN" variant="outline" onClick={onOpenTurnSettings} />
          </p>
        </aside>
      ) : null}
      <div className="admin-realtime-health__windows">
        <HealthWindow title="Last 24 hours" window={health?.day ?? null} />
        <HealthWindow title="Last 7 days" window={health?.week ?? null} />
      </div>
      <Card title="Relay need">
        <p className="admin-realtime-health__lead">
          Relay requests per day, split by outcome.
          {health
            ? ` ${health.week.constrainedPercent}% of sessions in the last 7 days reported a symmetric or UDP-blocked network.`
            : null}
        </p>
        <table className="admin-realtime-health__relay">
          <thead>
            <tr>
              <th>Day</th>
              <th>Issued</th>
              <th>Unavailable</th>
              <th>Denied</th>
            </tr>
          </thead>
          <tbody>
            {(health?.relayDays ?? []).map((day) => (
              <tr key={day.date}>
                <td>{day.date}</td>
                <td>{day.issued}</td>
                <td>{day.unavailable}</td>
                <td>{day.denied}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function HealthWindow({ title, window }: { title: string; window: RealtimeHealthWindow | null }) {
  return (
    <Card title={title}>
      {window === null || window.samples === 0 ? (
        <p className="admin-realtime-health__lead">No session samples in this window yet.</p>
      ) : (
        <dl className="admin-realtime-health__stats">
          <Stat label="Join time p50" value={ms(window.joinP50Ms)} />
          <Stat label="Join time p95" value={ms(window.joinP95Ms)} />
          <Stat label="Relay" value={pct(window.relayPercent)} />
          <Stat label="Failed pairs" value={pct(window.failedPairsPercent)} />
          <Stat label="HTTP fallback" value={pct(window.fallbackPercent)} />
          <Stat label="Poll p95" value={ms(window.pollP95Ms)} />
          <Stat
            label="Meet / Docs"
            value={`${window.byChannel.meet} / ${window.byChannel.collab}`}
          />
        </dl>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function ms(value: number | null): string {
  return value === null ? "—" : `${value} ms`;
}

function pct(value: number): string {
  return `${value}%`;
}
