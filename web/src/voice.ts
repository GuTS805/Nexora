/**
 * Turns a spoken day ("aaj 1200 kamaye, 300 ka petrol, 9 ghante" / "earned 1200, petrol 300, 9 hours")
 * into the three numbers the earnings form needs. Riders are often on the road, and typing three
 * numbers on a phone is the slowest part of logging a day.
 *
 * Speech recognisers return digits for amounts in both Hindi and English, sometimes in Devanagari,
 * so this does not try to understand number words beyond a few common ones (डेढ़, ढाई, साढ़े, सौ,
 * हज़ार). Each number is paired with the nearest keyword, counting only numbers and keywords in
 * between, so "1200 का पेट्रोल" (keyword after) and "petrol 1200" (keyword before) both work.
 * Anything it cannot pair stays empty: a wrong guess in a money field is worse than a blank one.
 */

export type SpokenDay = { grossInr?: number; costsInr?: number; hours?: number };

type Field = keyof SpokenDay;

const KEYWORDS: [Field, RegExp][] = [
  ["hours", /^(ghant[ae]?|ghanton|घंट[ेा]|घण्ट[ेा]|घंटों|hours?|hrs?)$/],
  ["costsInr", /^(petrol|पेट्रोल|diesel|डीज़ल|डीजल|cng|सीएनजी|fuel|charging|चार्जिंग|kharch[aei]?|खर्च[ाे]?|costs?|expenses?|spent|lage|लगे|लगा)$/],
  ["grossInr", /^(kama[iy][ae]?|kamaai|कमा[एयई]|कमाये|कमाया|earned|earnings?|made|mile|मिले|payout|income|total|कुल)$/],
];

const FRACTIONS: Record<string, number> = { "डेढ़": 1.5, dedh: 1.5, "ढाई": 2.5, dhai: 2.5 };
const HALF_MORE = /^(साढ़े|sadhe|saadhe|sade|saade)$/;
const MULTIPLIERS: [RegExp, number][] = [[/^(हज़ार|हजार|hazaar|hazar|thousand|k)$/, 1_000], [/^(सौ|sau|hundred)$/, 100]];
const LIMITS: Record<Field, number> = { grossInr: 50_000, costsInr: 50_000, hours: 24 };

type Token = { kind: "number"; value: number } | { kind: "keyword"; field: Field } | { kind: "other" };

function normalise(text: string): string {
  return text
    .replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966))
    .toLowerCase()
    // "1,200" and "1,20,000" are one number; a comma between words is a pause.
    .replace(/(\d),(?=\d)/g, "$1");
}

function tokenise(text: string): Token[] {
  const words = normalise(text).match(/\d+(?:\.\d+)?|[^\s\d.,!?।|:;₹]+/gu) ?? [];
  const tokens: Token[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    let value: number | undefined = /^\d/.test(word) ? Number(word) : FRACTIONS[word];
    if (value !== undefined) {
      if (i > 0 && HALF_MORE.test(words[i - 1]!)) value += 0.5;
      // "12 सौ" = 1200, "1 हज़ार 200" = 1200, "1.5 हज़ार" = 1500.
      const multiplier = MULTIPLIERS.find(([pattern]) => pattern.test(words[i + 1] ?? ""))?.[1];
      if (multiplier) {
        value *= multiplier;
        i++;
        const rest = words[i + 1];
        if (rest && /^\d+$/.test(rest) && Number(rest) < multiplier) {
          value += Number(rest);
          i++;
        }
      }
      tokens.push({ kind: "number", value });
      continue;
    }
    const field = KEYWORDS.find(([, pattern]) => pattern.test(word))?.[0];
    tokens.push(field ? { kind: "keyword", field } : { kind: "other" });
  }
  return tokens;
}

/** Every way to give each keyword its own number (or none), cheapest first by total distance. */
function bestPairing(numbers: { at: number; value: number }[], keywords: { at: number; field: Field }[], gap: (a: number, b: number) => number) {
  let best: { cost: number; pairs: Map<number, number> } = { cost: Infinity, pairs: new Map() };
  const walk = (k: number, used: Set<number>, cost: number, pairs: Map<number, number>, paired: number) => {
    if (k === keywords.length) {
      // More pairs always wins over a lower distance: an unpaired keyword is a blank field.
      const score = cost - paired * 1_000;
      if (score < best.cost) best = { cost: score, pairs: new Map(pairs) };
      return;
    }
    walk(k + 1, used, cost, pairs, paired);
    const keyword = keywords[k]!;
    for (let n = 0; n < numbers.length; n++) {
      const number = numbers[n]!;
      if (used.has(n) || number.value > LIMITS[keyword.field] || number.value < 0) continue;
      // A keyword after its number is how Hindi says it; a tiny bias settles exact ties.
      const after = keyword.at > number.at;
      used.add(n);
      pairs.set(k, n);
      walk(k + 1, used, cost + gap(number.at, keyword.at) + (after ? 0 : 0.1), pairs, paired + 1);
      pairs.delete(k);
      used.delete(n);
    }
  };
  walk(0, new Set(), 0, new Map(), 0);
  return best.pairs;
}

export function parseSpokenDay(text: string): SpokenDay {
  const tokens = tokenise(text);
  const numbers: { at: number; value: number }[] = [];
  const keywords: { at: number; field: Field }[] = [];
  tokens.forEach((token, at) => {
    if (token.kind === "number") numbers.push({ at, value: token.value });
    // Only the first mention of each field counts ("petrol ... petrol" is still one cost).
    else if (token.kind === "keyword" && !keywords.some((k) => k.field === token.field)) keywords.push({ at, field: token.field });
  });
  if (numbers.length === 0 || keywords.length === 0 || numbers.length > 8) return {};
  // Distance counts only the numbers and keywords in between, never filler words like "का" or "on".
  const significant = tokens.map((token) => (token.kind === "other" ? 0 : 1));
  const gap = (a: number, b: number) => {
    let count = 0;
    for (let i = Math.min(a, b) + 1; i < Math.max(a, b); i++) count += significant[i]!;
    return count;
  };
  const day: SpokenDay = {};
  for (const [k, n] of bestPairing(numbers, keywords, gap)) day[keywords[k]!.field] = numbers[n]!.value;
  return day;
}
