import { describe, expect, it } from "vitest";
import { STRINGS } from "./strings.ts";
import { REGIONAL, REGIONAL_NOTE, REGIONAL_VOCAB } from "./strings-regional.ts";
import { MORE, MORE_VOCAB } from "./strings-regional-more.ts";

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

  it("Telugu, Bengali and Marathi cover the same strings and names as Kannada and Tamil, keep every placeholder, and are written in their scripts", () => {
    const scripts = { te: /[\u0C00-\u0C7F]/, bn: /[\u0980-\u09FF]/, mr: /[\u0900-\u097F]/ };
    for (const lang of ["te", "bn", "mr"] as const) {
      expect(Object.keys(MORE[lang]).sort(), lang).toEqual(Object.keys(REGIONAL).sort());
      for (const [key, text] of Object.entries(MORE[lang])) {
        const en = STRINGS[key as keyof typeof STRINGS][0];
        expect(placeholders(text), `${key} (${lang})`).toEqual(placeholders(en));
        expect(scripts[lang].test(text), `${key} (${lang}): "${text}"`).toBe(true);
      }
      expect(scripts[lang].test(REGIONAL_NOTE[lang])).toBe(true);
      expect(Object.keys(MORE_VOCAB).sort()).toEqual(Object.keys(REGIONAL_VOCAB).sort());
      for (const [code, names] of Object.entries(MORE_VOCAB)) expect(scripts[lang].test(names[lang]), `${code} (${lang})`).toBe(true);
    }
  });
});
