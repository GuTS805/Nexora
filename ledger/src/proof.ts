import { verifyMessage, type Address, type Hex } from "viem";

/**
 * Proving "I wrote this report" without publishing anything.
 *
 * Incident reports come from one-time wallets, so nothing on chain ties a report to the worker. When
 * they need to show a union, a lawyer or a labour officer that a report is theirs, they sign a short
 * statement with the key that wrote it. The checker compares the signer with the entry's `$creator`,
 * which Arkiv sets and nobody can fake. Nothing is written to Arkiv, and the proof names no person:
 * it shows only that whoever handed it over holds the key. The checker's own challenge (a word or
 * number they pick) stops a proof made for someone else from being replayed to them.
 */

export const PROOF_HEADER = "Nexora authorship proof";
export const MAX_CHALLENGE_LENGTH = 120;

export type AuthorshipProof = { entityKey: Hex; challenge: string; signature: Hex };

const KEY_RE = /^0x[0-9a-f]{64}$/;

/** One line, trimmed and capped, so the signed text is exactly what both sides see. */
export function normaliseChallenge(challenge: string): string {
  return challenge.replace(/\s+/g, " ").trim().slice(0, MAX_CHALLENGE_LENGTH);
}

/** The exact text that is signed. */
export function authorshipMessage(entityKey: Hex, challenge: string): string {
  const key = entityKey.toLowerCase();
  if (!KEY_RE.test(key)) throw new Error("not an entity key");
  return `${PROOF_HEADER}\nEntry: ${key}\nChallenge: ${normaliseChallenge(challenge) || "(none)"}`;
}

/** The proof as text to paste into a message. */
export function formatProof(proof: AuthorshipProof): string {
  return `${authorshipMessage(proof.entityKey, proof.challenge)}\nSignature: ${proof.signature}`;
}

/** Reads a pasted proof back; null if it is not one. */
export function parseProof(text: string): AuthorshipProof | null {
  const entry = /^Entry: (0x[0-9a-fA-F]{64})\s*$/m.exec(text)?.[1];
  const challenge = /^Challenge: (.*)$/m.exec(text)?.[1];
  const signature = /^Signature: (0x[0-9a-fA-F]{130})\s*$/m.exec(text)?.[1];
  if (!text.includes(PROOF_HEADER) || !entry || challenge === undefined || !signature) return null;
  const said = challenge.trim();
  return { entityKey: entry.toLowerCase() as Hex, challenge: said === "(none)" ? "" : said, signature: signature as Hex };
}

/**
 * True when the proof is for `entityKey`, carries the challenge the checker asked for (if any), and
 * was signed by `creator`, the wallet Arkiv records as the entry's author.
 */
export async function verifyAuthorship(proof: AuthorshipProof, expected: { entityKey: Hex; creator: Address; challenge?: string }): Promise<boolean> {
  if (proof.entityKey.toLowerCase() !== expected.entityKey.toLowerCase()) return false;
  if (expected.challenge !== undefined && normaliseChallenge(expected.challenge) !== normaliseChallenge(proof.challenge)) return false;
  try {
    return await verifyMessage({ address: expected.creator, message: authorshipMessage(proof.entityKey, proof.challenge), signature: proof.signature });
  } catch {
    return false;
  }
}
