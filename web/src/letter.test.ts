import { INCIDENT_TYPES } from "nexora-ledger";
import { describe, expect, it } from "vitest";
import { ASK, STATE, WHERE, letter, type Facts, type Recipient } from "./letter.tsx";

const facts: Facts = {
  platform: "Zomato", work: "Food delivery", city: "Bengaluru", type: "ID blocked for a while", month: "Oct 2026", daysLost: 6,
  reasonGiven: "no", appealed: "yes", resolved: "no", state: "Karnataka",
  explorer: "https://tiramisu.explorer.arkiv.network/entity/0xabc", page: "https://nexora.example/#/e/0xabc?ui=en",
  similar: "https://nexora.example/#/incidents?platform=zomato&city=bengaluru&ui=en", ask: ASK.id_blocked[0], details: null,
};
const recipients: Recipient[] = ["platform", "union", "labour"];

describe("complaint letter", () => {
  it("states the facts and links the public record anyone can check, in both languages", () => {
    for (const lang of ["en", "hi"] as const) {
      for (const to of recipients) {
        const text = letter(lang, to, facts);
        for (const part of [facts.explorer, facts.page, facts.type, facts.month, "6"]) expect(text, `${lang}/${to}`).toContain(part);
        expect(text).toContain("14");
      }
      expect(letter(lang, "platform", facts)).toContain("Zomato");
    }
    expect(letter("hi", "platform", facts)).toMatch(/[ऀ-ॿ]/);
  });

  it("never fills in a name, ID or phone: those stay as brackets for the worker", () => {
    expect(letter("en", "platform", facts)).toMatch(/\[your name\][\s\S]*\[your ID\][\s\S]*\[your number\]/);
    expect(letter("hi", "platform", facts)).toMatch(/\[आपका नाम\][\s\S]*\[आपकी ID\][\s\S]*\[आपका नंबर\]/);
  });

  it("adds private details only when the worker includes them", () => {
    expect(letter("en", "platform", facts)).not.toMatch(/private details/i);
    expect(letter("en", "platform", { ...facts, details: "Paid ₹1,180 · costs ₹240" })).toContain("My private details: Paid ₹1,180 · costs ₹240");
  });

  it("points unions and the labour department at similar reports; the platform letter stays about this case", () => {
    expect(letter("en", "union", facts)).toContain(facts.similar);
    expect(letter("en", "labour", facts)).toContain(facts.similar);
    expect(letter("en", "platform", facts)).not.toContain(facts.similar);
    expect(letter("en", "labour", facts)).toContain("Karnataka");
    expect(letter("en", "labour", { ...facts, state: null })).toContain("[your state]");
  });

  it("has a request for every incident type, and leaves Delhi NCR's state for the worker to fill in", () => {
    for (const type of INCIDENT_TYPES) {
      expect(ASK[type][0].length, type).toBeGreaterThan(20);
      expect(ASK[type][1], type).toMatch(/[ऀ-ॿ]/);
    }
    expect(STATE.bengaluru?.[0]).toBe("Karnataka");
    expect(STATE.jaipur?.[0]).toBe("Rajasthan");
    expect(STATE.delhi_ncr).toBeUndefined();
    expect(STATE.other_city).toBeUndefined();
  });

  it("says it is not legal advice and quotes no section numbers", () => {
    for (const lang of ["en", "hi"] as const) {
      expect(WHERE[lang].notAdvice.length).toBeGreaterThan(20);
      expect(WHERE[lang].points.length).toBe(WHERE.en.points.length);
      expect(WHERE[lang].points.join(" ")).not.toMatch(/sections?\s*\d|धारा|§|\bsec\.\s*\d/i);
    }
  });
});
