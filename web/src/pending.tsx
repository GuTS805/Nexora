import { createLocked, explainError } from "nexora-ledger";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Hex } from "viem";
import { useArkiv } from "./arkiv.tsx";
import { EntityLink } from "./components.tsx";
import { useI18n } from "./i18n.tsx";
import { QUEUE_EVENT, dequeue, isDue, isOffline, paramsFor, pendingEntries, type Pending } from "./queue.ts";

/**
 * Entries saved while offline, or held back to be sent at a random later moment. They are published,
 * one at a time, as soon as the browser is back online or their moment has come (or when the worker
 * taps "Publish now"), from the wallet the worker chose in the form.
 */
export function PendingQueue() {
  const { reader, wallet, ensureGas, bump, createOneOff, monthWallet } = useArkiv();
  const { t } = useI18n();
  const [items, setItems] = useState<Pending[]>(pendingEntries);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<Hex[]>([]);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  useEffect(() => {
    const refresh = () => setItems(pendingEntries());
    addEventListener(QUEUE_EVENT, refresh);
    addEventListener("storage", refresh);
    return () => {
      removeEventListener(QUEUE_EVENT, refresh);
      removeEventListener("storage", refresh);
    };
  }, []);

  // `force` is the worker tapping "Publish now", which also sends entries held back for later.
  const flush = useCallback(async (force = false) => {
    if (running.current || isOffline()) return;
    running.current = true;
    setBusy(true);
    setError(null);
    const done: Hex[] = [];
    try {
      for (const item of pendingEntries()) {
        // Entries meant for the connected wallet wait until one is connected.
        if (!item.oneOff && item.month === undefined && !wallet) continue;
        if (!force && !isDue(item)) continue;
        const publisher = item.oneOff ? createOneOff() : item.month !== undefined ? monthWallet(item.month) : wallet!;
        await ensureGas(publisher.address);
        const params = paramsFor(item.entry);
        const result = item.lock ? await createLocked(reader, publisher.client, publisher.address, params) : await publisher.client.createEntity(params);
        dequeue(item.id);
        done.push(result.entityKey);
      }
    } catch (cause) {
      setError(explainError(cause));
    } finally {
      running.current = false;
      setBusy(false);
      if (done.length) {
        setSent((previous) => [...previous, ...done]);
        bump();
      }
    }
  }, [reader, wallet, ensureGas, bump, createOneOff, monthWallet]);

  // Back online: send what was saved.
  useEffect(() => {
    const online = () => void flush();
    addEventListener("online", online);
    return () => removeEventListener("online", online);
  }, [flush]);

  // Delayed entries go out by themselves once their moment has passed, while any Nexora page is open.
  useEffect(() => {
    const tick = () => {
      if (pendingEntries().some((item) => item.notBefore !== undefined && isDue(item))) void flush();
    };
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, [flush]);

  if (items.length === 0 && sent.length === 0) return null;
  const waitingForWallet = !wallet && items.some((item) => !item.oneOff && item.month === undefined);
  const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="card pending" role="status">
      {items.length > 0 && (
        <>
          <p><b>{t("queueTitle", { n: items.length })}</b></p>
          <p className="small muted">{t("queueHelp")}</p>
          {waitingForWallet && <p className="small">{t("queueNeedsWallet")}</p>}
          {items.some((item) => !isDue(item)) && <p className="small">{t("queueDelayedHelp")}</p>}
          <div className="actions">
            <button disabled={busy || isOffline()} onClick={() => void flush(true)}>{busy ? t("publishing") : t("queueSend")}</button>
            {items.map((item) => (
              <button key={item.id} className="secondary" disabled={busy} onClick={() => dequeue(item.id)}>
                {t("queueRemove")} · {item.entry.kind === "shift" ? t("tabShift") : t("tabIncident")} · {new Date(item.savedAt).toLocaleTimeString()}
                {!isDue(item) && ` · ${t("queueSendsAfter", { time: time(item.notBefore!) })}`}
              </button>
            ))}
          </div>
        </>
      )}
      {sent.length > 0 && (
        <p className="small">{t("queueSent", { n: sent.length })} {sent.map((key) => <span key={key}><EntityLink entityKey={key} /> </span>)}</p>
      )}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
