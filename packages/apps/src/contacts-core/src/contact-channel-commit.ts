import type {
  ContactAddressDraft,
  ContactChannelContext,
  ContactEditDraft,
  ContactPhoneType,
} from "@/contacts-core/src/contacts-edit-utils";

type PhoneDraft = ContactEditDraft["phones"][number];
type EmailDraft = ContactEditDraft["emails"][number];
type UrlDraft = ContactEditDraft["urls"][number];

/**
 * Persist only real channel values. Typing into the empty trailing slot appends
 * one row; the UI always shows one extra blank row — it is not stored here.
 */
export function phonesAfterNumberChange(args: {
  phones: PhoneDraft[];
  rowId: string;
  number: string;
  phoneType?: ContactPhoneType;
}): PhoneDraft[] {
  if (args.phones.some((row) => row.id === args.rowId)) {
    return args.phones.map((row) =>
      row.id === args.rowId ? { ...row, number: args.number } : row,
    );
  }
  if (!args.number.trim()) return args.phones;
  return [...args.phones, { id: args.rowId, number: args.number, phoneType: args.phoneType ?? "" }];
}

export function emailsAfterAddressChange(args: {
  emails: EmailDraft[];
  rowId: string;
  address: string;
  contextType?: ContactChannelContext;
}): EmailDraft[] {
  if (args.emails.some((row) => row.id === args.rowId)) {
    return args.emails.map((row) =>
      row.id === args.rowId ? { ...row, address: args.address } : row,
    );
  }
  if (!args.address.trim()) return args.emails;
  return [
    ...args.emails,
    { id: args.rowId, address: args.address, contextType: args.contextType ?? "" },
  ];
}

export function urlsAfterUriChange(args: {
  urls: UrlDraft[];
  rowId: string;
  uri: string;
  contextType?: ContactChannelContext;
}): UrlDraft[] {
  if (args.urls.some((row) => row.id === args.rowId)) {
    return args.urls.map((row) => (row.id === args.rowId ? { ...row, uri: args.uri } : row));
  }
  if (!args.uri.trim()) return args.urls;
  return [...args.urls, { id: args.rowId, uri: args.uri, contextType: args.contextType ?? "" }];
}

export function addressesAfterFieldChange(args: {
  addresses: ContactAddressDraft[];
  rowId: string;
  field: keyof Omit<ContactAddressDraft, "id" | "contextType">;
  value: string;
  contextType?: ContactChannelContext;
}): ContactAddressDraft[] {
  if (args.addresses.some((row) => row.id === args.rowId)) {
    return args.addresses.map((row) =>
      row.id === args.rowId ? { ...row, [args.field]: args.value } : row,
    );
  }
  if (!args.value.trim()) return args.addresses;
  return [
    ...args.addresses,
    {
      id: args.rowId,
      street: "",
      locality: "",
      region: "",
      postalCode: "",
      country: "",
      contextType: args.contextType ?? "",
      [args.field]: args.value,
    },
  ];
}
