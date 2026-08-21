import { useCallback, useEffect, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { Button } from "@/button/src/button";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { wgwApiBaseUrl, wgwReadJson } from "@/lib/api/wgw/http";
import "./calendar-rsvp-page.css";

type RsvpPayload = {
  title: string;
  attendeeEmail: string;
  participationStatus: string;
};

export type CalendarRsvpViewProps = {
  title: string;
  attendeeEmail: string;
  participationStatus: string;
  busy?: boolean;
  onRespond: (status: "accepted" | "tentative" | "declined") => void;
};

async function rsvpFetch(path: string, init?: RequestInit): Promise<RsvpPayload> {
  const response = await fetch(`${wgwApiBaseUrl()}${path}`, {
    ...init,
    headers: { Accept: "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) throw new Error("RSVP link is invalid or expired.");
  return wgwReadJson(response) as Promise<RsvpPayload>;
}

export function CalendarRsvpView({
  title,
  attendeeEmail,
  participationStatus,
  busy = false,
  onRespond,
}: CalendarRsvpViewProps) {
  const labels = defaultCalendarLabels;
  return (
    <main className="calendar-rsvp-page">
      <h1 className="calendar-rsvp-page__title">{title}</h1>
      <p className="calendar-rsvp-page__email">{attendeeEmail}</p>
      <p className="calendar-rsvp-page__status">{participationStatus}</p>
      <div className="calendar-rsvp-page__actions">
        <Button disabled={busy} onClick={() => onRespond("accepted")}>
          {labels.rsvpAccept}
        </Button>
        <Button variant="subtle" disabled={busy} onClick={() => onRespond("tentative")}>
          {labels.rsvpMaybe}
        </Button>
        <Button variant="subtle" disabled={busy} onClick={() => onRespond("declined")}>
          {labels.rsvpDecline}
        </Button>
      </div>
    </main>
  );
}

export function CalendarRsvpPage() {
  const { token } = useParams({ strict: false }) as { token?: string };
  const [state, setState] = useState<RsvpPayload | { error: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const respond = useCallback(
    async (status: "accepted" | "tentative" | "declined") => {
      if (!token) return;
      setBusy(true);
      try {
        setState(
          await rsvpFetch(`/calendar/rsvp/${encodeURIComponent(token)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ participationStatus: status }),
          }),
        );
      } catch (error) {
        setState({ error: error instanceof Error ? error.message : "RSVP failed." });
      } finally {
        setBusy(false);
      }
    },
    [token],
  );

  useEffect(() => {
    if (!token) return;
    void rsvpFetch(`/calendar/rsvp/${encodeURIComponent(token)}`)
      .then(setState)
      .catch((error: unknown) => {
        setState({ error: error instanceof Error ? error.message : "RSVP failed." });
      });
  }, [token]);

  if (!state) return <main className="calendar-rsvp-page">Loading…</main>;
  if ("error" in state) {
    return <main className="calendar-rsvp-page calendar-rsvp-page--error">{state.error}</main>;
  }

  return (
    <CalendarRsvpView
      title={state.title}
      attendeeEmail={state.attendeeEmail}
      participationStatus={state.participationStatus}
      busy={busy}
      onRespond={(status) => void respond(status)}
    />
  );
}
