import { describe, expect, it } from "vitest";
import { STRINGS } from "./strings.ts";

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("translations", () => {
  it("every string has non-empty English and Hindi", () => {
    for (const [key, [en, hi]] of Object.entries(STRINGS)) {
      expect(en.trim(), key).not.toBe("");
      expect(hi.trim(), key).not.toBe("");
    }
  });

  it("English and Hindi use the same placeholders, so no value goes missing in one language", () => {
    for (const [key, [en, hi]] of Object.entries(STRINGS)) {
      expect(placeholders(hi), key).toEqual(placeholders(en));
    }
  });

  it("Hindi strings are actually Hindi (contain Devanagari), except deliberate loanword-only labels", () => {
    const loanwordOnly = new Set(["switchLang"]);
    for (const [key, [, hi]] of Object.entries(STRINGS)) {
      if (loanwordOnly.has(key)) continue;
      expect(/[ऀ-ॿ]/.test(hi), `${key}: "${hi}"`).toBe(true);
    }
  });
});
