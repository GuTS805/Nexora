/**
 * Per-device preferences only (language, RPC override, burner key, followed lists). Wrapped so a
 * private window or blocked storage degrades to "nothing remembered" instead of crashing.
 */
const PREFIX = "nexora.";

export const store = {
  get(name: string): string | null {
    try {
      return localStorage.getItem(PREFIX + name);
    } catch {
      return null;
    }
  },
  set(name: string, value: string | null): void {
    try {
      if (value === null) localStorage.removeItem(PREFIX + name);
      else localStorage.setItem(PREFIX + name, value);
    } catch {
      /* storage unavailable: preference is not remembered */
    }
  },
};
