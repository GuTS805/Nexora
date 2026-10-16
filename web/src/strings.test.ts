import { describe, expect, it } from "vitest";
import { STRINGS } from "./strings.ts";
import { REGIONAL, REGIONAL_NOTE, REGIONAL_VOCAB } from "./strings-regional.ts";

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

  it("Kannada and Tamil translate only existing strings, keep every placeholder, and are written in their scripts", () => {
    const scripts = { kn: /[\u0C80-\u0CFF]/, ta: /[\u0B80-\u0BFF]/ };
    for (const [key, byLang] of Object.entries(REGIONAL)) {
      expect(key in STRINGS, key).toBe(true);
      const en = STRINGS[key as keyof typeof STRINGS][0];
      for (const lang of ["kn", "ta"] as const) {
        const text = byLang![lang];
        expect(placeholders(text), `${key} (${lang})`).toEqual(placeholders(en));
        expect(scripts[lang].test(text), `${key} (${lang}): "${text}"`).toBe(true);
      }
    }
    for (const lang of ["kn", "ta"] as const) {
      expect(scripts[lang].test(REGIONAL_NOTE[lang])).toBe(true);
      for (const [code, names] of Object.entries(REGIONAL_VOCAB)) expect(scripts[lang].test(names[lang]), `${code} (${lang})`).toBe(true);
    }
  });
});
