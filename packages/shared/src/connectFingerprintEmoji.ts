// Catgirl Connect: a service's fingerprint as a row of emoji with names, for comparing by eye.
import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha2";
import { hexToBytes } from "@noble/hashes/utils";

import { connectKeyFingerprint } from "./connectDocument.ts";

export interface ConnectFingerprintEmoji {
  readonly emoji: string;
  /** Shown under the emoji: it makes the row readable aloud and to a screen reader. */
  readonly name: string;
}

// The Matrix specification's SAS emoji (data-definitions/sas-emoji.json, Apache-2.0,
// https://spec.matrix.org/latest/client-server-api/#sas-method-emoji), in Matrix's order,
// except that index 0 is the orange cat 🐈 and Matrix's dog takes the place of its cat face 🐱.
const TABLE: ReadonlyArray<readonly [emoji: string, name: string]> = [
  ["🐈", "Cat"],
  ["🐶", "Dog"],
  ["🦁", "Lion"],
  ["🐎", "Horse"],
  ["🦄", "Unicorn"],
  ["🐷", "Pig"],
  ["🐘", "Elephant"],
  ["🐰", "Rabbit"],
  ["🐼", "Panda"],
  ["🐓", "Rooster"],
  ["🐧", "Penguin"],
  ["🐢", "Turtle"],
  ["🐟", "Fish"],
  ["🐙", "Octopus"],
  ["🦋", "Butterfly"],
  ["🌷", "Flower"],
  ["🌳", "Tree"],
  ["🌵", "Cactus"],
  ["🍄", "Mushroom"],
  ["🌏", "Globe"],
  ["🌙", "Moon"],
  ["☁️", "Cloud"],
  ["🔥", "Fire"],
  ["🍌", "Banana"],
  ["🍎", "Apple"],
  ["🍓", "Strawberry"],
  ["🌽", "Corn"],
  ["🍕", "Pizza"],
  ["🎂", "Cake"],
  ["❤️", "Heart"],
  ["😀", "Smiley"],
  ["🤖", "Robot"],
  ["🎩", "Hat"],
  ["👓", "Glasses"],
  ["🔧", "Spanner"],
  ["🎅", "Santa"],
  ["👍", "Thumbs Up"],
  ["☂️", "Umbrella"],
  ["⌛", "Hourglass"],
  ["⏰", "Clock"],
  ["🎁", "Gift"],
  ["💡", "Light Bulb"],
  ["📕", "Book"],
  ["✏️", "Pencil"],
  ["📎", "Paperclip"],
  ["✂️", "Scissors"],
  ["🔒", "Lock"],
  ["🔑", "Key"],
  ["🔨", "Hammer"],
  ["☎️", "Telephone"],
  ["🏁", "Flag"],
  ["🚂", "Train"],
  ["🚲", "Bicycle"],
  ["✈️", "Aeroplane"],
  ["🚀", "Rocket"],
  ["🏆", "Trophy"],
  ["⚽", "Ball"],
  ["🎸", "Guitar"],
  ["🎺", "Trumpet"],
  ["🔔", "Bell"],
  ["⚓", "Anchor"],
  ["🎧", "Headphones"],
  ["📁", "Folder"],
  ["📌", "Pin"],
];

/** 64 entries, one per value of 6 bits. Index 0, the cat, starts every instance this fork deploys. */
export const CONNECT_FINGERPRINT_EMOJI: ReadonlyArray<ConnectFingerprintEmoji> = TABLE.map(
  ([emoji, name]) => ({ emoji, name }),
);

/** 8 emoji of 6 bits each: the first 48 of the 64 bits the hex fingerprint shows. */
export const CONNECT_FINGERPRINT_EMOJI_COUNT = 8;
const BITS = 6;
const HEX_DIGITS_NEEDED = (CONNECT_FINGERPRINT_EMOJI_COUNT * BITS) / 4;

