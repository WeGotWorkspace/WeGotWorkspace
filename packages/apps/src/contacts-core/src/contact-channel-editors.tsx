import type { ReactNode } from "react";
import { ExternalLink, Link2, Mail, MapPin, Phone, Trash2 } from "lucide-react";
import { IconButton } from "@/button/src/button";
import { DetailFieldAddRow, DetailFieldRow } from "@/detail-field-row/src/detail-field-row";
import { Input } from "@/ui/input";
import { ContactContextTypeSelect, ContactPhoneTypeSelect } from "./contact-channel-type-select";
import type {
  ContactAddressDraft,
  ContactChannelContext,
  ContactPhoneType,
} from "@/contacts-core/src/contacts-edit-utils";
import {
  phoneToTelHref,
  safeContactExternalHref,
} from "@/contacts-core/src/contacts-display-utils";
import type { ContactsUILabels } from "@/contacts-core/src/contacts-labels";

export function contactChannelValueInputId(rowId: string): string {
  return `contact-channel-value-${rowId}`;
}

export function contactAddressStreetInputId(rowId: string): string {
  return `contact-address-street-${rowId}`;
}

function openChannelHref(href: string): void {
  if (/^https?:/i.test(href)) {
    window.open(href, "_blank", "noopener,noreferrer");
    return;
  }
  window.location.href = href;
}

/** Call, write or open: the row's own action, beside remove. */
function ChannelRowActions({
  href,
  openLabel,
  openIcon,
  removeLabel,
  onRemove,
}: {
  href: string | null;
  openLabel: string;
  openIcon: ReactNode;
  removeLabel: string;
  onRemove?: () => void;
}) {
  if (!href && !onRemove) return null;
  return (
    <>
      {href ? (
        <IconButton
          label={openLabel}
          icon={openIcon}
          variant="ghost"
          size="sm"
          onClick={() => openChannelHref(href)}
        />
      ) : null}
      {onRemove ? (
        <IconButton
          label={removeLabel}
          icon={<Trash2 aria-hidden />}
          variant="ghost"
          severity="danger"
          size="sm"
          onClick={onRemove}
        />
      ) : null}
    </>
  );
}

type ChannelRowsProps<TType extends string> = {
  rows: Array<{ id: string; value: string; type: TType }>;
  icon: ReactNode;
  inputType: "tel" | "email" | "url";
  valueAriaLabel: string;
  placeholder: string;
  typeAriaLabel: string;
  removeLabel: string;
  addLabel: string;
  openLabel: string;
  openIcon: ReactNode;
  hrefFor: (value: string) => string | null;
  readOnly: boolean;
  typeControl: (args: {
    value: TType;
    onChange: (value: TType) => void;
    ariaLabel: string;
    disabled: boolean;
  }) => ReactNode;
  onUpdateValue: (id: string, value: string) => void;
  onUpdateType: (id: string, type: TType) => void;
  onRemove: (id: string) => void;
  /** Omit to hide the add row (read-only, or the field is added from "Add field"). */
  onAdd?: () => void;
};

/**
 * One detail row per phone, e-mail or website: the type as a ghost dropdown in the
 * label column, the value as a ghost field. "Add phone" below adds a row; typing
 * never adds one by itself. Read-only cards show filled rows only.
 */
function ChannelRows<TType extends string>({
  rows,
  icon,
  inputType,
  valueAriaLabel,
  placeholder,
  typeAriaLabel,
  removeLabel,
  addLabel,
  openLabel,
  openIcon,
  hrefFor,
  readOnly,
  typeControl,
  onUpdateValue,
  onUpdateType,
  onRemove,
  onAdd,
}: ChannelRowsProps<TType>) {
  const shown = readOnly ? rows.filter((row) => row.value.trim()) : rows;
  return (
    <>
      {shown.map((row) => (
        <DetailFieldRow
          key={row.id}
          className="contacts-detail-view__channel"
          icon={icon}
          label={typeControl({
            value: row.type,
            onChange: (next) => onUpdateType(row.id, next),
            ariaLabel: typeAriaLabel,
            disabled: readOnly,
          })}
          trailing={
            <ChannelRowActions
              href={hrefFor(row.value)}
              openLabel={openLabel}
              openIcon={openIcon}
              removeLabel={removeLabel}
              onRemove={readOnly ? undefined : () => onRemove(row.id)}
            />
          }
        >
          <Input
            id={contactChannelValueInputId(row.id)}
            type={inputType}
            variant="ghost"
            size="sm"
            aria-label={valueAriaLabel}
            placeholder={placeholder}
            value={row.value}
            readOnly={readOnly}
            onChange={(event) => onUpdateValue(row.id, event.target.value)}
          />
        </DetailFieldRow>
      ))}
      {!readOnly && onAdd ? <DetailFieldAddRow label={addLabel} onAdd={onAdd} /> : null}
    </>
  );
}

