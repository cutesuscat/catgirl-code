import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import * as Base64Url from "effect/encoding/Base64Url";
import { describe, expect, it } from "vite-plus/test";

import vector from "./catgirlConnectDocument.vector.json" with { type: "json" };
import { connectKeyFingerprint } from "./connectDocument.ts";
import {
  CONNECT_FINGERPRINT_EMOJI,
  CONNECT_FINGERPRINT_EMOJI_COUNT,
  connectFingerprintEmoji,
  connectFingerprintEmojiLines,
  connectFingerprintEmojiText,
  connectKeyEmoji,
  generateCatFirstConnectSeed,
  isCatFirstConnectKey,
} from "./connectFingerprintEmoji.ts";

const names = (row: ReturnType<typeof connectKeyEmoji>) => row?.map((entry) => entry.name);
const glyphs = (row: ReturnType<typeof connectKeyEmoji>) =>
  row?.map((entry) => entry.emoji).join("");

/** A second reading of the digest, with BigInt, to check the bit arithmetic against. */
function referenceIndices(publicKey: Uint8Array): ReadonlyArray<number> {
  const top48 = BigInt(`0x${bytesToHex(sha256(publicKey)).slice(0, 12)}`);
  return Array.from({ length: 8 }, (_, index) => Number((top48 >> BigInt(42 - 6 * index)) & 63n));
}

/** Seeds that differ in every byte, without randomness, so the test is the same every run. */
const counterSeeds = (start: number) => {
  let next = start;
  return () => sha256(new TextEncoder().encode(`connect-emoji-test-${next++}`));
};

describe("the emoji table", () => {
  it("has 64 distinct emoji with distinct names, the orange cat first", () => {
    expect(CONNECT_FINGERPRINT_EMOJI).toHaveLength(64);
    expect(CONNECT_FINGERPRINT_EMOJI[0]).toEqual({ emoji: "🐈", name: "Cat" });
    expect(new Set(CONNECT_FINGERPRINT_EMOJI.map((entry) => entry.emoji)).size).toBe(64);
    const lowerNames = CONNECT_FINGERPRINT_EMOJI.map((entry) => entry.name.toLowerCase());
    expect(new Set(lowerNames).size).toBe(64);
    for (const { emoji, name } of CONNECT_FINGERPRINT_EMOJI) {
      expect(name).toMatch(/^[A-Z][a-z]+(?: [A-Z][a-z]+)?$/u);
      expect(emoji.trim()).toBe(emoji);
    }
  });

  it("is Matrix's table with the cat in front: its cat face is gone, its dog moved up one", () => {
    expect(CONNECT_FINGERPRINT_EMOJI.some((entry) => entry.emoji === "🐱")).toBe(false);
    expect(CONNECT_FINGERPRINT_EMOJI[1]).toEqual({ emoji: "🐶", name: "Dog" });
    expect(CONNECT_FINGERPRINT_EMOJI[2]).toEqual({ emoji: "🦁", name: "Lion" });
    expect(CONNECT_FINGERPRINT_EMOJI[32]).toEqual({ emoji: "🎩", name: "Hat" });
    expect(CONNECT_FINGERPRINT_EMOJI[63]).toEqual({ emoji: "📌", name: "Pin" });
  });
});

describe("the coordinator's test vector", () => {
  const OLD = [
    "🐙 Octopus",
    "🐰 Rabbit",
    "🌙 Moon",
    "🌷 Flower",
    "⌛ Hourglass",
    "🐢 Turtle",
    "✈️ Aeroplane",
    "🍓 Strawberry",
  ].join(" · ");
  const NEW = [
    "🌽 Corn",
    "🎅 Santa",
    "🎩 Hat",
    "🐎 Horse",
    "✈️ Aeroplane",
    "🤖 Robot",
    "🐶 Dog",
    "🍓 Strawberry",
  ].join(" · ");

  it("gives both key pairs' fingerprints their emoji", () => {
    expect(connectFingerprintEmojiText(vector.keys.old.fingerprint)).toBe(OLD);
    expect(connectFingerprintEmojiText(vector.keys.new.fingerprint)).toBe(NEW);
  });

  it("gives the key of each of the four cases its emoji", () => {
    const expected = { valid: OLD, rotated: NEW, identityChanged: NEW, badSignature: OLD };
    for (const [name, testCase] of Object.entries(vector.cases)) {
      const row = connectKeyEmoji(testCase.envelope.key);
      expect(row?.map(({ emoji, name: label }) => `${emoji} ${label}`).join(" · ")).toBe(
        expected[name as keyof typeof expected],
      );
    }
  });
});