/** Six bits at a time from the start of `bytes`, most significant bit first, as Matrix reads them. */
function sixBitGroups(bytes: Uint8Array): ReadonlyArray<number> {
  return Array.from({ length: CONNECT_FINGERPRINT_EMOJI_COUNT }, (_, index) => {
    const bit = index * BITS;
    const word = ((bytes[bit >> 3] ?? 0) << 8) | (bytes[(bit >> 3) + 1] ?? 0);
    return (word >> (16 - BITS - (bit & 7))) & 0b11_1111;
  });
}

/**
 * The emoji of a hex fingerprint (`3475 0f98 bd59 fcfc`, spaces optional). Its digits are the
 * start of SHA-256 over the key bytes, so this is the same as reading that digest directly.
 * `null` for anything with fewer than 12 hex digits.
 */
export function connectFingerprintEmoji(
  fingerprint: string,
): ReadonlyArray<ConnectFingerprintEmoji> | null {
  const hex = fingerprint.replace(/\s+/gu, "").toLowerCase();
  if (!/^[0-9a-f]+$/u.test(hex) || hex.length < HEX_DIGITS_NEEDED) return null;
  return sixBitGroups(hexToBytes(hex.slice(0, HEX_DIGITS_NEEDED))).map(
    (index) => CONNECT_FINGERPRINT_EMOJI[index]!,
  );
}

/** The emoji of a key (base64url of its 32 bytes), or `null` for a malformed key. */
export function connectKeyEmoji(key: string): ReadonlyArray<ConnectFingerprintEmoji> | null {
  const fingerprint = connectKeyFingerprint(key);
  return fingerprint === null ? null : connectFingerprintEmoji(fingerprint);
}

/** One line for plain text: `🐈 Cat · 🐶 Dog · …`. */
export function connectFingerprintEmojiText(fingerprint: string): string | null {
  const row = connectFingerprintEmoji(fingerprint);
  return row === null ? null : row.map(({ emoji, name }) => `${emoji} ${name}`).join(" · ");
}

/**
 * For a terminal: the emoji on one line and each name under its emoji on the next. A terminal
 * draws an emoji two columns wide; a few with a variation selector may be drawn one wide.
 */
export function connectFingerprintEmojiLines(
  fingerprint: string,
): { readonly emoji: string; readonly names: string } | null {
  const row = connectFingerprintEmoji(fingerprint);
  if (row === null) return null;
  const widths = row.map(({ name }) => Math.max(name.length, 2) + 2);
  return {
    emoji: row
      .map(({ emoji }, index) => emoji + " ".repeat(widths[index]! - 2))
      .join("")
      .trimEnd(),
    names: row
      .map(({ name }, index) => name.padEnd(widths[index]!))
      .join("")
      .trimEnd(),
  };
}

/** Whether a public key's fingerprint starts with the cat: the top 6 bits of its digest are 0. */
export function isCatFirstConnectKey(publicKey: Uint8Array): boolean {
  return (sha256(publicKey)[0] ?? 0xff) >> (8 - BITS) === 0;
}

/**
 * A new Ed25519 seed whose fingerprint starts with the cat, made by trying random seeds until one
 * does (64 tries on average). The first emoji then says nothing about which instance it is; the
 * other seven still carry 42 bits. Apps never require it: a key that starts elsewhere is valid.
 */
export function generateCatFirstConnectSeed(
  options: {
    readonly randomSeed?: () => Uint8Array;
    /** A cat comes once in 64 tries, so 10,000 fail only when the randomness is broken. */
    readonly maxTries?: number;
  } = {},
): { readonly seed: Uint8Array; readonly tries: number } {
  const randomSeed = options.randomSeed ?? (() => ed25519.utils.randomPrivateKey());
  const maxTries = options.maxTries ?? 10_000;
  for (let tries = 1; tries <= maxTries; tries++) {
    const seed = randomSeed();
    if (isCatFirstConnectKey(ed25519.getPublicKey(seed))) return { seed, tries };
  }
  throw new Error(`No cat-first Connect key in ${maxTries} tries: check the randomness.`);
}
