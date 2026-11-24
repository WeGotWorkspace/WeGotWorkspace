import type { ReactElement } from "react";
import { BookUser } from "lucide-react";
import { cn } from "@/lib/utils";

/** An address book's mark. Address books belong to a Team, so they carry no colour. */
export function ContactsAddressBookIcon({ className }: { className?: string }): ReactElement {
  return <BookUser className={cn("size-3.5 shrink-0", className)} aria-hidden />;
}
