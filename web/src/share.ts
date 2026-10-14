/** Absolute link to a page of this app, wherever it is hosted (Vercel, IPFS gateway, local file). */
export function appUrl(hash: string): string {
  return `${location.origin}${location.pathname}${hash}`;
}

/**
 * wa.me opens WhatsApp (app on phones, web on desktop) with the text pre-filled and lets the seller
 * pick a contact or group. Nothing passes through a Nexora server.
 */
export function whatsappUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
