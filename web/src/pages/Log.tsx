import {
  CATEGORIES, CSV_TEMPLATE, CTAS, EXPIRY_CHOICES_DAYS, FORMATS, LANGUAGES, MAX_BATCH, MIN_PASSPHRASE_LENGTH,
  OFFERS, PLATFORMS, SEASONS, SPEND_BAND_LABELS, TIERS, TONES, experimentCreate, isOneOf, parseExperimentsCsv,
  roiPct, seal, spendBand, type ExperimentInput,
} from "@nexora/ledger";
import { useMemo, useState } from "react";
import type { Hex } from "viem";
import { useArkiv } from "../arkiv.tsx";
import { EntityLink, Field, Roi, TxLink, VocabSelect, WalletBar } from "../components.tsx";
import { useI18n } from "../i18n.tsx";

type Receipt = { txHash: Hex; keys: Hex[] };

function useQueryParams() {
  return useMemo(() => new URLSearchParams(location.hash.split("?")[1] ?? ""), []);
}

function PublishResult({ receipt, error }: { receipt: Receipt | null; error: string | null }) {
  if (error) return <p className="error" role="alert">{error}</p>;
  if (!receipt) return null;
  return (
    <div className="card success">
      <p>Published {receipt.keys.length} entit{receipt.keys.length === 1 ? "y" : "ies"} on Tiramisu. Transaction <TxLink hash={receipt.txHash} />.</p>
      <p className="small">{receipt.keys.map((key) => <span key={key}><EntityLink entityKey={key} /> </span>)}</p>
      <p className="small muted">Anyone can now read this with the CLI or any Arkiv client, even if this website goes offline.</p>
    </div>
  );
}

