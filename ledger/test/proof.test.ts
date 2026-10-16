import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { authorshipMessage, formatProof, parseProof, verifyAuthorship, type AuthorshipProof } from "../src/index.ts";

const entityKey = `0x${"ab".repeat(32)}` as const;
const author = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());

async function proofBy(account: typeof author, challenge: string): Promise<AuthorshipProof> {
  return { entityKey, challenge, signature: await account.signMessage({ message: authorshipMessage(entityKey, challenge) }) };
}

describe("authorship proofs", () => {
  it("are accepted only from the wallet that wrote the entry, for that entry and that challenge", async () => {
    const proof = await proofBy(author, "union desk 4471");
    expect(await verifyAuthorship(proof, { entityKey, creator: author.address, challenge: "union desk 4471" })).toBe(true);
    // Someone else's key, another entry, or a proof made for a different checker are all refused.
    expect(await verifyAuthorship(await proofBy(stranger, "union desk 4471"), { entityKey, creator: author.address })).toBe(false);
    expect(await verifyAuthorship(proof, { entityKey: `0x${"cd".repeat(32)}`, creator: author.address })).toBe(false);
    expect(await verifyAuthorship(proof, { entityKey, creator: author.address, challenge: "lawyer 9" })).toBe(false);
    expect(await verifyAuthorship({ ...proof, challenge: "union desk 4472" }, { entityKey, creator: author.address })).toBe(false);
  });

  it("survive being pasted as text, and say nothing about the person", async () => {
    const proof = await proofBy(author, "  union\n desk   4471 ");
    const text = formatProof(proof);
    expect(text).toContain("Challenge: union desk 4471");
    expect(text).not.toContain(author.address);
    const back = parseProof(`forwarded:\n${text}\n`);
    expect(back).not.toBeNull();
    expect(await verifyAuthorship(back!, { entityKey, creator: author.address, challenge: "union desk 4471" })).toBe(true);
    expect(parseProof("Entry: 0x12\nSignature: 0x34")).toBeNull();
  });

  it("works without a challenge, and refuses keys that are not entity keys", async () => {
    const proof = await proofBy(author, "");
    expect(formatProof(proof)).toContain("Challenge: (none)");
    expect(await verifyAuthorship(parseProof(formatProof(proof))!, { entityKey, creator: author.address })).toBe(true);
    expect(() => authorshipMessage("0x1234", "x")).toThrow();
  });
});
