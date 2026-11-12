import { useState } from "react";
import { Hash, Plus, Video } from "lucide-react";
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
} from "@/lib/meetings/calendar-meet-link";
import type { ControlSize } from "@/ui/control-size";
import { ColorSwatchTrigger } from "@/ui/color-swatch-trigger";

export type CalendarMeetChannelPickerProps = {
  labels: CalendarUILabels;
  listChannels?: () => Promise<CalendarMeetChannelOption[]>;
  disabled?: boolean;
  reserving?: boolean;
  /** Control height of the menu trigger. Default `md`. */
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
 * Meet actions on the event form: a ghost video dropdown (like the calendar dot) to
 * join, generate an ad-hoc link or pick a `#` chat channel (lazy-loaded; meeting-kind
 * collections excluded; DMs already filtered upstream).
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
    <DropdownMenu
      onOpenChange={(open) => {
        if (open && listChannels && state.phase !== "ready") loadChannels();
      }}
    >
      <DropdownMenuTrigger asChild>
        <ColorSwatchTrigger
          label={labels.eventMeetAdd}
          icon={reserving ? <LoadingSpinner size="sm" /> : <Video />}
          size={size}
          disabled={controlsDisabled}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="calendar-event-dialog__meet-menu">
        {canJoin && onJoin ? (
          <>
            <DropdownMenuItem onSelect={handleJoin}>
              <Video className="size-3.5" aria-hidden />
              {labels.eventMeetJoin}
            </DropdownMenuItem>
            {onNewLink || listChannels ? <DropdownMenuSeparator /> : null}
          </>
        ) : null}
        {onNewLink ? (
          <DropdownMenuItem onSelect={() => onNewLink()}>
            <Plus className="size-3.5" aria-hidden />
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
  );
}