describe("connectFingerprintEmoji", () => {
  it("reads the digest six bits at a time, most significant first", () => {
    const next = counterSeeds(0);
    for (let round = 0; round < 50; round++) {
      const publicKey = ed25519.getPublicKey(next());
      const row = connectKeyEmoji(Base64Url.encode(publicKey));
      expect(row?.map((entry) => CONNECT_FINGERPRINT_EMOJI.indexOf(entry))).toEqual(
        referenceIndices(publicKey),
      );
    }
  });

  it("takes the fingerprint with or without spaces, in either case", () => {
    const spaced = connectFingerprintEmoji("3475 0f98 bd59 fcfc");
    expect(spaced).toHaveLength(CONNECT_FINGERPRINT_EMOJI_COUNT);
    expect(connectFingerprintEmoji("34750F98BD59FCFC")).toEqual(spaced);
    expect(connectFingerprintEmoji("34750f98bd59")).toEqual(spaced);
  });

  it("refuses too few digits, and anything that is not hex", () => {
    expect(connectFingerprintEmoji("34750f98bd5")).toBeNull();
    expect(connectFingerprintEmoji("3475 0f98 bd59 fcfx")).toBeNull();
    expect(connectFingerprintEmoji("")).toBeNull();
    expect(connectKeyEmoji("not a key")).toBeNull();
  });

  it("is the same whether it starts from the key or from its fingerprint", () => {
    const key = vector.keys.new.publicKey;
    expect(connectKeyEmoji(key)).toEqual(connectFingerprintEmoji(connectKeyFingerprint(key)!));
  });
});

describe("connectFingerprintEmojiLines", () => {
  /** Where a terminal draws each character: emoji two columns, a variation selector none. */
  const columnsBefore = (line: string, target: string) => {
    let columns = 0;
    for (const character of line.slice(0, line.indexOf(target))) {
      const code = character.codePointAt(0) ?? 0;
      columns += code === 0xfe0f ? 0 : code > 0x2300 ? 2 : 1;
    }
    return columns;
  };

  it("puts each name under its emoji", () => {
    const lines = connectFingerprintEmojiLines(vector.keys.old.fingerprint)!;
    expect(lines.names).toBe(
      "Octopus  Rabbit  Moon  Flower  Hourglass  Turtle  Aeroplane  Strawberry",
    );
    for (const { emoji, name } of connectFingerprintEmoji(vector.keys.old.fingerprint)!) {
      expect(columnsBefore(lines.emoji, emoji)).toBe(lines.names.indexOf(name));
    }
  });
});

describe("cat-first keys", () => {
  it("knows a cat-first key by the top six bits of its digest", () => {
    const next = counterSeeds(1_000);
    let cats = 0;
    for (let round = 0; round < 400; round++) {
      const publicKey = ed25519.getPublicKey(next());
      const catFirst = isCatFirstConnectKey(publicKey);
      expect(catFirst).toBe(connectKeyEmoji(Base64Url.encode(publicKey))?.[0]?.name === "Cat");
      if (catFirst) cats++;
    }
    expect(cats).toBeGreaterThan(0);
  });

  it("keeps generating until the first emoji is the cat", () => {
    const { seed, tries } = generateCatFirstConnectSeed({ randomSeed: counterSeeds(0) });
    const row = connectKeyEmoji(Base64Url.encode(ed25519.getPublicKey(seed)));
    expect(row?.[0]).toEqual({ emoji: "🐈", name: "Cat" });
    expect(tries).toBeGreaterThanOrEqual(1);
    expect(isCatFirstConnectKey(ed25519.getPublicKey(seed))).toBe(true);
  });

  it("makes a different cat-first key each time with real randomness", () => {
    const first = generateCatFirstConnectSeed();
    const second = generateCatFirstConnectSeed();
    expect(names(connectKeyEmoji(Base64Url.encode(ed25519.getPublicKey(first.seed))))?.[0]).toBe(
      "Cat",
    );
    expect(bytesToHex(first.seed)).not.toBe(bytesToHex(second.seed));
    expect(glyphs(connectKeyEmoji(Base64Url.encode(ed25519.getPublicKey(second.seed))))).toMatch(
      /^🐈/u,
    );
  });

  it("gives up with a clear error when the randomness is broken", () => {
    const stuck = new Uint8Array(32).fill(1);
    expect(isCatFirstConnectKey(ed25519.getPublicKey(stuck))).toBe(false);
    expect(() => generateCatFirstConnectSeed({ randomSeed: () => stuck, maxTries: 50 })).toThrow(
      /No cat-first Connect key in 50 tries/u,
    );
  });
});
