import type { ShareRowSelectOption } from "@/share-ui/share-row-select";
import {
  CONTACT_CHANNEL_CONTEXTS,
  CONTACT_PHONE_TYPES,
  type ContactChannelContext,
  type ContactPhoneType,
} from "@/contacts-core/src/contacts-edit-utils";
import type { ContactsUILabels } from "@/contacts-core/src/contacts-labels";

/** Radix Select cannot use an empty string value; map UI "none" to this sentinel. */
export const CONTACT_CHANNEL_SELECT_NONE = "none";

export type ContactChannelTypeLabels = Pick<
  ContactsUILabels,
  "channelTypeNone" | "channelTypeHome" | "channelTypeWork" | "channelTypeSchool"
>;

export type ContactPhoneTypeLabels = ContactChannelTypeLabels &
  Pick<ContactsUILabels, "channelTypeMobile">;

export function channelSelectValue(value: string): string {
  return value || CONTACT_CHANNEL_SELECT_NONE;
}

export function channelValueFromSelect<T extends string>(value: string): T | "" {
  return (value === CONTACT_CHANNEL_SELECT_NONE ? "" : value) as T | "";
}

export function channelTypeLabel(
  contextType: ContactChannelContext,
  labels: ContactChannelTypeLabels,
): string {
  if (contextType === "work") return labels.channelTypeWork;
  if (contextType === "home") return labels.channelTypeHome;
  if (contextType === "school") return labels.channelTypeSchool;
  return labels.channelTypeNone;
}

export function phoneTypeLabel(
  phoneType: ContactPhoneType,
  labels: ContactPhoneTypeLabels,
): string {
  if (phoneType === "mobile") return labels.channelTypeMobile;
  return channelTypeLabel(phoneType, labels);
}

function sortChannelSelectOptions(
  options: ShareRowSelectOption<string>[],
): ShareRowSelectOption<string>[] {
  return [...options].sort((left, right) => left.label.localeCompare(right.label, "en"));
}

export function contactChannelContextSelectOptions(
  labels: ContactChannelTypeLabels,
): ShareRowSelectOption<string>[] {
  return sortChannelSelectOptions(
    CONTACT_CHANNEL_CONTEXTS.map((contextType) => ({
      value: channelSelectValue(contextType),
      label: channelTypeLabel(contextType, labels),
    })),
  );
}

export function contactPhoneTypeSelectOptions(
  labels: ContactPhoneTypeLabels,
): ShareRowSelectOption<string>[] {
  return sortChannelSelectOptions(
    CONTACT_PHONE_TYPES.map((phoneType) => ({
      value: channelSelectValue(phoneType),
      label: phoneTypeLabel(phoneType, labels),
    })),
  );
}
