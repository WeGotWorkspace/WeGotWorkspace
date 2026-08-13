const MIN_WEEK_DAYS = 1;
const MAX_WEEK_DAYS = 7;
const DEFAULT_WEEK_DAYS = 7;

const MIN_GRID_DAYS = 1;
const MAX_GRID_DAYS = 42;
const DEFAULT_GRID_DAYS = 7;

const MIN_AGENDA_DAYS = 1;
const MAX_AGENDA_DAYS = 366;
const DEFAULT_AGENDA_DAYS = 31;

function toInteger(input: number | string | null | undefined): number {
  if (typeof input === "number" && Number.isFinite(input)) {
    return Math.floor(input);
  }
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return Number.NaN;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return Number.NaN;
    return Math.floor(parsed);
  }
  return Number.NaN;
}

function clampInteger(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

export function daysPerWeekFromInput(value: number | string | null | undefined): number {
  return toInteger(value);
}

export function clampDaysPerWeek(value: number): number {
  return clampInteger(value, MIN_WEEK_DAYS, MAX_WEEK_DAYS, DEFAULT_WEEK_DAYS);
}

export function clampGridDaysPerWeek(value: number): number {
  return clampInteger(value, MIN_GRID_DAYS, MAX_GRID_DAYS, DEFAULT_GRID_DAYS);
}

export function clampAgendaDaysPerWeek(value: number): number {
  return clampInteger(value, MIN_AGENDA_DAYS, MAX_AGENDA_DAYS, DEFAULT_AGENDA_DAYS);
}
