import { describe, expect, it } from "vitest";
import {
  CONTACT_CHANNEL_SELECT_NONE,
  channelSelectValue,
  channelTypeLabel,
  channelValueFromSelect,
  contactChannelContextSelectOptions,
  contactPhoneTypeSelectOptions,
  phoneTypeLabel,
} from "./contacts-channel-select";
import { defaultContactsLabels } from "./contacts-labels";

describe("channelSelectValue", () => {
  it("maps an empty context to the none sentinel", () => {
    expect(channelSelectValue("")).toBe(CONTACT_CHANNEL_SELECT_NONE);
  });

  it("keeps concrete context values unchanged", () => {
    expect(channelSelectValue("work")).toBe("work");
    expect(channelSelectValue("home")).toBe("home");
  });
});

describe("channelValueFromSelect", () => {
  it("maps the none sentinel back to an empty context", () => {
    expect(channelValueFromSelect(CONTACT_CHANNEL_SELECT_NONE)).toBe("");
  });

  it("keeps concrete select values unchanged", () => {
    expect(channelValueFromSelect("school")).toBe("school");
  });
});

describe("channelTypeLabel", () => {
  it("returns localized labels including Other for empty context", () => {
    expect(channelTypeLabel("", defaultContactsLabels)).toBe(defaultContactsLabels.channelTypeNone);
    expect(channelTypeLabel("home", defaultContactsLabels)).toBe(
      defaultContactsLabels.channelTypeHome,
    );
    expect(channelTypeLabel("work", defaultContactsLabels)).toBe(
      defaultContactsLabels.channelTypeWork,
    );
    expect(channelTypeLabel("school", defaultContactsLabels)).toBe(
      defaultContactsLabels.channelTypeSchool,
    );
  });
});

describe("phoneTypeLabel", () => {
  it("labels mobile separately from channel contexts", () => {
    expect(phoneTypeLabel("mobile", defaultContactsLabels)).toBe(
      defaultContactsLabels.channelTypeMobile,
    );
    expect(phoneTypeLabel("work", defaultContactsLabels)).toBe(
      defaultContactsLabels.channelTypeWork,
    );
    expect(phoneTypeLabel("", defaultContactsLabels)).toBe(defaultContactsLabels.channelTypeNone);
  });
});

describe("contactChannelContextSelectOptions", () => {
  it("orders options alphabetically by displayed label (en)", () => {
    const options = contactChannelContextSelectOptions(defaultContactsLabels);
    expect(options.map((option) => option.label)).toEqual(["Home", "Other", "School", "Work"]);
    expect(options.map((option) => option.value)).toEqual(["home", "none", "school", "work"]);
  });

  it("sorts by displayed label, not catalog order", () => {
    const options = contactChannelContextSelectOptions({
      channelTypeNone: "Alpha",
      channelTypeHome: "Zebra",
      channelTypeWork: "Work",
      channelTypeSchool: "School",
    });
    expect(options.map((option) => option.label)).toEqual(["Alpha", "School", "Work", "Zebra"]);
  });
});

describe("contactPhoneTypeSelectOptions", () => {
  it("orders phone types alphabetically by displayed label (en)", () => {
    const options = contactPhoneTypeSelectOptions(defaultContactsLabels);
    expect(options.map((option) => option.label)).toEqual([
      "Home",
      "Mobile",
      "Other",
      "School",
      "Work",
    ]);
    expect(options.map((option) => option.value)).toEqual([
      "home",
      "mobile",
      "none",
      "school",
      "work",
    ]);
  });
});
