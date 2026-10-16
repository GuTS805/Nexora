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
  /** Removes everything Nexora keeps on this device: keys, waiting entries, usual city, followed list. */
  wipe(): number {
    try {
      const names = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((k): k is string => k?.startsWith(PREFIX) ?? false);
      for (const name of names) localStorage.removeItem(name);
      return names.length;
    } catch {
      return 0;
    }
  },
};
