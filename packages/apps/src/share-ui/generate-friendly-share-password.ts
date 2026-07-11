/** Short, readable words for diceware-lite share passwords (word-word-number). */
const SHARE_PASSWORD_WORDS = [
  "amber",
  "apple",
  "atlas",
  "breeze",
  "canyon",
  "cedar",
  "cloud",
  "coral",
  "delta",
  "ember",
  "falcon",
  "forest",
  "glacier",
  "harbor",
  "ivory",
  "jade",
  "kite",
  "lake",
  "maple",
  "meadow",
  "mint",
  "moon",
  "nova",
  "ocean",
  "olive",
  "pearl",
  "pine",
  "plum",
  "quartz",
  "river",
  "sage",
  "shore",
  "silver",
  "spark",
  "stone",
  "sunset",
  "tide",
  "trail",
  "valley",
  "willow",
] as const;

function randomInt(maxExclusive: number): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0]! % maxExclusive;
}

function pickWord(): string {
  return SHARE_PASSWORD_WORDS[randomInt(SHARE_PASSWORD_WORDS.length)]!;
}

/** Generates a readable password like `river-maple-42` or `cloud-sage-trail-918`. */
export function generateFriendlySharePassword(): string {
  const useThreeWords = randomInt(4) === 0;
  const words = useThreeWords ? [pickWord(), pickWord(), pickWord()] : [pickWord(), pickWord()];
  const digits = String(randomInt(900) + 100);
  return `${words.join("-")}-${digits}`;
}
