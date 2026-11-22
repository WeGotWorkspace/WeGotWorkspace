import type { ReactElement } from "react";
import { UsersRound } from "lucide-react";
import { cn } from "@/lib/utils";
import "@/contacts-core/src/contacts-group-icon.css";

export type ContactsGroupIconProps = {
  className?: string;
};

/** Lucide group glyph in muted ink; groups follow their address book, which has no colour. */
export function ContactsGroupIcon({ className }: ContactsGroupIconProps): ReactElement {
  return <UsersRound className={cn("contacts-group-icon", className)} aria-hidden />;
}
