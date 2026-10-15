/**
 * Writes the machine-checkable contract to arkiv/schema/*.schema.json from the same constants the
 * codec uses. Run after changing schema.ts: `npm run schemas -w nexora-ledger`. The tests fail if
 * the committed files fall behind.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { JSON_SCHEMAS, schemaFileName, schemaFileText } from "./src/contract.ts";

const dir = new URL("../arkiv/schema/", import.meta.url);
mkdirSync(dir, { recursive: true });
for (const kind of Object.keys(JSON_SCHEMAS) as (keyof typeof JSON_SCHEMAS)[]) {
  writeFileSync(new URL(schemaFileName(kind), dir), schemaFileText(kind));
  console.log(`arkiv/schema/${schemaFileName(kind)}`);
}
