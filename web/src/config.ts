import type { Hex } from "viem";
import evidence from "../../arkiv/evidence.json";

/**
 * The trust list the app suggests by default for advice. It is only a suggestion: any visitor can
 * pick another list or "All sellers", and anyone can publish a competing list. Its key comes from
 * the seed run recorded in arkiv/evidence.json, so it is checkable on the explorer.
 */
export const RECOMMENDED_TRUST_LIST = (evidence.recommendedTrustList ?? null) as Hex | null;
