import type { ShiftInput } from "./codec.ts";
import { validateShiftInput } from "./codec.ts";
import type { EXPIRY_CHOICES_DAYS } from "./schema.ts";

/**
 * Columns for a week of days copied from the worker's own notes or the app's earnings screen. Exact
 * rupees and hours never leave the device: each row becomes a band and a rounded rate.
 */
export const CSV_COLUMNS = ["platform", "work", "city", "vehicle", "month", "gross_inr", "costs_inr", "hours", "incentive"] as const;

/** Rows per Arkiv batch transaction. Keeps one bad import from producing one enormous tx. */
export const MAX_BATCH = 20;

export const CSV_TEMPLATE = `${CSV_COLUMNS.join(",")}
swiggy,food_delivery,bengaluru,petrol_bike,2026-10,1180,240,10,met
swiggy,food_delivery,bengaluru,petrol_bike,2026-10,960,220,9,missed
`;

export type CsvResult = {
  rows: ShiftInput[];
  errors: { line: number; message: string }[];
};

/** "2026-10" → 202610; anything else → NaN, which validation then rejects with a clear message. */
function parseMonth(text: string): number {
  const match = /^(\d{4})-(\d{2})$/.exec(text);
  return match ? Number(match[1]) * 100 + Number(match[2]) : Number.NaN;
}

export function parseShiftsCsv(text: string, expiresInDays: (typeof EXPIRY_CHOICES_DAYS)[number]): CsvResult {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  const result: CsvResult = { rows: [], errors: [] };
  const header = lines.shift()?.split(",").map((h) => h.trim().toLowerCase());
  if (!header || CSV_COLUMNS.some((column) => !header.includes(column))) {
    result.errors.push({ line: 1, message: `Header must contain: ${CSV_COLUMNS.join(", ")}` });
    return result;
  }
  lines.forEach((line, index) => {
    const cells = line.split(",").map((c) => c.trim());
    const get = (column: string) => cells[header.indexOf(column)] ?? "";
    // A blank cell must fail validation, not silently become ₹0 (Number("") is 0). Costs may be blank.
    const num = (column: string) => (get(column) === "" ? Number.NaN : Number(get(column)));
    const input = {
      platform: get("platform"), work: get("work"), city: get("city"), vehicle: get("vehicle"),
      period: parseMonth(get("month")),
      grossInr: num("gross_inr"), costsInr: get("costs_inr") === "" ? 0 : num("costs_inr"), hours: num("hours"),
      incentive: get("incentive") || "none",
      expiresInDays,
    } as ShiftInput;
    try {
      validateShiftInput(input);
      result.rows.push(input);
    } catch (cause) {
      result.errors.push({ line: index + 2, message: cause instanceof Error ? cause.message : String(cause) });
    }
  });
  return result;
}