export function Log() {
  const { wallet, ensureGas, bump } = useArkiv();
  const { t, v } = useI18n();
  const params = useQueryParams();
  const fromParam = <T extends string>(list: readonly T[], name: string, fallback: T): T => {
    const value = params.get(name);
    return isOneOf(list, value) ? value : fallback;
  };
  const [form, setForm] = useState({
    category: fromParam(CATEGORIES, "category", "tea_coffee"),
    platform: fromParam(PLATFORMS, "platform", "instagram"),
    format: fromParam(FORMATS, "format", "reel"),
    lang: "hinglish" as (typeof LANGUAGES)[number],
    tier: "tier2" as (typeof TIERS)[number],
    season: "none" as (typeof SEASONS)[number],
    tone: "festive" as (typeof TONES)[number],
    cta: "whatsapp_us" as (typeof CTAS)[number],
    offer: "none" as (typeof OFFERS)[number],
    spendInr: "",
    revenueInr: "",
    orders: "",
    note: "",
    days: "7",
    expiresInDays: 90 as (typeof EXPIRY_CHOICES_DAYS)[number],
    passphrase: "",
  });
  const parent = params.get("parent") as Hex | null;
  const set = <K extends keyof typeof form>(key: K) => (value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);

  const spend = Number(form.spendInr);
  const revenue = Number(form.revenueInr);
  const valid = spend > 0 && revenue >= 0 && form.revenueInr !== "";
  const sealing = form.passphrase.length > 0;

  async function publish() {
    setBusy(true);
    setError(null);
    setReceipt(null);
    try {
      if (!wallet) throw new Error("Connect a wallet first.");
      if (sealing && form.passphrase.length < MIN_PASSPHRASE_LENGTH) throw new Error(`Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters, or leave it empty to skip sealing.`);
      const input: ExperimentInput = {
        category: form.category, platform: form.platform, format: form.format, lang: form.lang, tier: form.tier,
        season: form.season, tone: form.tone, cta: form.cta, offer: form.offer,
        spendInr: spend, revenueInr: revenue, days: Number(form.days), expiresInDays: form.expiresInDays,
        parent: parent ?? undefined,
        sealed: sealing ? await seal({ spendInr: spend, revenueInr: revenue, orders: form.orders ? Number(form.orders) : undefined, note: form.note || undefined }, form.passphrase) : undefined,
      };
      const params = experimentCreate(input);
      await ensureGas();
      const result = await wallet.client.createEntity(params);
      setReceipt({ txHash: result.txHash, keys: [result.entityKey] });
      setForm((f) => ({ ...f, passphrase: "" }));
      bump();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>{t("navLog")}</h2>
      <WalletBar />
      {parent && <p className="card">This is a variant of <EntityLink entityKey={parent} />. It will be linked to it on Arkiv so others can compare.</p>}
      <div className="form-grid">
        <Field label="category"><VocabSelect list={CATEGORIES} value={form.category} onChange={(x) => x && set("category")(x)} /></Field>
        <Field label="platform"><VocabSelect list={PLATFORMS} value={form.platform} onChange={(x) => x && set("platform")(x)} /></Field>
        <Field label="format"><VocabSelect list={FORMATS} value={form.format} onChange={(x) => x && set("format")(x)} /></Field>
        <Field label="lang"><VocabSelect list={LANGUAGES} value={form.lang} onChange={(x) => x && set("lang")(x)} /></Field>
        <Field label="tier"><VocabSelect list={TIERS} value={form.tier} onChange={(x) => x && set("tier")(x)} /></Field>
        <Field label="season"><VocabSelect list={SEASONS} value={form.season} onChange={(x) => x && set("season")(x)} /></Field>
        <Field label="tone"><VocabSelect list={TONES} value={form.tone} onChange={(x) => x && set("tone")(x)} /></Field>
        <Field label="cta"><VocabSelect list={CTAS} value={form.cta} onChange={(x) => x && set("cta")(x)} /></Field>
        <Field label="offer"><VocabSelect list={OFFERS} value={form.offer} onChange={(x) => x && set("offer")(x)} /></Field>
        <Field label="spend"><input inputMode="numeric" value={form.spendInr} onChange={(e) => set("spendInr")(e.target.value.replace(/[^\d.]/g, ""))} placeholder="3500" /></Field>
        <Field label="revenue"><input inputMode="numeric" value={form.revenueInr} onChange={(e) => set("revenueInr")(e.target.value.replace(/[^\d.]/g, ""))} placeholder="9100" /></Field>
        <Field label="days"><input inputMode="numeric" value={form.days} onChange={(e) => set("days")(e.target.value.replace(/\D/g, ""))} /></Field>
      </div>

      <fieldset className="privacy">
        <legend>Privacy — what goes where</legend>
        <div className="columns">
          <div>
            <h4>🌐 Public on Arkiv</h4>
            <p className="small">{v(form.category)}, {v(form.platform)} · {v(form.format)}, {v(form.tier)}, {v(form.lang)}, {v(form.season)}, {v(form.tone)}, {v(form.cta)}, {v(form.offer)}, {form.days} days</p>
            <p className="small">Spend band: <b>{valid ? SPEND_BAND_LABELS[spendBand(spend)] : "—"}</b> · ROI rounded to 10%: <b>{valid ? <Roi value={roiPct(spend, revenue)} /> : "—"}</b></p>
            <p className="small muted">Your wallet address is shown as the publisher. No name, phone, shop or product name is ever asked for.</p>
          </div>
          <div>
            <h4>🔒 Sealed (optional)</h4>
            <p className="small">Exact ₹{form.spendInr || "…"} spend, ₹{form.revenueInr || "…"} sales, orders and a private note — encrypted in this browser (AES-256-GCM). Only someone with the passphrase can open them.</p>
            <input placeholder="Orders (optional)" inputMode="numeric" value={form.orders} onChange={(e) => set("orders")(e.target.value.replace(/\D/g, ""))} />
            <input placeholder="Private note (optional)" maxLength={200} value={form.note} onChange={(e) => set("note")(e.target.value)} />
            <input type="password" placeholder={`${t("passphrase")} — min ${MIN_PASSPHRASE_LENGTH}`} value={form.passphrase} onChange={(e) => set("passphrase")(e.target.value)} autoComplete="new-password" />
          </div>
          <div>
            <h4>📱 Never leaves this device</h4>
            <p className="small">Your passphrase. Without a passphrase, the exact rupee figures are discarded after computing the band and ROI.</p>
          </div>
        </div>
        <Field label="expiry">
          <select value={form.expiresInDays} onChange={(e) => set("expiresInDays")(Number(e.target.value) as (typeof EXPIRY_CHOICES_DAYS)[number])}>
            {EXPIRY_CHOICES_DAYS.map((d) => <option key={d} value={d}>{d} {t("daysUnit")}</option>)}
          </select>
        </Field>
        <p className="small muted">After this it disappears from Arkiv automatically. You can delete it earlier from “My data”. Others may extend a result they find useful, but nobody — including you — can edit it once published.</p>
      </fieldset>

      <button disabled={!wallet || !valid || busy} onClick={publish}>{busy ? t("publishing") : t("publish")}</button>
      <PublishResult receipt={receipt} error={error} />
      <CsvImport />
    </section>
  );
}

function CsvImport() {
  const { wallet, ensureGas, bump } = useArkiv();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const parsed = text.trim() ? parseExperimentsCsv(text, 90) : null;

  async function importRows() {
    if (!wallet || !parsed) return;
    setBusy(true);
    setError(null);
    try {
      await ensureGas();
      const keys: Hex[] = [];
      let txHash: Hex | null = null;
      for (let i = 0; i < parsed.rows.length; i += MAX_BATCH) {
        const result = await wallet.client.executeBatch({ creates: parsed.rows.slice(i, i + MAX_BATCH).map(experimentCreate) });
        keys.push(...result.createdEntities);
        txHash = result.txHash;
      }
      if (txHash) setReceipt({ txHash, keys });
      bump();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="card">
      <summary>Import past campaigns from a spreadsheet (CSV)</summary>
      <p className="small muted">Paste rows exported from your sheet. They are validated here, banded, and written in batches of {MAX_BATCH} per transaction. Exact figures are never published.</p>
      <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={CSV_TEMPLATE} />
      <button className="link" onClick={() => setText(CSV_TEMPLATE)}>Use example</button>
      {parsed && <p className="small">{parsed.rows.length} valid rows{parsed.errors.length > 0 && `, ${parsed.errors.length} errors`}</p>}
      {parsed?.errors.slice(0, 5).map((e) => <p key={e.line} className="error small">Line {e.line}: {e.message}</p>)}
      <button disabled={!wallet || !parsed || parsed.rows.length === 0 || busy} onClick={importRows}>{busy ? "Importing…" : `Publish ${parsed?.rows.length ?? 0} rows`}</button>
      <PublishResult receipt={receipt} error={error} />
    </details>
  );
}
