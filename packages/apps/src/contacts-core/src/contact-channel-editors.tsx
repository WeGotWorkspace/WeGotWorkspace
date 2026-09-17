import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ContactChannelRow } from "./contact-channel-row";
import { ContactContextTypeSelect, ContactPhoneTypeSelect } from "./contact-channel-type-select";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import {
  CONTACT_CHANNEL_DEFAULT_CONTEXT,
  newContactMapId,
  type ContactAddressDraft,
  type ContactChannelContext,
  type ContactPhoneType,
} from "@/contacts-core/src/contacts-edit-utils";
import type { ContactsUILabels } from "@/contacts-core/src/contacts-labels";

function channelValueInputId(rowId: string): string {
  return `contact-channel-value-${rowId}`;
}

function addressFieldInputId(
  rowId: string,
  field: keyof Omit<ContactAddressDraft, "id" | "contextType">,
): string {
  const suffix =
    field === "postalCode"
      ? "postal"
      : field === "street"
        ? "street"
        : field === "locality"
          ? "locality"
          : field === "region"
            ? "region"
            : "country";
  return `contact-address-${suffix}-${rowId}`;
}

/** After the trailing empty slot commits, focus the new row so typing can continue. */
function focusCommittedInput(elementId: string): void {
  const el = document.getElementById(elementId);
  if (!(el instanceof HTMLInputElement)) return;
  el.focus();
  const len = el.value.length;
  try {
    el.setSelectionRange(len, len);
  } catch {
    // Non-text inputs may reject selection ranges.
  }
}

function useFocusAfterCommit(): (elementId: string) => void {
  const pendingIdRef = useRef<string | null>(null);
  const requestFocus = useCallback((elementId: string) => {
    pendingIdRef.current = elementId;
  }, []);
  useLayoutEffect(() => {
    const id = pendingIdRef.current;
    if (!id) return;
    pendingIdRef.current = null;
    focusCommittedInput(id);
  });
  return requestFocus;
}

function useTrailingChannelSlot<T extends string>(
  emptyType: T,
): {
  id: string;
  type: T;
  setType: (type: T) => void;
  consume: () => { id: string; type: T };
} {
  const [id, setId] = useState(newContactMapId);
  const [type, setType] = useState<T>(emptyType);
  const consume = useCallback(() => {
    const taken = { id, type };
    setId(newContactMapId());
    setType(emptyType);
    return taken;
  }, [emptyType, id, type]);
  return { id, type, setType, consume };
}

function commitTrailingValue<TType extends string>(
  value: string,
  consume: () => { id: string; type: TType },
  onCommit: (id: string, value: string, type: TType) => void,
): { id: string; type: TType } | null {
  if (!value) return null;
  const slot = consume();
  onCommit(slot.id, value, slot.type);
  return slot;
}

type SimpleChannelRowsProps<TType extends string> = {
  rows: Array<{ id: string; value: string; type: TType }>;
  emptyType: TType;
  valueAriaLabel: string;
  placeholder: string;
  typeAriaLabel: string;
  removeLabel: string;
  typeControl: (args: {
    value: TType;
    onChange: (value: TType) => void;
    ariaLabel: string;
  }) => ReactNode;
  onUpdateValue: (id: string, value: string, type?: TType) => void;
  onUpdateType: (id: string, type: TType) => void;
  onRemove: (id: string) => void;
};

function SimpleChannelRows<TType extends string>({
  rows,
  emptyType,
  valueAriaLabel,
  placeholder,
  typeAriaLabel,
  removeLabel,
  typeControl,
  onUpdateValue,
  onUpdateType,
  onRemove,
}: SimpleChannelRowsProps<TType>) {
  const slot = useTrailingChannelSlot(emptyType);
  const requestFocus = useFocusAfterCommit();

  return (
    <>
      {rows.map((row) => (
        <ContactChannelRow
          key={row.id}
          removeLabel={removeLabel}
          onRemove={() => onRemove(row.id)}
          typeControl={typeControl({
            value: row.type,
            onChange: (next) => onUpdateType(row.id, next),
            ariaLabel: typeAriaLabel,
          })}
        >
          <Input
            id={channelValueInputId(row.id)}
            aria-label={valueAriaLabel}
            value={row.value}
            onChange={(event) => onUpdateValue(row.id, event.target.value)}
          />
        </ContactChannelRow>
      ))}
      <ContactChannelRow
        key={slot.id}
        typeControl={typeControl({
          value: slot.type,
          onChange: slot.setType,
          ariaLabel: typeAriaLabel,
        })}
      >
        <Input
          id={channelValueInputId(slot.id)}
          aria-label={valueAriaLabel}
          placeholder={placeholder}
          value=""
          onChange={(event) => {
            const taken = commitTrailingValue(event.target.value, slot.consume, onUpdateValue);
            if (taken) requestFocus(channelValueInputId(taken.id));
          }}
        />
      </ContactChannelRow>
    </>
  );
}

