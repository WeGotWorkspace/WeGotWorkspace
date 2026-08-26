import { useEffect, useState } from "react";
import { Video } from "lucide-react";
import { Button } from "@/button/src/button";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import {
  parseCalendarMeetHref,
  type CalendarMeetOperations,
} from "@/calendar-core/src/calendar-meet-link";
import "./calendar-meet-join.css";

export type CalendarMeetJoinProps = {
  href: string;
  labels: CalendarUILabels;
  workspaceOrigin: string;
  meetOperations?: CalendarMeetOperations;
  onJoin?: (href: string) => void;
  size?: "sm" | "default";
};

type JoinState = "ready" | "dead" | "hidden";

export function CalendarMeetJoin({
  href,
  labels,
  workspaceOrigin,
  meetOperations,
  onJoin,
  size = "sm",
}: CalendarMeetJoinProps) {
  const parsed = parseCalendarMeetHref(href, workspaceOrigin);
  const [state, setState] = useState<JoinState>(parsed ? "ready" : "hidden");

  useEffect(() => {
    const next = parseCalendarMeetHref(href, workspaceOrigin);
    if (!next) {
      setState("hidden");
      return;
    }
    if (next.kind !== "wgw" || !meetOperations) {
      setState("ready");
      return;
    }
    let cancelled = false;
    setState("ready");
    void meetOperations
      .roomStatus({ room: next.room })
      .then((status) => {
        if (cancelled) return;
        if (status.reserved === false && status.active === false) {
          setState("dead");
          return;
        }
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("ready");
      });
    return () => {
      cancelled = true;
    };
  }, [href, meetOperations, workspaceOrigin]);

  if (!parsed || state === "hidden") return null;

  if (state === "dead") {
    return <p className="calendar-meet-join__dead">{labels.eventMeetDeadLink}</p>;
  }

  return (
    <Button
      type="button"
      variant="primary"
      size={size}
      className="calendar-meet-join"
      icon={<Video className="size-3.5" aria-hidden />}
      label={labels.eventMeetJoin}
      onClick={() => onJoin?.(parsed.href)}
    />
  );
}
