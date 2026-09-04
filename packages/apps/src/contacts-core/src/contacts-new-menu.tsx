import { Upload } from "lucide-react";
import type { DropdownMenuItemProps } from "@/menu-dropdown/src/dropdown-menu";
import { SidebarSegmentedNewMenu } from "@/sidebar-segmented-new-menu/src/sidebar-segmented-new-menu";
import { ContactsGroupIcon } from "@/contacts-core/src/contacts-group-icon";
import type { ContactsUILabels } from "@/contacts-core/src/contacts-labels";

export type ContactsNewMenuProps = {
  labels: Pick<ContactsUILabels, "newContact" | "newContactMenu" | "newGroup" | "importVcf">;
  onCreateContact: () => void;
  onCreateGroup?: () => void;
  onImportVcf?: () => void;
  disabled?: boolean;
};

export function ContactsNewMenu({
  labels,
  onCreateContact,
  onCreateGroup,
  onImportVcf,
  disabled,
}: ContactsNewMenuProps) {
  const items: DropdownMenuItemProps[] = [];
  if (onCreateGroup) {
    items.push({
      id: "create-group",
      label: labels.newGroup,
      icon: <ContactsGroupIcon />,
      onClick: onCreateGroup,
    });
  }
  if (onImportVcf) {
    items.push({
      id: "import-vcf",
      label: labels.importVcf,
      icon: <Upload aria-hidden />,
      onClick: onImportVcf,
    });
  }

  return (
    <SidebarSegmentedNewMenu
      mainLabel={labels.newContact}
      menuLabel={labels.newContactMenu}
      onMainAction={onCreateContact}
      mainDisabled={disabled}
      items={items}
    />
  );
}