type ChannelEditorProps = {
  labels: ContactsUILabels;
  readOnly: boolean;
  onAdd?: () => void;
};

export function ContactPhoneRows({
  phones,
  labels,
  readOnly,
  onAdd,
  onUpdatePhone,
  onUpdatePhoneContext,
  onRemovePhone,
}: ChannelEditorProps & {
  phones: Array<{ id: string; number: string; phoneType: ContactPhoneType }>;
  onUpdatePhone: (id: string, number: string, phoneType?: ContactPhoneType) => void;
  onUpdatePhoneContext: (id: string, phoneType: ContactPhoneType) => void;
  onRemovePhone: (id: string) => void;
}) {
  return (
    <ChannelRows
      rows={phones.map((row) => ({ id: row.id, value: row.number, type: row.phoneType }))}
      icon={<Phone />}
      inputType="tel"
      valueAriaLabel={labels.phoneNumber}
      placeholder={labels.phoneNumber}
      typeAriaLabel={`${labels.channelType} ${labels.phoneNumber}`}
      removeLabel={labels.removeRow}
      addLabel={labels.addPhone}
      openLabel={labels.callPhone}
      openIcon={<Phone aria-hidden />}
      hrefFor={(value) => phoneToTelHref(value.trim())}
      readOnly={readOnly}
      typeControl={({ value, onChange, ariaLabel, disabled }) => (
        <ContactPhoneTypeSelect
          labels={labels}
          value={value}
          ariaLabel={ariaLabel}
          disabled={disabled}
          onChange={onChange}
        />
      )}
      onUpdateValue={onUpdatePhone}
      onUpdateType={onUpdatePhoneContext}
      onRemove={onRemovePhone}
      onAdd={onAdd}
    />
  );
}

export function ContactEmailRows({
  emails,
  labels,
  readOnly,
  onAdd,
  onUpdateEmail,
  onUpdateEmailContext,
  onRemoveEmail,
}: ChannelEditorProps & {
  emails: Array<{ id: string; address: string; contextType: ContactChannelContext }>;
  onUpdateEmail: (id: string, address: string, contextType?: ContactChannelContext) => void;
  onUpdateEmailContext: (id: string, contextType: ContactChannelContext) => void;
  onRemoveEmail: (id: string) => void;
}) {
  return (
    <ChannelRows
      rows={emails.map((row) => ({ id: row.id, value: row.address, type: row.contextType }))}
      icon={<Mail />}
      inputType="email"
      valueAriaLabel={labels.emailAddress}
      placeholder={labels.emailAddress}
      typeAriaLabel={`${labels.channelType} ${labels.emailAddress}`}
      removeLabel={labels.removeRow}
      addLabel={labels.addEmail}
      openLabel={labels.sendEmail}
      openIcon={<Mail aria-hidden />}
      hrefFor={(value) => (value.trim().includes("@") ? `mailto:${value.trim()}` : null)}
      readOnly={readOnly}
      typeControl={({ value, onChange, ariaLabel, disabled }) => (
        <ContactContextTypeSelect
          labels={labels}
          value={value}
          ariaLabel={ariaLabel}
          disabled={disabled}
          onChange={onChange}
        />
      )}
      onUpdateValue={onUpdateEmail}
      onUpdateType={onUpdateEmailContext}
      onRemove={onRemoveEmail}
      onAdd={onAdd}
    />
  );
}