export function ContactPhoneRows({
  phones,
  labels,
  onUpdatePhone,
  onUpdatePhoneContext,
  onRemovePhone,
}: {
  phones: Array<{ id: string; number: string; phoneType: ContactPhoneType }>;
  labels: ContactsUILabels;
  onUpdatePhone: (id: string, number: string, phoneType?: ContactPhoneType) => void;
  onUpdatePhoneContext: (id: string, phoneType: ContactPhoneType) => void;
  onRemovePhone: (id: string) => void;
}) {
  const typeAriaLabel = `${labels.channelType} ${labels.phoneNumber}`;
  return (
    <SimpleChannelRows
      rows={phones.map((row) => ({ id: row.id, value: row.number, type: row.phoneType }))}
      emptyType={CONTACT_CHANNEL_DEFAULT_CONTEXT}
      valueAriaLabel={labels.phoneNumber}
      placeholder={labels.addPhone}
      typeAriaLabel={typeAriaLabel}
      removeLabel={labels.removeRow}
      typeControl={({ value, onChange, ariaLabel }) => (
        <ContactPhoneTypeSelect
          labels={labels}
          value={value}
          ariaLabel={ariaLabel}
          onChange={onChange}
        />
      )}
      onUpdateValue={onUpdatePhone}
      onUpdateType={onUpdatePhoneContext}
      onRemove={onRemovePhone}
    />
  );
}

export function ContactEmailRows({
  emails,
  labels,
  onUpdateEmail,
  onUpdateEmailContext,
  onRemoveEmail,
}: {
  emails: Array<{ id: string; address: string; contextType: ContactChannelContext }>;
  labels: ContactsUILabels;
  onUpdateEmail: (id: string, address: string, contextType?: ContactChannelContext) => void;
  onUpdateEmailContext: (id: string, contextType: ContactChannelContext) => void;
  onRemoveEmail: (id: string) => void;
}) {
  const typeAriaLabel = `${labels.channelType} ${labels.emailAddress}`;
  return (
    <SimpleChannelRows
      rows={emails.map((row) => ({ id: row.id, value: row.address, type: row.contextType }))}
      emptyType={CONTACT_CHANNEL_DEFAULT_CONTEXT}
      valueAriaLabel={labels.emailAddress}
      placeholder={labels.addEmail}
      typeAriaLabel={typeAriaLabel}
      removeLabel={labels.removeRow}
      typeControl={({ value, onChange, ariaLabel }) => (
        <ContactContextTypeSelect
          labels={labels}
          value={value}
          ariaLabel={ariaLabel}
          onChange={onChange}
        />
      )}
      onUpdateValue={onUpdateEmail}
      onUpdateType={onUpdateEmailContext}
      onRemove={onRemoveEmail}
    />
  );
}

export function ContactUrlRows({
  urls,
  labels,
  onUpdateUrl,
  onUpdateUrlContext,
  onRemoveUrl,
}: {
  urls: Array<{ id: string; uri: string; contextType: ContactChannelContext }>;
  labels: ContactsUILabels;
  onUpdateUrl: (id: string, uri: string, contextType?: ContactChannelContext) => void;
  onUpdateUrlContext: (id: string, contextType: ContactChannelContext) => void;
  onRemoveUrl: (id: string) => void;
}) {
  const typeAriaLabel = `${labels.channelType} ${labels.urlAddress}`;
  return (
    <SimpleChannelRows
      rows={urls.map((row) => ({ id: row.id, value: row.uri, type: row.contextType }))}
      emptyType={CONTACT_CHANNEL_DEFAULT_CONTEXT}
      valueAriaLabel={labels.urlAddress}
      placeholder={labels.addUrl}
      typeAriaLabel={typeAriaLabel}
      removeLabel={labels.removeRow}
      typeControl={({ value, onChange, ariaLabel }) => (
        <ContactContextTypeSelect
          labels={labels}
          value={value}
          ariaLabel={ariaLabel}
          onChange={onChange}
        />
      )}
      onUpdateValue={onUpdateUrl}
      onUpdateType={onUpdateUrlContext}
      onRemove={onRemoveUrl}
    />
  );
}

