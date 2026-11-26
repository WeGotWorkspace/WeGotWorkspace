/**
 * Fill-handle series. `source` is one line of cells along the drag direction
 * (raw strings: literals or id-form formulas). `positions` are step offsets from
 * the first source cell: N, N+1, … when dragging down/right, -1, -2, … when
 * dragging up/left. `shift(formula, steps)` moves a formula by that many steps.
 */
export type FillOptions = {
  /** Option/Alt held: a single number counts up instead of being copied. */
  increment?: boolean;
};

const NUM = /^-?\d+(\.\d+)?$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TEXT_NUM = /^(.*?)(\d+)$/;

const LISTS: string[][] = [
  ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
  ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
  ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"],
  ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"],
  ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"],
  ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"],
  ["q1", "q2", "q3", "q4"],
];

function decimals(value: string): number {
  const dot = value.indexOf(".");
  return dot < 0 ? 0 : value.length - dot - 1;
}

function clean(n: number, places: number): string {
  return String(Number(n.toFixed(Math.min(10, places))));
}

/** Least-squares line through (i, y_i), like Excel's fill trend. */
function linear(ys: number[]): { a: number; b: number } {
  const n = ys.length;
  const mx = (n - 1) / 2;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0;
  let den = 0;
  ys.forEach((y, i) => {
    num += (i - mx) * (y - my);
    den += (i - mx) ** 2;
  });
  const b = den === 0 ? 0 : num / den;
  return { a: my - b * mx, b };
}

function parseDate(value: string): Date | null {
  const m = ISO_DATE.exec(value);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addMonths(d: Date, months: number): Date {
  const day = d.getUTCDate();
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, last));
  return out;
}

function matchCase(word: string, like: string): string {
  if (like === like.toUpperCase()) return word.toUpperCase();
  if (like[0] === like[0]?.toUpperCase()) return word[0]?.toUpperCase() + word.slice(1);
  return word;
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

export function fillSeries(
  source: string[],
  positions: number[],
  shift: (formula: string, steps: number) => string,
  options: FillOptions = {},
): string[] {
  const n = source.length;
  if (n === 0) return positions.map(() => "");
  const nonEmpty = source.filter((v) => v !== "");

  // Numbers.
  if (nonEmpty.length === n && source.every((v) => NUM.test(v))) {
    const ys = source.map(Number);
    const places = Math.max(...source.map(decimals));
    if (n === 1) {
      if (!options.increment) return positions.map(() => source[0] ?? "");
      return positions.map((p) => clean((ys[0] ?? 0) + p, places));
    }
    const { a, b } = linear(ys);
    return positions.map((p) => clean(a + b * p, places + 2));
  }

  // ISO dates.
  const dates = source.map(parseDate);
  if (dates.every((d): d is Date => d !== null)) {
    const first = dates[0] as Date;
    if (n === 1) return positions.map((p) => fmtDate(new Date(first.getTime() + p * 86_400_000)));
    const sameDay = dates.every((d) => d.getUTCDate() === first.getUTCDate());
    const monthIdx = dates.map((d) => d.getUTCFullYear() * 12 + d.getUTCMonth());
    const monthStep = (monthIdx[1] ?? 0) - (monthIdx[0] ?? 0);
    const monthly = sameDay && monthStep !== 0 && monthIdx.every((m, i) => m - (monthIdx[0] ?? 0) === i * monthStep);
    if (monthly) return positions.map((p) => fmtDate(addMonths(first, p * monthStep)));
    const dayStep = Math.round(((dates[1] as Date).getTime() - first.getTime()) / 86_400_000);
    return positions.map((p) => fmtDate(new Date(first.getTime() + p * dayStep * 86_400_000)));
  }

  // Named lists (weekdays, months, quarters) in English and Dutch.
  for (const list of LISTS) {
    const idx = source.map((v) => list.indexOf(v.toLowerCase()));
    if (idx.every((i) => i >= 0)) {
      const stepBy = n === 1 ? 1 : mod((idx[1] ?? 0) - (idx[0] ?? 0), list.length) || 1;
      return positions.map((p) => matchCase(list[mod((idx[0] ?? 0) + p * stepBy, list.length)] ?? "", source[0] ?? ""));
    }
  }

  // Text with a trailing number: "Item 1" → "Item 2", zero padding kept.
  const parts = source.map((v) => TEXT_NUM.exec(v));
  if (!source.some((v) => v.startsWith("=")) && parts.every((m) => m !== null && m[1] === parts[0]?.[1] && m[1] !== "")) {
    const prefix = parts[0]?.[1] ?? "";
    const width = parts[0]?.[2]?.length ?? 1;
    const ys = parts.map((m) => Number(m?.[2]));
    const { a, b } = n === 1 ? { a: ys[0] ?? 0, b: 1 } : linear(ys);
    return positions.map((p) => {
      const k = Math.max(0, Math.round(a + b * p));
      const digits = String(k);
      const padded = parts[0]?.[2]?.startsWith("0") ? digits.padStart(width, "0") : digits;
      return `${prefix}${padded}`;
    });
  }

  // Anything else repeats; formulas move with the copy.
  return positions.map((p) => {
    const s = mod(p, n);
    const value = source[s] ?? "";
    return value.startsWith("=") ? shift(value, p - s) : value;
  });
}
