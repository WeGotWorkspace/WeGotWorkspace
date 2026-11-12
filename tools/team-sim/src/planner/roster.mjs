import { inRange, isWeekend, weekday, weekdaysBetween } from "./dates.mjs";

/**
 * Who works on `date`, who is away and why. Sick days are drawn from the
 * date's seed in persona order, so one persona's draw never shifts another's.
 */
export function rosterFor(world, date, rng) {
  const absent = {};
  const sickRng = rng.fork("sick");
  for (const id of world.personasOn(date)) {
    const p = world.persona(id);
    const sick = sickRng.chance(world.rhythm.sickRatePerDay);
    const holiday = world.rhythm.holidays.find((h) => h.persona === id && inRange(date, h.from, h.to));
    if (holiday) absent[id] = "holiday";
    else if (p.daysOff?.includes(weekday(date))) absent[id] = "day-off";
    else if (sick && !isWeekend(date)) absent[id] = "sick";
  }
  let present = world.personasOn(date).filter((id) => !absent[id]);
  if (isWeekend(date)) {
    present = rng.fork("weekend").shuffle(present).slice(0, world.rhythm.weekendActivePersonas).sort(byWorldOrder(world));
  }
  return { present, absent };
}

const byWorldOrder = (world) => (a, b) =>
  world.personas.findIndex((p) => p.id === a) - world.personas.findIndex((p) => p.id === b);

/**
 * Browser personas for the night. Weekday k (counted from the world epoch)
 * takes rotation slots 3k, 3k+1, 3k+2 (and 3k+3 on a seeded 4-persona night).
 * Any 7 consecutive nights hold at least 5 weekdays, so 15 consecutive slots,
 * which covers all 10 personas. An absent persona's slot passes to the next
 * present one in the rotation.
 */
export function uiPersonasFor(world, date, present, rng) {
  const rotation = world.meta.uiRotation.filter((id) => world.startedBy(id, date));
  if (isWeekend(date)) return present.slice(0, 1);
  const k = weekdaysBetween(world.meta.epoch, date);
  const count = rng.fork("ui-count").chance(0.5) ? 4 : 3;
  const picked = [];
  for (let slot = 3 * k; picked.length < count && slot < 3 * k + rotation.length * 2; slot += 1) {
    const id = rotation[slot % rotation.length];
    if (present.includes(id) && !picked.includes(id)) picked.push(id);
  }
  return picked;
}
