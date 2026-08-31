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
  it("builds compact-select options with a none sentinel", () => {
    const options = contactChannelContextSelectOptions(defaultContactsLabels);
    expect(options.map((option) => option.value)).toEqual(["none", "home", "work", "school"]);
    expect(options[0]?.label).toBe(defaultContactsLabels.channelTypeNone);
  });
});

describe("contactPhoneTypeSelectOptions", () => {
  it("includes mobile ahead of channel contexts", () => {
    const options = contactPhoneTypeSelectOptions(defaultContactsLabels);
    expect(options.map((option) => option.value)).toEqual([
      "none",
      "mobile",
      "home",
      "work",
      "school",
    ]);
    expect(options[1]?.label).toBe(defaultContactsLabels.channelTypeMobile);
  });
});
