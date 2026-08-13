declare const ianaTimeZoneBrand: unique symbol;
export type IANATimeZone = string & { readonly [ianaTimeZoneBrand]: true };

export const UTC_TIMEZONE = "Etc/UTC" as IANATimeZone;

const SUPPORTED_TIME_ZONES = new Set(
  typeof Intl.supportedValuesOf === "function"
    ? [...Intl.supportedValuesOf("timeZone"), UTC_TIMEZONE]
    : [UTC_TIMEZONE],
);

export function isIANATimeZone(value: string): value is IANATimeZone {
  return SUPPORTED_TIME_ZONES.has(value);
}

export function toIANATimeZone(value: string): IANATimeZone | null {
  return isIANATimeZone(value) ? value : null;
}