function AddressSecondaryFields({
  rowId,
  postalCode,
  locality,
  region,
  country,
  labels,
  onFieldChange,
}: {
  rowId: string;
  postalCode: string;
  locality: string;
  region: string;
  country: string;
  labels: ContactsUILabels;
  onFieldChange: (
    field: keyof Omit<ContactAddressDraft, "id" | "contextType">,
    value: string,
  ) => void;
}) {
  return (
    <div className="contacts-detail-view__address-fields">
      <div className="contacts-detail-view__address-locality-row">
        <FieldLabelRow label={labels.addressPostalCode} htmlFor={`contact-address-postal-${rowId}`}>
          <Input
            id={`contact-address-postal-${rowId}`}
            value={postalCode}
            onChange={(event) => onFieldChange("postalCode", event.target.value)}
          />
        </FieldLabelRow>
        <FieldLabelRow label={labels.addressLocality} htmlFor={`contact-address-locality-${rowId}`}>
          <Input
            id={`contact-address-locality-${rowId}`}
            value={locality}
            onChange={(event) => onFieldChange("locality", event.target.value)}
          />
        </FieldLabelRow>
      </div>
      <FieldLabelRow label={labels.addressRegion} htmlFor={`contact-address-region-${rowId}`}>
        <Input
          id={`contact-address-region-${rowId}`}
          value={region}
          onChange={(event) => onFieldChange("region", event.target.value)}
        />
      </FieldLabelRow>
      <FieldLabelRow label={labels.addressCountry} htmlFor={`contact-address-country-${rowId}`}>
        <Input
          id={`contact-address-country-${rowId}`}
          value={country}
          onChange={(event) => onFieldChange("country", event.target.value)}
        />
      </FieldLabelRow>
    </div>
  );
}

function AddressEditor({
  rowId,
  street,
  postalCode,
  locality,
  region,
  country,
  labels,
  trailing,
  typeControl,
  removeLabel,
  onRemove,
  onFieldChange,
}: {
  rowId: string;
  street: string;
  postalCode: string;
  locality: string;
  region: string;
  country: string;
  labels: ContactsUILabels;
  trailing?: boolean;
  typeControl: ReactNode;
  removeLabel?: string;
  onRemove?: () => void;
  onFieldChange: (
    field: keyof Omit<ContactAddressDraft, "id" | "contextType">,
    value: string,
  ) => void;
}) {
  return (
    <div className="contacts-detail-view__address-entry">
      <ContactChannelRow
        variant="address"
        typeControl={<FieldLabelRow reserveLabel>{typeControl}</FieldLabelRow>}
        removeLabel={removeLabel}
        onRemove={onRemove}
      >
        <FieldLabelRow label={labels.addressStreet} htmlFor={`contact-address-street-${rowId}`}>
          <Input
            id={`contact-address-street-${rowId}`}
            value={street}
            placeholder={trailing ? labels.addAddress : undefined}
            onChange={(event) => onFieldChange("street", event.target.value)}
          />
        </FieldLabelRow>
      </ContactChannelRow>
      <AddressSecondaryFields
        rowId={rowId}
        postalCode={postalCode}
        locality={locality}
        region={region}
        country={country}
        labels={labels}
        onFieldChange={onFieldChange}
      />
    </div>
  );
}

export function ContactAddressRows({
  addresses,
  labels,
  onUpdateAddress,
  onUpdateAddressContext,
  onRemoveAddress,
}: {
  addresses: ContactAddressDraft[];
  labels: ContactsUILabels;
  onUpdateAddress: (
    id: string,
    field: keyof Omit<ContactAddressDraft, "id" | "contextType">,
    value: string,
    contextType?: ContactChannelContext,
  ) => void;
  onUpdateAddressContext: (id: string, contextType: ContactChannelContext) => void;
  onRemoveAddress: (id: string) => void;
}) {
  const slot = useTrailingChannelSlot<ContactChannelContext>(CONTACT_CHANNEL_DEFAULT_CONTEXT);
  const requestFocus = useFocusAfterCommit();
  const typeAriaLabel = `${labels.channelType} ${labels.sectionAddresses}`;

  return (
    <>
      {addresses.map((row) => (
        <AddressEditor
          key={row.id}
          rowId={row.id}
          street={row.street}
          postalCode={row.postalCode}
          locality={row.locality}
          region={row.region}
          country={row.country}
          labels={labels}
          removeLabel={labels.removeRow}
          onRemove={() => onRemoveAddress(row.id)}
          typeControl={
            <ContactContextTypeSelect
              labels={labels}
              value={row.contextType}
              ariaLabel={typeAriaLabel}
              onChange={(contextType) => onUpdateAddressContext(row.id, contextType)}
            />
          }
          onFieldChange={(field, value) => onUpdateAddress(row.id, field, value)}
        />
      ))}
      <AddressEditor
        key={slot.id}
        rowId={slot.id}
        street=""
        postalCode=""
        locality=""
        region=""
        country=""
        labels={labels}
        trailing
        typeControl={
          <ContactContextTypeSelect
            labels={labels}
            value={slot.type}
            ariaLabel={typeAriaLabel}
            onChange={slot.setType}
          />
        }
        onFieldChange={(field, value) => {
          if (!value) return;
          const taken = slot.consume();
          requestFocus(addressFieldInputId(taken.id, field));
          onUpdateAddress(taken.id, field, value, taken.type);
        }}
      />
    </>
  );
}
