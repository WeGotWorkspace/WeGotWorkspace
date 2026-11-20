import { useId, type ReactNode } from "react";
import { Users } from "lucide-react";
import { ShareAccessCard } from "@/share-ui/share-access-card";
import { ShareAccessRow } from "@/share-ui/share-access-row";
import { ShareDialogInput } from "@/share-ui/share-dialog-input";
import { SharePrincipalMark } from "@/share-ui/share-principal-mark";
import {
  SharePrincipalSearchDropdown,
  type ShareSearchOption,
} from "@/share-ui/share-principal-search-dropdown";
import { ShareRowSelect, type ShareRowSelectOption } from "@/share-ui/share-row-select";
import { teamMembersLabels as labels } from "@/settings-core/src/settings-team-members-labels";

export type TeamRole = "member" | "teamAdmin";

const ROLE_OPTIONS: readonly ShareRowSelectOption<TeamRole>[] = [
  { value: "member", label: labels.roleMember },
  { value: "teamAdmin", label: labels.roleTeamAdmin },
];

export type TeamMembersCardMember = {
  id: string;
  displayName: string;
  username: string;
  isTeamAdmin: boolean;
};

export type TeamMembersCardProps = {
  members: readonly TeamMembersCardMember[];
  query: string;
  onQueryChange: (query: string) => void;
  /** People who can be added for the current query (members already filtered out). */
  candidates: readonly ShareSearchOption[];
  searching?: boolean;
  minQueryLength?: number;
  onAdd: (id: string) => void;
  onRoleChange: (member: TeamMembersCardMember, role: TeamRole) => void;
  onRemove: (member: TeamMembersCardMember) => void;
  /** Error or loading line above the rows. */
  status?: ReactNode;
};

/**
 * A Team's members in the "Team access" look of the share dialogs (#2278): add by name,
 * one row per member with Member | Team admin, remove. Settings (team admin) and Admin
 * (organization admin) both use it.
 */
export function TeamMembersCard({
  members,
  query,
  onQueryChange,
  candidates,
  searching = false,
  minQueryLength,
  onAdd,
  onRoleChange,
  onRemove,
  status,
}: TeamMembersCardProps) {
  const addFieldId = useId();
  return (
    <ShareAccessCard
      htmlFor={addFieldId}
      icon={<Users aria-hidden />}
      title={labels.sectionTitle}
      description={labels.sectionHint}
      addControl={
        <SharePrincipalSearchDropdown
          query={query}
          searching={searching}
          results={[...candidates]}
          emptyLabel={labels.noCandidates}
          listLabel={labels.sectionTitle}
          minQueryLength={minQueryLength}
          onSelect={(option) => {
            onQueryChange("");
            onAdd(option.id);
          }}
        >
          <ShareDialogInput
            id={addFieldId}
            value={query}
            placeholder={labels.addPlaceholder}
            className="share-dialog__add-grant-input"
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.preventDefault();
            }}
          />
        </SharePrincipalSearchDropdown>
      }
    >
      {status}
      {members.map((member) => (
        <ShareAccessRow
          key={member.id}
          mark={
            <SharePrincipalMark
              principalType="user"
              displayName={member.displayName}
              subtitle={member.username}
              size="sm"
              labeled
            />
          }
          trailing={
            <ShareRowSelect<TeamRole>
              value={member.isTeamAdmin ? "teamAdmin" : "member"}
              options={ROLE_OPTIONS}
              aria-label={labels.roleOf(member.displayName)}
              onChange={(next) => onRoleChange(member, next)}
            />
          }
          removeLabel={labels.removeLabel(member.displayName)}
          onRemove={() => onRemove(member)}
        />
      ))}
    </ShareAccessCard>
  );
}
