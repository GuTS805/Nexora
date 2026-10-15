import { describe, expect, it } from "vitest";
import { parseSpokenDay } from "./voice.ts";

describe("parseSpokenDay", () => {
  it("reads Hindi, Hinglish and English word orders", () => {
    const day = { grossInr: 1200, costsInr: 300, hours: 9 };
    expect(parseSpokenDay("आज 1200 कमाए, 300 का पेट्रोल, 9 घंटे")).toEqual(day);
    expect(parseSpokenDay("aaj 1200 kamaye 300 ka petrol 9 ghante")).toEqual(day);
    expect(parseSpokenDay("earned 1200 petrol 300 9 hours")).toEqual(day);
    expect(parseSpokenDay("9 hours today, spent 300 on petrol and made 1200")).toEqual(day);
  });

  it("understands Devanagari digits, Indian comma grouping and common number words", () => {
    expect(parseSpokenDay("१२०० कमाए ३०० का पेट्रोल ९ घंटे")).toEqual({ grossInr: 1200, costsInr: 300, hours: 9 });
    expect(parseSpokenDay("earned ₹1,450, fuel ₹260")).toEqual({ grossInr: 1450, costsInr: 260 });
    expect(parseSpokenDay("साढ़े 9 घंटे, 12 सौ कमाए")).toEqual({ hours: 9.5, grossInr: 1200 });
    expect(parseSpokenDay("1 हज़ार 350 कमाए, ढाई सौ का खर्चा")).toEqual({ grossInr: 1350, costsInr: 250 });
  });

  it("leaves a field blank rather than guess", () => {
    expect(parseSpokenDay("1200 300 9")).toEqual({});
    expect(parseSpokenDay("आज बारिश थी")).toEqual({});
    // 300 cannot be hours, so it is not paired with "hours".
    expect(parseSpokenDay("300 hours")).toEqual({});
    expect(parseSpokenDay("1200 kamaye aur 300")).toEqual({ grossInr: 1200 });
  });
});
