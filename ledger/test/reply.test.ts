import { describe, expect, it } from "vitest";
import { validateEntity } from "../src/contract.ts";
import { answeredReports, decodeReply, queryText, replyCreate, replyPredicate, repliesTo, type ReplyInput } from "../src/index.ts";
import { ALICE, BOB, KEY, asStored, keyOf, storedIncident } from "./fixtures.ts";

const UNION = "0x3333333333333333333333333333333333333333" as const;
const reply: ReplyInput = { parent: KEY, status: "taken_up", period: 202610, expiresInDays: 365 };

function storedReply(overrides: Partial<ReplyInput>, creator: `0x${string}` = UNION, i = 50, createdAt = 10n) {
  const decoded = decodeReply({ ...asStored(replyCreate({ ...reply, ...overrides }), creator, keyOf(i)), createdAt });
  if (!decoded.ok) throw new Error(decoded.reason);
  return decoded.value;
}

describe("replies to reports", () => {
  it("round-trip through the codec as read-only entries with a key-typed parent and nothing else to fill in", () => {
    const params = replyCreate(reply);
    expect(params.flags).toEqual({ readonly: true, permissionlessExtension: true });
    expect(Object.keys(params.attributes as object).sort()).toEqual(["app", "demo", "kind", "parent", "period", "status", "v"]);
    expect(new TextDecoder().decode(params.payload)).toBe('{"v":1}');
    const decoded = decodeReply(asStored(params, UNION, keyOf(7)));
    expect(decoded).toMatchObject({ ok: true, value: { kind: "reply", parent: KEY, status: "taken_up", period: 202610, creator: UNION, demo: false } });
  });

  it("refuse an unknown status, a bad parent or a bad month before anything is sent", () => {
    expect(() => replyCreate({ ...reply, status: "we will call you" as never })).toThrow(/reply status/);
    expect(() => replyCreate({ ...reply, parent: "0x1234" })).toThrow(/32-byte/);
    expect(() => replyCreate({ ...reply, period: 202613 })).toThrow(/YYYYMM/);
  });

  it("readers reject a reply with a status outside the vocabulary, or one that is really an incident", () => {
    const params = replyCreate(reply);
    const bad = asStored({ ...params, attributes: { ...(params.attributes as object), status: { type: "str", value: "call 9876543210" } } as unknown as typeof params.attributes });
    expect(decodeReply(bad)).toMatchObject({ ok: false, reason: "bad reply status" });
    expect(validateEntity("reply", bad).join()).toMatch(/status/);
    expect(decodeReply(asStored(replyCreate(reply), ALICE, keyOf(8)))).toMatchObject({ ok: true });
  });

  it("query by report, with demo data left out unless asked for", () => {
    const text = queryText(replyPredicate({ parent: KEY }));
    expect(text).toContain("kind = str('reply')");
    expect(text).toContain(KEY);
    expect(text).toContain("demo");
    expect(queryText(replyPredicate({ includeDemo: true }))).not.toContain("demo");
  });

  it("a reporter replying to their own report is not an answer, and a trust set limits who counts", () => {
    const report = storedIncident({}, ALICE, 1);
    const other = storedIncident({}, BOB, 2);
    const replies = [
      storedReply({ parent: report.key, status: "received" }, UNION, 10, 5n),
      storedReply({ parent: report.key, status: "escalated" }, UNION, 11, 9n),
      storedReply({ parent: other.key, status: "resolved" }, BOB, 12),
      storedReply({ parent: other.key, status: "taken_up" }, ALICE, 13),
    ];
    expect(repliesTo(report, replies).map((r) => r.status)).toEqual(["escalated", "received"]);
    expect(repliesTo(other, replies).map((r) => r.status)).toEqual(["taken_up"]);
    expect([...answeredReports([report, other], replies)].sort()).toEqual([report.key, other.key].sort());
    expect([...answeredReports([report, other], replies, new Set([UNION]))]).toEqual([report.key]);
  });
});
