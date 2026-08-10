import type { ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, IconButton } from "@/button/src/button";
import { ContactUserAvatar } from "./contact-user-avatar";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import { Textarea } from "@/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { Switch } from "@/ui/switch";
import { cn } from "@/lib/utils";
import { Tag } from "@/tag/src/tag";
import type { ContactCard } from "@/contacts-core/src/contacts-types";
import {
  CONTACT_CHANNEL_CONTEXTS,
  CONTACT_PHONE_TYPES,
  type ContactAddressDraft,
  type ContactChannelContext,
  type ContactEditDraft,
  type ContactPhoneType,
} from "@/contacts-core/src/contacts-edit-utils";
import {
  contactDisplayName,
  contactListSubtitle,
  contactPersonName,
  channelDisplayLabels,
  contactBirthdayDisplay,
  mapEntriesSorted,
  phoneToTelHref,
  safeContactExternalHref,
} from "@/contacts-core/src/contacts-display-utils";
import type { ContactsUILabels } from "@/contacts-core/src/contacts-labels";

type ContactsDetailViewProps = {
  labels: ContactsUILabels;
  card?: ContactCard;
  createMode: boolean;
  editMode: boolean;
  editDraft: ContactEditDraft | null;
  displayName: string;
  onDraftChange: (patch: Partial<ContactEditDraft>) => void;
  onAddPhone: () => void;
  onAddEmail: () => void;
  onAddAddress: () => void;
  onUpdatePhone: (id: string, number: string) => void;
  onUpdateEmail: (id: string, address: string) => void;
  onUpdatePhoneContext: (id: string, phoneType: ContactPhoneType) => void;
  onUpdateEmailContext: (id: string, contextType: ContactChannelContext) => void;
  onUpdateAddress: (
    id: string,
    field: keyof Omit<ContactAddressDraft, "id" | "contextType">,
    value: string,
  ) => void;
  onUpdateAddressContext: (id: string, contextType: ContactChannelContext) => void;
  onAddUrl: () => void;
  onUpdateUrl: (id: string, uri: string) => void;
  onUpdateUrlContext: (id: string, contextType: ContactChannelContext) => void;
  onRemoveUrl: (id: string) => void;
  onRemovePhone: (id: string) => void;
  onRemoveEmail: (id: string) => void;
  onRemoveAddress: (id: string) => void;
  className?: string;
};

function phoneDisplayValue(phone: NonNullable<ContactCard["phones"]>[string]): string {
  if (typeof phone.number === "string") return phone.number.trim();
  if (typeof phone.uri === "string") return phone.uri.trim();
  return "";
}

type AddressDisplayLines = {
  street: string;
  localityLine: string;
  region: string;
  country: string;
};

