import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The submission's "How we use each Arkiv feature" table links each feature to exact lines of code.
 * Code moves; this keeps every link pointing at the code it describes, so a judge who clicks one
 * lands on that feature, not on whatever moved into its place.
 */
const root = new URL("../../", import.meta.url);
const doc = readFileSync(new URL("docs/SUBMISSION.md", root), "utf8");
const table = doc.slice(doc.indexOf("## How we use each Arkiv feature"), doc.indexOf("## Why Arkiv"));

/** For each feature row, the text every one of its linked line ranges must contain. */
const EXPECT: [feature: string, mustContain: RegExp][] = [
  ["Typed attributes vs payload", /attributes|payload/],
  ["Range queries on `i32`", /gte\("(period|net_hourly|hours_band|cost_pct)"/],
  ["`$creator` filters", /\$creator/],
  ["`key`-typed attribute", /parent/],
  ["`readonly` creation flag", /readonly: true/],
  ["`extendEntity` as a lease (trust lists)", /./],
  ["`permissionlessExtension` flag + `extendEntity`", /extendEntity/],
  ["Expiration", /expires/],
  ["`deleteEntity` (owner)", /deleteEntity/],
  ["`atBlock` (reads as of a past block)", /./],
  ["Ownership transfer (`ownershipChanges`) + `predictEntityKeys`", /createLocked/],
  ["`patchEntity` with `set`", /patchEntity|set:/],
  ["`executeBatch`", /executeBatch/],
  ["Cursor paging", /next\(\)/],
  ["WebSocket entity events", /watchEntityEvents/],
  ["`Expression.toString()`", /toString\(\)/],
];

/** Links elsewhere in the document, by the file and line they name. */
const ELSEWHERE: [link: string, mustContain: RegExp][] = [
  ["web/src/pages/Log.tsx#L320", /defaultOneOff/],
  ["ledger/src/queries.ts#L204-L207", /\$creator/],
  ["ledger/src/insights.ts#L15", /MIN_WORKERS_FOR_CONFIRMED = 2/],
  ["ledger/src/insights.ts#L135", /b\.confirmed\) - Number\(a\.confirmed/],
];

describe("submission code links", () => {
  it("links outside the table point at the code they describe, and none is unchecked", () => {
    const outside = doc.slice(0, doc.indexOf("## How we use each Arkiv feature")) + doc.slice(doc.indexOf("## Why Arkiv"));
    const links = [...outside.matchAll(/\(\.\.\/([^)#]+#L\d+(?:-L\d+)?)\)/g)].map((m) => m[1]!);
    expect([...new Set(links)].sort()).toEqual(ELSEWHERE.map(([link]) => link).sort());
    for (const [link, mustContain] of ELSEWHERE) {
      const [, path, from, to] = /^([^#]+)#L(\d+)(?:-L(\d+))?$/.exec(link)!;
      const span = readFileSync(new URL(path!, root), "utf8").split("\n").slice(Number(from) - 1, Number(to ?? from)).join("\n");
      expect(span, link).toMatch(mustContain);
    }
  });

  const rows = table.split("\n").filter((line) => line.startsWith("| **"));

  it("every feature row is covered here", () => {
    expect(rows.map((row) => row.split("|")[1]!.trim().replace(/^\*\*|\*\*$/g, ""))).toEqual(EXPECT.map(([feature]) => feature));
  });

  for (const [feature, mustContain] of EXPECT) {
    it(`${feature} links point at its code`, () => {
      const row = rows.find((r) => r.split("|")[1]!.trim() === `**${feature}**`)!;
      for (const [, path, from, to] of row.matchAll(/\(\.\.\/([^)#]+)#L(\d+)(?:-L(\d+))?\)/g)) {
        const lines = readFileSync(new URL(path!, root), "utf8").split("\n");
        const span = lines.slice(Number(from) - 1, Number(to ?? from)).join("\n");
        expect(span, `${path}#L${from}${to ? `-L${to}` : ""}`).toMatch(mustContain);
      }
    });
  }
});
