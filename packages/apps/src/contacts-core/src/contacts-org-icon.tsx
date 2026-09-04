import type { ReactElement } from "react";
import { Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import "@/contacts-core/src/contacts-org-icon.css";

export type ContactsOrgIconProps = {
  className?: string;
};

/** Lucide company glyph for JSContact `kind: "org"` avatars. */
export function ContactsOrgIcon({ className }: ContactsOrgIconProps): ReactElement {
  return <Building2 className={cn("contacts-org-icon", className)} aria-hidden />;
}
