import type { ReactNode } from "react";
import { Card } from "@/card/src/card";
import { WorkspaceAppIcon } from "@/lib/workspace-app-icon";
import { cn } from "@/lib/utils";
import "@/meet-core/src/meet-guest-lobby.css";

export type MeetGuestLobbyCardProps = {
  variant?: "lobby" | "status";
  heading: ReactNode;
  media?: ReactNode;
  invite: ReactNode;
};

export function MeetGuestLobbyCard({
  variant = "lobby",
  heading,
  media,
  invite,
}: MeetGuestLobbyCardProps) {
  return (
    <Card
      className={cn(
        "meet-guest-lobby__card",
        variant === "status" && "meet-guest-lobby__card--status",
      )}
    >
      <div className="meet-guest-lobby__heading">{heading}</div>
      {media ? <div className="meet-guest-lobby__media">{media}</div> : null}
      <div className="meet-guest-lobby__invite">{invite}</div>
    </Card>
  );
}

export function MeetGuestLobbyHeading({ title }: { title: string }) {
  return (
    <>
      <WorkspaceAppIcon appId="meet" variant="switch-trigger" className="meet-guest-lobby__mark" />
      <h1 className="meet-workspace__title meet-workspace__title--lg meet-guest-lobby__title">
        {title}
      </h1>
    </>
  );
}

export type MeetGuestLobbyStatusProps = {
  title: string;
  body: string;
};

/** Invite-column-only lobby card: Meet mark + serif title, no camera/devices. */
export function MeetGuestLobbyStatus({ title, body }: MeetGuestLobbyStatusProps) {
  return (
    <MeetGuestLobbyCard
      variant="status"
      heading={<MeetGuestLobbyHeading title={title} />}
      invite={<p className="meet-guest-lobby__status-body">{body}</p>}
    />
  );
}
