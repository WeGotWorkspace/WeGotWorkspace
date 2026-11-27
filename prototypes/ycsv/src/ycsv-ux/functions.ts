import * as formulajs from "@formulajs/formulajs";

export type FnSig = { name: string; params: string[]; summary: string };

/** Signatures for the functions people use most; others still autocomplete by name. */
const SIGS: FnSig[] = [
  { name: "SUM", params: ["number1", "[number2]", "…"], summary: "Adds numbers and ranges." },
  { name: "AVERAGE", params: ["number1", "[number2]", "…"], summary: "Average of numbers and ranges." },
  { name: "MIN", params: ["number1", "[number2]", "…"], summary: "Smallest value." },
  { name: "MAX", params: ["number1", "[number2]", "…"], summary: "Largest value." },
  { name: "COUNT", params: ["value1", "[value2]", "…"], summary: "Counts cells that hold numbers." },
  { name: "COUNTA", params: ["value1", "[value2]", "…"], summary: "Counts cells that are not empty." },
  { name: "IF", params: ["condition", "value_if_true", "[value_if_false]"], summary: "One value when the condition holds, another when not." },
  { name: "IFERROR", params: ["value", "value_if_error"], summary: "A fallback when the value is an error." },
  { name: "ROUND", params: ["number", "digits"], summary: "Rounds to a number of digits." },
  { name: "ROUNDUP", params: ["number", "digits"], summary: "Rounds away from zero." },
  { name: "ROUNDDOWN", params: ["number", "digits"], summary: "Rounds toward zero." },
  { name: "ABS", params: ["number"], summary: "Absolute value." },
  { name: "SUMIF", params: ["range", "criterion", "[sum_range]"], summary: "Adds the cells that meet a criterion." },
  { name: "COUNTIF", params: ["range", "criterion"], summary: "Counts the cells that meet a criterion." },
  { name: "AVERAGEIF", params: ["range", "criterion", "[average_range]"], summary: "Average of the cells that meet a criterion." },
  { name: "AND", params: ["logical1", "[logical2]", "…"], summary: "True when every argument is true." },
  { name: "OR", params: ["logical1", "[logical2]", "…"], summary: "True when any argument is true." },
  { name: "NOT", params: ["logical"], summary: "Flips true and false." },
  { name: "CONCATENATE", params: ["text1", "[text2]", "…"], summary: "Joins text." },
  { name: "LEFT", params: ["text", "[count]"], summary: "First characters of a text." },
  { name: "RIGHT", params: ["text", "[count]"], summary: "Last characters of a text." },
  { name: "LEN", params: ["text"], summary: "Number of characters." },
  { name: "UPPER", params: ["text"], summary: "Text in capitals." },
  { name: "LOWER", params: ["text"], summary: "Text in lower case." },
  { name: "TRIM", params: ["text"], summary: "Removes extra spaces." },
  { name: "TODAY", params: [], summary: "Today's date." },
  { name: "DATE", params: ["year", "month", "day"], summary: "A date from parts." },
  { name: "YEAR", params: ["date"], summary: "Year of a date." },
  { name: "MONTH", params: ["date"], summary: "Month of a date." },
  { name: "DAY", params: ["date"], summary: "Day of a date." },
  { name: "PRODUCT", params: ["number1", "[number2]", "…"], summary: "Multiplies numbers and ranges." },
  { name: "MEDIAN", params: ["number1", "[number2]", "…"], summary: "Middle value." },
];

const BY_NAME = new Map(SIGS.map((sig) => [sig.name, sig]));

export const FUNCTION_NAMES: string[] = (() => {
  const all = Object.keys(formulajs).filter(
    (key) => typeof (formulajs as Record<string, unknown>)[key] === "function" && /^[A-Z][A-Z0-9.]*$/.test(key),
  );
  const common = SIGS.map((sig) => sig.name);
  return [...common, ...all.filter((name) => !BY_NAME.has(name)).sort()];
})();

export function signatureOf(name: string): FnSig | undefined {
  return BY_NAME.get(name.toUpperCase());
}

export function isFunction(name: string): boolean {
  return BY_NAME.has(name.toUpperCase()) || FUNCTION_NAMES.includes(name.toUpperCase());
}
