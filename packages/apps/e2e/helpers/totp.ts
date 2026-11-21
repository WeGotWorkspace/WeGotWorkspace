// An authenticator app for the live tier (#2276): RFC 6238 codes (SHA-1, 6 digits,
// 30 seconds) from the setup key the app shows, with Node's crypto only.
//
// The server refuses a code whose step is at or below the last accepted step of
// that user (`user_mfa.last_used_step`), and accepts one step of drift either way.
// `Authenticator.next()` therefore hands out each step once, takes the current or
// the next step, and waits for a new step when both are used.
import { createHmac } from "node:crypto";

const STEP_SECONDS = 30;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input: string): Buffer {
  const clean = input.replace(/[\s=]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error(`Not a base32 setup key: ${input}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The 6-digit code of one 30-second step. */
export function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, "0");
}

const currentStep = () => Math.floor(Date.now() / 1000 / STEP_SECONDS);

/**
 * One user's authenticator. Keep one per user, also across a new setup key: the
 * last used step belongs to the user, not to the key.
 */
export class Authenticator {
  private lastStep = -1;
  private secret: string;

  constructor(secret: string) {
    this.secret = secret;
  }

  /** After a new authenticator is set up (recovery code), codes come from the new key. */
  replaceSecret(secret: string): void {
    this.secret = secret;
  }

  /** A code the server has not seen yet; waits for the next 30-second step when needed. */
  async next(): Promise<string> {
    for (;;) {
      const now = currentStep();
      const step = Math.max(this.lastStep + 1, now);
      // The next step is still inside the server's window, but not in the last
      // two seconds of this one: by the time it is checked it may be two ahead.
      const msLeft = (now + 1) * STEP_SECONDS * 1000 - Date.now();
      if (step === now || (step === now + 1 && msLeft > 2_000)) {
        this.lastStep = step;
        return totpAt(this.secret, step);
      }
      await new Promise((resolve) => setTimeout(resolve, msLeft + 250));
    }
  }
}
