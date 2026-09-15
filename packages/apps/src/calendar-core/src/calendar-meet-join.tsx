import { useEffect, useState } from "react";
import { Video } from "lucide-react";
import { Button } from "@/button/src/button";
import { IconButton } from "@/button/src/icon-button";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import {
  parseCalendarMeetHref,
  type CalendarMeetOperations,
} from "@/calendar-core/src/calendar-meet-link";
import type { ControlSize } from "@/ui/control-size";
import "./calendar-meet-join.css";

export type CalendarMeetJoinProps = {
  href: string;
  labels: CalendarUILabels;
  workspaceOrigin: string;
  meetOperations?: CalendarMeetOperations;
  onJoin?: (href: string) => void;
  /**
   * `button` — labeled primary (footer / invitation card).
   * `icon` — compact Video IconButton matching the segmented Meet Join control.
   */
  appearance?: "button" | "icon";
  size?: ControlSize;
};

type JoinState = "ready" | "dead" | "hidden";

export function CalendarMeetJoin({
  href,
  labels,
  workspaceOrigin,
  meetOperations,
  onJoin,
  appearance = "button",
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
    // Channel rooms live as long as the channel — the reservation-based
    // dead-link check only applies to ad-hoc room codes.
    if (next.kind !== "wgw" || next.roomKind !== "code" || !meetOperations) {
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

  if (appearance === "icon") {
    return (
      <IconButton
        label={labels.eventMeetJoin}
        icon={<Video className="size-3.5" aria-hidden />}
        size={size}
        variant="primary"
        className="calendar-meet-join calendar-meet-join--icon"
        onClick={() => onJoin?.(parsed.href)}
      />
    );
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
