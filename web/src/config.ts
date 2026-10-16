import type { Address, Hex } from "viem";
import evidence from "../../arkiv/evidence.json";
import guides from "../../arkiv/guides-onchain.json";

/**
 * The trust list the app suggests by default for advice. It is only a suggestion: any visitor can
 * pick another list or "All workers", and anyone can publish a competing list. Its key comes from
 * the seed run recorded in arkiv/evidence.json, so it is checkable on the explorer.
 */
export const RECOMMENDED_TRUST_LIST = (evidence.recommendedTrustList ?? null) as Hex | null;

/**
 * Whose guides (laws and platform ratings) the Rights page reads: the recommended list's curator,
 * as recorded when the guides were published (arkiv/guides-onchain.json). Anyone can publish
 * competing guides; readers choose whom to trust, by `$creator`.
 */
export const GUIDE_CURATOR = (guides.curator ?? null) as Address | null;