function readAddressComponentValue(
  components: NonNullable<ContactCard["addresses"]>[string]["components"],
  kind: string,
): string {
  return (components ?? [])
    .filter((component) => component.kind === kind)
    .map((component) => component.value?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
}

function readLegacyAddressField(
  address: NonNullable<ContactCard["addresses"]>[string],
  field: "street" | "locality" | "region" | "postcode" | "country",
): string {
  const value = (address as Record<string, unknown>)[field];
  return typeof value === "string" ? value.trim() : "";
}

function readCardAddressStreet(address: NonNullable<ContactCard["addresses"]>[string]): string {
  const components = address.components ?? [];
  const name = readAddressComponentValue(components, "name");
  const number = readAddressComponentValue(components, "number");
  if (number && name) return `${number} ${name}`.trim();
  if (name) return name;
  if (number) return number;
  const legacyStreet = readLegacyAddressField(address, "street");
  if (legacyStreet) return legacyStreet;
  if (typeof address.full === "string" && address.full.trim()) return address.full.trim();
  const fromComponents = components
    .map((part) => part.value?.trim())
    .filter(Boolean)
    .join(", ");
  return fromComponents;
}

function formatLocalityLine(postalCode: string, locality: string): string {
  return [postalCode, locality]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

function addressDisplayFromCard(
  address: NonNullable<ContactCard["addresses"]>[string],
): AddressDisplayLines {
  const components = address.components ?? [];
  return {
    street: readCardAddressStreet(address),
    localityLine: formatLocalityLine(
      readAddressComponentValue(components, "postcode") ||
        readLegacyAddressField(address, "postcode"),
      readAddressComponentValue(components, "locality") ||
        readLegacyAddressField(address, "locality"),
    ),
    region:
      readAddressComponentValue(components, "region") || readLegacyAddressField(address, "region"),
    country:
      readAddressComponentValue(components, "country") ||
      readLegacyAddressField(address, "country"),
  };
}

function AddressDisplayBlock({ lines }: { lines: AddressDisplayLines }) {
  const rows = [lines.street, lines.localityLine, lines.region, lines.country].filter(Boolean);
  if (rows.length === 0) return null;
  return (
    <div className="contacts-detail-view__address-lines">
      {lines.street ? <span>{lines.street}</span> : null}
      {lines.localityLine ? <span>{lines.localityLine}</span> : null}
      {lines.region ? <span>{lines.region}</span> : null}
      {lines.country ? <span>{lines.country}</span> : null}
    </div>
  );
}

function ChannelReadRow({
  contextLabels,
  emptyLabel,
  children,
}: {
  contextLabels?: string[];
  emptyLabel?: string;
  children: ReactNode;
}) {
  const hasLabels = Boolean(contextLabels?.length);
  return (
    <li className="contacts-detail-view__channel-row">
      {hasLabels ? (
        <div className="contacts-detail-view__channel-type">
          {contextLabels?.map((label, index) => (
            <Tag key={`${label}-${index}`} label={label} />
          ))}
        </div>
      ) : emptyLabel ? (
        <div className="contacts-detail-view__channel-type">
          <span className="contacts-detail-view__label--none">{emptyLabel}</span>
        </div>
      ) : (
        <span className="contacts-detail-view__channel-type" aria-hidden="true" />
      )}
      <div className="contacts-detail-view__channel-value">{children}</div>
    </li>
  );
}

function channelTypeLabel(contextType: ContactChannelContext, labels: ContactsUILabels): string {
  if (contextType === "work") return labels.channelTypeWork;
  if (contextType === "home") return labels.channelTypeHome;
  if (contextType === "school") return labels.channelTypeSchool;
  return labels.channelTypeNone;
}

function phoneTypeLabel(phoneType: ContactPhoneType, labels: ContactsUILabels): string {
  if (phoneType === "mobile") return labels.channelTypeMobile;
  return channelTypeLabel(phoneType, labels);
}

function ContextTypeSelect({
  labels,
  value,
  onChange,
  ariaLabel,
}: {
  labels: ContactsUILabels;
  value: ContactChannelContext;
  onChange: (value: ContactChannelContext) => void;
  ariaLabel: string;
}) {
  return (
    <Select
      value={value || "none"}
      onValueChange={(next) => onChange(next === "none" ? "" : (next as ContactChannelContext))}
    >
      <SelectTrigger aria-label={ariaLabel} className="contacts-detail-view__context-select">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {CONTACT_CHANNEL_CONTEXTS.map((contextType) => (
          <SelectItem key={contextType || "none"} value={contextType || "none"}>
            {channelTypeLabel(contextType, labels)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PhoneTypeSelect({
  labels,
  value,
  onChange,
  ariaLabel,
}: {
  labels: ContactsUILabels;
  value: ContactPhoneType;
  onChange: (value: ContactPhoneType) => void;
  ariaLabel: string;
}) {
  return (
    <Select
      value={value || "none"}
      onValueChange={(next) => onChange(next === "none" ? "" : (next as ContactPhoneType))}
    >
      <SelectTrigger aria-label={ariaLabel} className="contacts-detail-view__context-select">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {CONTACT_PHONE_TYPES.map((phoneType) => (
          <SelectItem key={phoneType || "none"} value={phoneType || "none"}>
            {phoneTypeLabel(phoneType, labels)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function DetailSection({
  title,
  children,
  hidden,
}: {
  title: string;
  children: ReactNode;
  hidden?: boolean;
}) {
  if (hidden) return null;
  return (
    <section className="contacts-detail-view__section">
      <h2 className="contacts-detail-view__section-title">{title}</h2>
      <div className="contacts-detail-view__section-body">{children}</div>
    </section>
  );
}

export function ContactsDetailView({
  labels,
  card,
  createMode,
  editMode,
  editDraft,
  displayName,
  onDraftChange,
  onAddPhone,
  onAddEmail,
  onAddAddress,
  onUpdatePhone,
  onUpdateEmail,
  onUpdatePhoneContext,
  onUpdateEmailContext,
  onUpdateAddress,
  onUpdateAddressContext,
  onAddUrl,
  onUpdateUrl,
  onUpdateUrlContext,
  onRemoveUrl,
  onRemovePhone,
  onRemoveEmail,
  onRemoveAddress,
  className,
}: ContactsDetailViewProps) {
  const isEditing = editMode && !!editDraft;

  const readPhones = isEditing
    ? (editDraft?.phones ?? [])
    : mapEntriesSorted(card?.phones).map(([id, phone]) => ({
        id,
        number: phoneDisplayValue(phone),
        contextLabels: channelDisplayLabels(phone.contexts, labels, {
          features: phone.features,
          customLabel: phone.label,
        }),
      }));

  const readEmails = isEditing
    ? (editDraft?.emails ?? [])
    : mapEntriesSorted(card?.emails).map(([id, email]) => ({
        id,
        address: email.address?.trim() || "",
        contextLabels: channelDisplayLabels(email.contexts, labels, {
          customLabel: email.label,
        }),
      }));

  const readAddresses = isEditing
    ? (editDraft?.addresses ?? [])
    : mapEntriesSorted(card?.addresses).map(([id, address]) => ({
        id,
        lines: addressDisplayFromCard(address),
        contextLabels: channelDisplayLabels(address.contexts, labels, {
          customLabel: typeof address.label === "string" ? address.label : undefined,
        }),
      }));

  const readUrls = isEditing
    ? (editDraft?.urls ?? [])
    : mapEntriesSorted(card?.links)
        .filter(([, link]) => link.kind !== "contact")
        .map(([id, link]) => ({
          id,
          uri: link.uri?.trim() ?? "",
          contextLabels: channelDisplayLabels(link.contexts, labels, {
            customLabel: link.label,
          }),
        }));

  const personName = isEditing
    ? ""
    : (() => {
        if (!card) return "";
        return contactPersonName(card);
      })();

  const organization = isEditing
    ? (editDraft?.organization ?? "")
    : (() => {
        const name = mapEntriesSorted(card?.organizations)[0]?.[1]?.name;
        return typeof name === "string" ? name.trim() : "";
      })();

  const jobTitle = isEditing
    ? (editDraft?.title ?? "")
    : (() => {
        const entry =
          mapEntriesSorted(card?.titles).find(([, title]) => (title.kind ?? "title") === "title") ??
          mapEntriesSorted(card?.titles)[0];
        return entry?.[1]?.name?.trim() ?? "";
      })();

  const jobDepartment = isEditing
    ? (editDraft?.department ?? "")
    : (() => {
        const unit = mapEntriesSorted(card?.organizations)[0]?.[1]?.units?.[0]?.name;
        return typeof unit === "string" ? unit.trim() : "";
      })();

  /** Identity lines under the header name (view mode only). */
  const viewIdentityLines = (() => {
    if (isEditing || !card) return [] as string[];
    const lines: string[] = [];
    if (card.kind === "org") {
      const subtitle = contactListSubtitle(card);
      if (subtitle) lines.push(subtitle);
      if (jobTitle) lines.push(jobTitle);
      if (jobDepartment) lines.push(jobDepartment);
      return lines;
    }
    if (jobTitle) lines.push(jobTitle);
    const orgLine = [jobDepartment, organization].filter(Boolean).join(" · ");
    if (orgLine) lines.push(orgLine);
    return lines;
  })();

  const notes = isEditing
    ? (editDraft?.notes ?? "")
    : (() => {
        const note = mapEntriesSorted(card?.notes)[0]?.[1]?.note;
        return typeof note === "string" ? note.trim() : "";
      })();

  const showAsCompany = !!editDraft?.showAsCompany;

  const nameFields =
    isEditing && editDraft ? (
      <>
        <div className="contacts-detail-view__name-row">
          <FieldLabelRow label={labels.nameGiven} htmlFor="contact-given-name">
            <Input
              id="contact-given-name"
              value={editDraft.nameGiven}
              onChange={(event) => onDraftChange({ nameGiven: event.target.value })}
            />
          </FieldLabelRow>
          <FieldLabelRow label={labels.nameSurname} htmlFor="contact-surname">
            <Input
              id="contact-surname"
              value={editDraft.nameSurname}
              onChange={(event) => onDraftChange({ nameSurname: event.target.value })}
            />
          </FieldLabelRow>
        </div>
        {editDraft.showGiven2 ? (
          <FieldLabelRow label={labels.nameGiven2} htmlFor="contact-given2-name">
            <Input
              id="contact-given2-name"
              value={editDraft.nameGiven2}
              onChange={(event) => onDraftChange({ nameGiven2: event.target.value })}
            />
          </FieldLabelRow>
        ) : null}
      </>
    ) : null;

  const organizationField =
    isEditing && editDraft ? (
      <FieldLabelRow label={labels.organizationName} htmlFor="contact-organization">
        <Input
          id="contact-organization"
          value={editDraft.organization}
          onChange={(event) => onDraftChange({ organization: event.target.value })}
        />
      </FieldLabelRow>
    ) : null;

  const jobFields =
    isEditing && editDraft ? (
      <div className="contacts-detail-view__job-row">
        <FieldLabelRow label={labels.jobTitle} htmlFor="contact-job-title">
          <Input
            id="contact-job-title"
            value={editDraft.title}
            onChange={(event) => onDraftChange({ title: event.target.value })}
          />
        </FieldLabelRow>
        <FieldLabelRow label={labels.jobDepartment} htmlFor="contact-job-department">
          <Input
            id="contact-job-department"
            value={editDraft.department}
            onChange={(event) => onDraftChange({ department: event.target.value })}
          />
        </FieldLabelRow>
      </div>
    ) : null;

  const companyToggle =
    isEditing && editDraft ? (
      <FieldLabelRow label={labels.companyContact}>
        <Switch
          checked={editDraft.showAsCompany}
          onCheckedChange={(checked) => onDraftChange({ showAsCompany: checked })}
          aria-label={labels.companyContact}
        />
      </FieldLabelRow>
    ) : null;

  return (
    <article className={cn("contacts-detail-view", className)}>
      <header className="contacts-detail-view__header">
        <ContactUserAvatar card={card} displayName={displayName} size="lg" compact />
        {!isEditing && card ? (
          <div className="contacts-detail-view__heading">
            <h1 className="contacts-detail-view__title">{contactDisplayName(card)}</h1>
            {viewIdentityLines.map((line, index) => (
              <p key={`${index}-${line}`} className="contacts-detail-view__subtitle">
                {line}
              </p>
            ))}
          </div>
        ) : null}
        {createMode && isEditing ? (
          <h1 className="contacts-detail-view__title">{labels.newContact}</h1>
        ) : null}
      </header>

      <DetailSection
        title={labels.sectionName}
        hidden={!isEditing && (!personName || card?.kind !== "group")}
      >
        {isEditing && editDraft ? (
          <div className="contacts-detail-view__field-stack">
            {showAsCompany ? (
              <>
                {organizationField}
                {nameFields}
                {jobFields}
                {companyToggle}
              </>
            ) : (
              <>
                {nameFields}
                {jobFields}
                {organizationField}
                {companyToggle}
              </>
            )}
          </div>
        ) : (
          <p className="contacts-detail-view__text">{personName}</p>
        )}
      </DetailSection>

      {!isEditing && card
        ? (() => {
            const birthday = contactBirthdayDisplay(card);
            return birthday ? (
              <DetailSection title={labels.sectionBirthday}>
                <p className="contacts-detail-view__text">{birthday}</p>
              </DetailSection>
            ) : null;
          })()
        : null}

      <DetailSection title={labels.sectionPhones} hidden={!isEditing && readPhones.length === 0}>
        {isEditing && editDraft ? (
          <div className="contacts-detail-view__editable-list">
            {editDraft.phones.map((row) => (
              <div
                key={row.id}
                className="contacts-detail-view__channel-row contacts-detail-view__channel-row--editable"
              >
                <div className="contacts-detail-view__channel-type">
                  <PhoneTypeSelect
                    labels={labels}
                    value={row.phoneType}
                    ariaLabel={`${labels.channelType} ${labels.phoneNumber}`}
                    onChange={(phoneType) => onUpdatePhoneContext(row.id, phoneType)}
                  />
                </div>
                <Input
                  aria-label={labels.phoneNumber}
                  value={row.number}
                  onChange={(event) => onUpdatePhone(row.id, event.target.value)}
                />
                <IconButton
                  label={labels.removeRow}
                  icon={<Trash2 className="size-4" aria-hidden />}
                  variant="subtle"
                  size="sm"
                  onClick={() => onRemovePhone(row.id)}
                />
              </div>
            ))}
            <Button
              className="contacts-detail-view__add-row"
              label={labels.addPhone}
              icon={<Plus />}
              variant="ghost"
              size="sm"
              onClick={onAddPhone}
            />
          </div>
        ) : (
          <ul className="contacts-detail-view__channel-list">
            {readPhones.map((row) => {
              const number = "number" in row ? row.number : "";
              const telHref = phoneToTelHref(number);
              return (
                <ChannelReadRow
                  key={row.id}
                  contextLabels={"contextLabels" in row ? row.contextLabels : undefined}
                  emptyLabel={labels.channelLabelNone}
                >
                  {telHref ? (
                    <a className="contacts-detail-view__link" href={telHref}>
                      {number}
                    </a>
                  ) : (
                    <span>{number}</span>
                  )}
                </ChannelReadRow>
              );
            })}
          </ul>
        )}
      </DetailSection>

      <DetailSection title={labels.sectionEmails} hidden={!isEditing && readEmails.length === 0}>
        {isEditing && editDraft ? (
          <div className="contacts-detail-view__editable-list">
            {editDraft.emails.map((row) => (
              <div
                key={row.id}
                className="contacts-detail-view__channel-row contacts-detail-view__channel-row--editable"
              >
                <div className="contacts-detail-view__channel-type">
                  <ContextTypeSelect
                    labels={labels}
                    value={row.contextType}
                    ariaLabel={`${labels.channelType} ${labels.emailAddress}`}
                    onChange={(contextType) => onUpdateEmailContext(row.id, contextType)}
                  />
                </div>
                <Input
                  aria-label={labels.emailAddress}
                  value={row.address}
                  onChange={(event) => onUpdateEmail(row.id, event.target.value)}
                />
                <IconButton
                  label={labels.removeRow}
                  icon={<Trash2 className="size-4" aria-hidden />}
                  variant="subtle"
                  size="sm"
                  onClick={() => onRemoveEmail(row.id)}
                />
              </div>
            ))}
            <Button
              className="contacts-detail-view__add-row"
              label={labels.addEmail}
              icon={<Plus />}
              variant="ghost"
              size="sm"
              onClick={onAddEmail}
            />
          </div>
        ) : (
          <ul className="contacts-detail-view__channel-list">
            {readEmails.map((row) => (
              <ChannelReadRow
                key={row.id}
                contextLabels={"contextLabels" in row ? row.contextLabels : undefined}
                emptyLabel={labels.channelLabelNone}
              >
                <span>{"address" in row ? row.address : ""}</span>
              </ChannelReadRow>
            ))}
          </ul>
        )}
      </DetailSection>

      <DetailSection
        title={labels.sectionAddresses}
        hidden={!isEditing && readAddresses.length === 0}
      >
        {isEditing && editDraft ? (
          <div className="contacts-detail-view__editable-list contacts-detail-view__address-list">
            {editDraft.addresses.map((row) => (
              <div
                key={row.id}
                className="contacts-detail-view__channel-row contacts-detail-view__channel-row--editable contacts-detail-view__channel-row--address"
              >
                <div className="contacts-detail-view__channel-type">
                  <ContextTypeSelect
                    labels={labels}
                    value={row.contextType}
                    ariaLabel={`${labels.channelType} ${labels.sectionAddresses}`}
                    onChange={(contextType) => onUpdateAddressContext(row.id, contextType)}
                  />
                </div>
                <div className="contacts-detail-view__address-fields">
                  <FieldLabelRow
                    label={labels.addressStreet}
                    htmlFor={`contact-address-street-${row.id}`}
                  >
                    <Input
                      id={`contact-address-street-${row.id}`}
                      value={row.street}
                      onChange={(event) => onUpdateAddress(row.id, "street", event.target.value)}
                    />
                  </FieldLabelRow>
                  <div className="contacts-detail-view__address-locality-row">
                    <FieldLabelRow
                      label={labels.addressPostalCode}
                      htmlFor={`contact-address-postal-${row.id}`}
                    >
                      <Input
                        id={`contact-address-postal-${row.id}`}
                        value={row.postalCode}
                        onChange={(event) =>
                          onUpdateAddress(row.id, "postalCode", event.target.value)
                        }
                      />
                    </FieldLabelRow>
                    <FieldLabelRow
                      label={labels.addressLocality}
                      htmlFor={`contact-address-locality-${row.id}`}
                    >
                      <Input
                        id={`contact-address-locality-${row.id}`}
                        value={row.locality}
                        onChange={(event) =>
                          onUpdateAddress(row.id, "locality", event.target.value)
                        }
                      />
                    </FieldLabelRow>
                  </div>
                  <FieldLabelRow
                    label={labels.addressRegion}
                    htmlFor={`contact-address-region-${row.id}`}
                  >
                    <Input
                      id={`contact-address-region-${row.id}`}
                      value={row.region}
                      onChange={(event) => onUpdateAddress(row.id, "region", event.target.value)}
                    />
                  </FieldLabelRow>
                  <FieldLabelRow
                    label={labels.addressCountry}
                    htmlFor={`contact-address-country-${row.id}`}
                  >
                    <Input
                      id={`contact-address-country-${row.id}`}
                      value={row.country}
                      onChange={(event) => onUpdateAddress(row.id, "country", event.target.value)}
                    />
                  </FieldLabelRow>
                </div>
                <IconButton
                  className="contacts-detail-view__address-remove"
                  label={labels.removeRow}
                  icon={<Trash2 className="size-4" aria-hidden />}
                  variant="subtle"
                  size="sm"
                  onClick={() => onRemoveAddress(row.id)}
                />
              </div>
            ))}
            <Button
              className="contacts-detail-view__add-row"
              label={labels.addAddress}
              icon={<Plus />}
              variant="ghost"
              size="sm"
              onClick={onAddAddress}
            />
          </div>
        ) : (
          <ul className="contacts-detail-view__channel-list">
            {readAddresses.map((row) => (
              <ChannelReadRow
                key={row.id}
                contextLabels={"contextLabels" in row ? row.contextLabels : undefined}
                emptyLabel={labels.channelLabelNone}
              >
                {"lines" in row ? <AddressDisplayBlock lines={row.lines} /> : null}
              </ChannelReadRow>
            ))}
          </ul>
        )}
      </DetailSection>

      <DetailSection title={labels.sectionUrls} hidden={!isEditing && readUrls.length === 0}>
        {isEditing && editDraft ? (
          <div className="contacts-detail-view__editable-list">
            {editDraft.urls.map((row) => (
              <div
                key={row.id}
                className="contacts-detail-view__channel-row contacts-detail-view__channel-row--editable"
              >
                <div className="contacts-detail-view__channel-type">
                  <ContextTypeSelect
                    labels={labels}
                    value={row.contextType}
                    ariaLabel={`${labels.channelType} ${labels.urlAddress}`}
                    onChange={(contextType) => onUpdateUrlContext(row.id, contextType)}
                  />
                </div>
                <Input
                  aria-label={labels.urlAddress}
                  value={row.uri}
                  onChange={(event) => onUpdateUrl(row.id, event.target.value)}
                />
                <IconButton
                  label={labels.removeRow}
                  icon={<Trash2 className="size-4" aria-hidden />}
                  variant="subtle"
                  size="sm"
                  onClick={() => onRemoveUrl(row.id)}
                />
              </div>
            ))}
            <Button
              className="contacts-detail-view__add-row"
              label={labels.addUrl}
              icon={<Plus />}
              variant="ghost"
              size="sm"
              onClick={onAddUrl}
            />
          </div>
        ) : (
          <ul className="contacts-detail-view__channel-list">
            {readUrls.map((row) => {
              const href = safeContactExternalHref(row.uri);
              return (
                <ChannelReadRow
                  key={row.id}
                  contextLabels={"contextLabels" in row ? row.contextLabels : undefined}
                  emptyLabel={labels.channelLabelNone}
                >
                  {href ? (
                    <a
                      className="contacts-detail-view__link"
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {row.uri}
                    </a>
                  ) : (
                    <span>{row.uri}</span>
                  )}
                </ChannelReadRow>
              );
            })}
          </ul>
        )}
      </DetailSection>

      <DetailSection title={labels.sectionNotes} hidden={!isEditing && !notes}>
        {isEditing && editDraft ? (
          <Textarea
            id="contact-notes"
            className="contacts-detail-view__notes"
            aria-label={labels.sectionNotes}
            value={editDraft.notes}
            onChange={(event) => onDraftChange({ notes: event.target.value })}
          />
        ) : (
          <p className="contacts-detail-view__text">{notes}</p>
        )}
      </DetailSection>
    </article>
  );
}
