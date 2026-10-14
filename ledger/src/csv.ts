import type { ExperimentInput } from "./codec.ts";
import { validateExperimentInput } from "./codec.ts";
import type { EXPIRY_CHOICES_DAYS } from "./schema.ts";

/** Columns a seller exports from their own sheet. Exact rupee figures never leave the device. */
export const CSV_COLUMNS = [
  "category", "platform", "format", "lang", "tier", "season", "tone", "cta", "offer",
  "spend_inr", "revenue_inr", "days",
] as const;

/** Rows per Arkiv batch transaction. Keeps one bad import from producing one enormous tx. */
export const MAX_BATCH = 20;

export const CSV_TEMPLATE = `${CSV_COLUMNS.join(",")}
tea_coffee,instagram,reel,hinglish,tier2,diwali,festive,whatsapp_us,combo,3500,9100,7
tea_coffee,whatsapp,status,hi,tier3,none,testimonial,whatsapp_us,cod,800,1500,5
`;

export type CsvResult = {
  rows: ExperimentInput[];
  errors: { line: number; message: string }[];
};

export function parseExperimentsCsv(text: string, expiresInDays: (typeof EXPIRY_CHOICES_DAYS)[number]): CsvResult {
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
    const input = {
      category: get("category"), platform: get("platform"), format: get("format"), lang: get("lang"),
      tier: get("tier"), season: get("season") || "none", tone: get("tone"), cta: get("cta"),
      offer: get("offer") || "none",
      spendInr: Number(get("spend_inr")), revenueInr: Number(get("revenue_inr")), days: Number(get("days")),
      expiresInDays,
    } as ExperimentInput;
    try {
      validateExperimentInput(input);
      result.rows.push(input);
    } catch (cause) {
      result.errors.push({ line: index + 2, message: cause instanceof Error ? cause.message : String(cause) });
    }
  });
  return result;
}
