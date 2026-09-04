import { ShareRowSelect } from "@/share-ui/share-row-select";
import type {
  ContactChannelContext,
  ContactPhoneType,
} from "@/contacts-core/src/contacts-edit-utils";
import {
  channelSelectValue,
  channelValueFromSelect,
  contactChannelContextSelectOptions,
  contactPhoneTypeSelectOptions,
  type ContactChannelTypeLabels,
  type ContactPhoneTypeLabels,
} from "@/contacts-core/src/contacts-channel-select";

const CONTEXT_SELECT_CLASS = "contacts-detail-view__context-select";
const CONTEXT_SELECT_ITEM_CLASS = "contacts-detail-view__context-select-item";

type ContactChannelTypeSelectProps<T extends string> = {
  value: T | "";
  options: ReturnType<typeof contactChannelContextSelectOptions>;
  onChange: (value: T | "") => void;
  ariaLabel: string;
};

function ContactChannelTypeSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: ContactChannelTypeSelectProps<T>) {
  return (
    <ShareRowSelect
      value={channelSelectValue(value)}
      options={options}
      className={CONTEXT_SELECT_CLASS}
      itemClassName={CONTEXT_SELECT_ITEM_CLASS}
      aria-label={ariaLabel}
      onChange={(next) => onChange(channelValueFromSelect<T>(next))}
    />
  );
}

export function ContactContextTypeSelect({
  labels,
  value,
  onChange,
  ariaLabel,
}: {
  labels: ContactChannelTypeLabels;
  value: ContactChannelContext;
  onChange: (value: ContactChannelContext) => void;
  ariaLabel: string;
}) {
  return (
    <ContactChannelTypeSelect
      value={value}
      options={contactChannelContextSelectOptions(labels)}
      ariaLabel={ariaLabel}
      onChange={onChange}
    />
  );
}

export function ContactPhoneTypeSelect({
  labels,
  value,
  onChange,
  ariaLabel,
}: {
  labels: ContactPhoneTypeLabels;
  value: ContactPhoneType;
  onChange: (value: ContactPhoneType) => void;
  ariaLabel: string;
}) {
  return (
    <ContactChannelTypeSelect
      value={value}
      options={contactPhoneTypeSelectOptions(labels)}
      ariaLabel={ariaLabel}
      onChange={onChange}
    />
  );
}
