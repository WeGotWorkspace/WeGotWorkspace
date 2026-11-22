import type { CSSProperties } from "react";
import { meetChannelIcon } from "@/meet-core/src/meet-channel-icon";
import { isProjectCollection } from "@/lib/projects/project-match";
import { useProjects } from "@/lib/projects/projects-store";
import type { MeetChannel } from "@/lib/models/meet-types";

/**
 * The mark of a conversation (see {@link meetChannelIcon}), shared by its sidebar row and the
 * main header. A Project channel's icon sits on a wash of the Project's color.
 */
export function MeetChannelKindIcon({
  channel,
  className,
}: {
  channel: MeetChannel;
  className?: string;
}) {
  const { projects } = useProjects();
  const Icon = meetChannelIcon(channel);
  if (!isProjectCollection(channel)) return <Icon className={className} aria-hidden />;
  const color = projects.find((project) => project.id === channel.projectId)?.color ?? null;
  return (
    <span
      className="meet-workspace__project-mark"
      style={color ? ({ "--meet-project-color": color } as CSSProperties) : undefined}
    >
      <Icon className={className} aria-hidden />
    </span>
  );
}