export function ContactUrlRows({
  urls,
  labels,
  readOnly,
  onAdd,
  onUpdateUrl,
  onUpdateUrlContext,
  onRemoveUrl,
}: ChannelEditorProps & {
  urls: Array<{ id: string; uri: string; contextType: ContactChannelContext }>;
  onUpdateUrl: (id: string, uri: string, contextType?: ContactChannelContext) => void;
  onUpdateUrlContext: (id: string, contextType: ContactChannelContext) => void;
  onRemoveUrl: (id: string) => void;
}) {
  return (
    <ChannelRows
      rows={urls.map((row) => ({ id: row.id, value: row.uri, type: row.contextType }))}
      icon={<Link2 />}
      inputType="url"
      valueAriaLabel={labels.urlAddress}
      placeholder={labels.urlAddress}
      typeAriaLabel={`${labels.channelType} ${labels.urlAddress}`}
      removeLabel={labels.removeRow}
      addLabel={labels.addUrl}
      openLabel={labels.openWebsite}
      openIcon={<ExternalLink aria-hidden />}
      hrefFor={(value) => safeContactExternalHref(value.trim())}
      readOnly={readOnly}
      typeControl={({ value, onChange, ariaLabel, disabled }) => (
        <ContactContextTypeSelect
          labels={labels}
          value={value}
          ariaLabel={ariaLabel}
          disabled={disabled}
          onChange={onChange}
        />
      )}
      onUpdateValue={onUpdateUrl}
      onUpdateType={onUpdateUrlContext}
      onRemove={onRemoveUrl}
      onAdd={onAdd}
    />
  );
}

type AddressField = keyof Omit<ContactAddressDraft, "id" | "contextType">;

function addressHasValue(row: ContactAddressDraft): boolean {
  return [row.street, row.postalCode, row.locality, row.region, row.country].some((part) =>
    part.trim(),
  );
}

/**
 * One row per address: the type in the label column, then street, postal code and
 * city, region and country as ghost fields, one line each like a written address.
 */
export function ContactAddressRows({
  addresses,
  labels,
  readOnly,
  onAdd,
  onUpdateAddress,
  onUpdateAddressContext,
  onRemoveAddress,
}: ChannelEditorProps & {
  addresses: ContactAddressDraft[];
  onUpdateAddress: (
    id: string,
    field: AddressField,
    value: string,
    contextType?: ContactChannelContext,
  ) => void;
  onUpdateAddressContext: (id: string, contextType: ContactChannelContext) => void;
  onRemoveAddress: (id: string) => void;
}) {
  const shown = readOnly ? addresses.filter(addressHasValue) : addresses;
  const field = (row: ContactAddressDraft, name: AddressField, placeholder: string, id?: string) =>
    readOnly && !row[name].trim() ? null : (
      <Input
        id={id}
        variant="ghost"
        size="sm"
        className={`contacts-detail-view__address-${name}`}
        aria-label={placeholder}
        placeholder={placeholder}
        value={row[name]}
        readOnly={readOnly}
        onChange={(event) => onUpdateAddress(row.id, name, event.target.value)}
      />
    );
  return (
    <>
      {shown.map((row) => (
        <DetailFieldRow
          key={row.id}
          className="contacts-detail-view__channel contacts-detail-view__channel--address"
          icon={<MapPin />}
          label={
            <ContactContextTypeSelect
              labels={labels}
              value={row.contextType}
              ariaLabel={`${labels.channelType} ${labels.sectionAddresses}`}
              disabled={readOnly}
              onChange={(contextType) => onUpdateAddressContext(row.id, contextType)}
            />
          }
          trailing={
            readOnly ? null : (
              <IconButton
                label={labels.removeRow}
                icon={<Trash2 aria-hidden />}
                variant="ghost"
                severity="danger"
                size="sm"
                onClick={() => onRemoveAddress(row.id)}
              />
            )
          }
        >
          <div className="contacts-detail-view__address">
            {field(row, "street", labels.addressStreet, contactAddressStreetInputId(row.id))}
            <div className="contacts-detail-view__address-line">
              {field(row, "postalCode", labels.addressPostalCode)}
              {field(row, "locality", labels.addressLocality)}
            </div>
            {field(row, "region", labels.addressRegion)}
            {field(row, "country", labels.addressCountry)}
          </div>
        </DetailFieldRow>
      ))}
      {!readOnly && onAdd ? <DetailFieldAddRow label={labels.addAddress} onAdd={onAdd} /> : null}
    </>
  );
}
