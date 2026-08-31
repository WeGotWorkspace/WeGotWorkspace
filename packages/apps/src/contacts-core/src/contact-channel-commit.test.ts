import { describe, expect, it } from "vitest";
import {
  addressesAfterFieldChange,
  emailsAfterAddressChange,
  phonesAfterNumberChange,
  urlsAfterUriChange,
} from "./contact-channel-commit";

describe("phonesAfterNumberChange", () => {
  const existing = [{ id: "phone-1", number: "+1-555-0101", phoneType: "work" as const }];

  it("appends a real phone from the trailing empty slot", () => {
    expect(
      phonesAfterNumberChange({
        phones: [],
        rowId: "phone-new",
        number: "555",
        phoneType: "mobile",
      }),
    ).toEqual([{ id: "phone-new", number: "555", phoneType: "mobile" }]);
  });

  it("does not store a blank trailing slot", () => {
    expect(
      phonesAfterNumberChange({ phones: existing, rowId: "phone-new", number: "   " }),
    ).toEqual(existing);
  });

  it("updates an existing row number", () => {
    expect(phonesAfterNumberChange({ phones: existing, rowId: "phone-1", number: "999" })).toEqual([
      { id: "phone-1", number: "999", phoneType: "work" },
    ]);
  });
});

describe("emailsAfterAddressChange", () => {
  it("appends from the trailing slot and ignores blanks", () => {
    expect(
      emailsAfterAddressChange({
        emails: [],
        rowId: "email-new",
        address: "a@b.com",
        contextType: "work",
      }),
    ).toEqual([{ id: "email-new", address: "a@b.com", contextType: "work" }]);
    expect(emailsAfterAddressChange({ emails: [], rowId: "email-new", address: "" })).toEqual([]);
  });
});

describe("urlsAfterUriChange", () => {
  it("appends from the trailing slot and ignores blanks", () => {
    expect(
      urlsAfterUriChange({
        urls: [],
        rowId: "url-new",
        uri: "https://example.com",
        contextType: "home",
      }),
    ).toEqual([{ id: "url-new", uri: "https://example.com", contextType: "home" }]);
    expect(urlsAfterUriChange({ urls: [], rowId: "url-new", uri: "  " })).toEqual([]);
  });
});

describe("addressesAfterFieldChange", () => {
  it("appends a real address from the trailing slot on first field value", () => {
    expect(
      addressesAfterFieldChange({
        addresses: [],
        rowId: "addr-new",
        field: "street",
        value: "1 Main",
        contextType: "work",
      }),
    ).toEqual([
      {
        id: "addr-new",
        street: "1 Main",
        locality: "",
        region: "",
        postalCode: "",
        country: "",
        contextType: "work",
      },
    ]);
  });

  it("does not store a blank trailing slot", () => {
    expect(
      addressesAfterFieldChange({
        addresses: [],
        rowId: "addr-new",
        field: "street",
        value: "",
      }),
    ).toEqual([]);
    expect(
      addressesAfterFieldChange({
        addresses: [],
        rowId: "addr-new",
        field: "street",
        value: "  ",
      }),
    ).toEqual([]);
  });

  it("updates an existing address field", () => {
    const existing = [
      {
        id: "addr-1",
        street: "Old",
        locality: "Town",
        region: "",
        postalCode: "",
        country: "",
        contextType: "" as const,
      },
    ];
    expect(
      addressesAfterFieldChange({
        addresses: existing,
        rowId: "addr-1",
        field: "street",
        value: "New",
      }),
    ).toEqual([{ ...existing[0], street: "New" }]);
  });
});
