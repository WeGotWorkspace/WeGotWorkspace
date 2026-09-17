import { useState } from "react";
import { ChevronDown, Hash, Video } from "lucide-react";
import { IconButton } from "@/button/src/icon-button";
import { LoadingSpinner } from "@/loading-spinner/src/loading-spinner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import {
  calendarMeetPickerChannels,
  parseCalendarMeetHref,
  type CalendarMeetChannelOption,
} from "@/calendar-core/src/calendar-meet-link";
import type { ControlSize } from "@/ui/control-size";

export type CalendarMeetChannelPickerProps = {
  labels: CalendarUILabels;
  listChannels?: () => Promise<CalendarMeetChannelOption[]>;
  disabled?: boolean;
  reserving?: boolean;
  /** Shared control height for the segmented Join + menu. Default `md`. */
  size?: ControlSize;
  /** Current meeting URL; Join is enabled when non-empty. */
  meetingUrl?: string;
  workspaceOrigin?: string;
  onJoin?: (href: string) => void;
  onNewLink?: () => void;
  onPick?: (channel: CalendarMeetChannelOption) => void;
};

type ChannelLoadState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "ready"; channels: CalendarMeetChannelOption[] };

/**
 * Meet actions on the event form: primary segmented Join + menu to generate an
 * ad-hoc link or pick a `#` chat channel (lazy-loaded; meeting-kind collections
 * excluded; DMs already filtered upstream).
 */
export function CalendarMeetChannelPicker({
  labels,
  listChannels,
  disabled = false,
  reserving = false,
  size = "md",
  meetingUrl = "",
  workspaceOrigin = "",
  onJoin,
  onNewLink,
  onPick,
}: CalendarMeetChannelPickerProps) {
  const [state, setState] = useState<ChannelLoadState>({ phase: "idle" });

  if (!onNewLink && !listChannels) return null;

  const trimmedUrl = meetingUrl.trim();
  const canJoin = Boolean(trimmedUrl);
  const controlsDisabled = disabled || reserving;

  const loadChannels = (): void => {
    if (!listChannels) return;
    setState({ phase: "loading" });
    void listChannels()
      .then((channels) =>
        setState({ phase: "ready", channels: calendarMeetPickerChannels(channels) }),
      )
      .catch(() => setState({ phase: "error" }));
  };

  const handleJoin = (): void => {
    if (!canJoin || !onJoin) return;
    const parsed = workspaceOrigin ? parseCalendarMeetHref(trimmedUrl, workspaceOrigin) : null;
    onJoin(parsed?.href ?? trimmedUrl);
  };

  return (
    <div className="calendar-event-dialog__meet-menu-trigger">
      <IconButton
        label={labels.eventMeetJoin}
        icon={<Video />}
        size={size}
        variant="primary"
        disabled={!canJoin || controlsDisabled}
        className="calendar-event-dialog__meet-menu-trigger__join"
        onClick={handleJoin}
      />
      <DropdownMenu
        onOpenChange={(open) => {
          if (open && listChannels && state.phase !== "ready") loadChannels();
        }}
      >
        <DropdownMenuTrigger asChild>
          <IconButton
            label={labels.eventMeetAdd}
            icon={reserving ? <LoadingSpinner size="sm" /> : <ChevronDown />}
            size={size}
            variant="primary"
            disabled={controlsDisabled}
            className="calendar-event-dialog__meet-menu-trigger__menu"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="calendar-event-dialog__meet-menu">
          {onNewLink ? (
            <DropdownMenuItem onSelect={() => onNewLink()}>
              <Video className="size-3.5" aria-hidden />
              {labels.eventMeetNewLink}
            </DropdownMenuItem>
          ) : null}
          {onNewLink && listChannels ? <DropdownMenuSeparator /> : null}
          {listChannels && (state.phase === "loading" || state.phase === "idle") ? (
            <DropdownMenuItem disabled>
              <LoadingSpinner size="sm" />
              {labels.eventMeetChannelsLoading}
            </DropdownMenuItem>
          ) : null}
          {listChannels && state.phase === "error" ? (
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                loadChannels();
              }}
            >
              {labels.eventMeetChannelsError}
            </DropdownMenuItem>
          ) : null}
          {listChannels && state.phase === "ready" && state.channels.length === 0 ? (
            <DropdownMenuItem disabled>{labels.eventMeetChannelsEmpty}</DropdownMenuItem>
          ) : null}
          {listChannels && state.phase === "ready"
            ? state.channels.map((channel) => (
                <DropdownMenuItem key={channel.id} onSelect={() => onPick?.(channel)}>
                  <Hash className="size-3.5" aria-hidden />
                  {channel.name}
                </DropdownMenuItem>
              ))
            : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
