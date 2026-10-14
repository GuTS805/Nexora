import {
  CATEGORIES, CSV_TEMPLATE, CTAS, EXPIRY_CHOICES_DAYS, FORMATS, LANGUAGES, MAX_BATCH, MIN_PASSPHRASE_LENGTH,
  OFFERS, PLATFORM_FORMATS, PLATFORMS, SEASONS, SPEND_BAND_LABELS, TIERS, TONES, experimentCreate, isOneOf, parseExperimentsCsv,
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
  const { t } = useI18n();
  if (error) return <p className="error" role="alert">{error}</p>;
  if (!receipt) return null;
  return (
    <div className="card success">
      <p>{t("published", { n: receipt.keys.length })} <TxLink hash={receipt.txHash} /></p>
      <p className="small">{receipt.keys.map((key) => <span key={key}><EntityLink entityKey={key} /> </span>)}</p>
      <p className="small muted">{t("publishedNote")}</p>
    </div>
  );
}

export function Log() {
  const { wallet, ensureGas, bump, createOneOff } = useArkiv();
  const { t, v } = useI18n();
  const params = useQueryParams();
  const [oneOff, setOneOff] = useState(false);
  const fromParam = <T extends string>(list: readonly T[], name: string, fallback: T): T => {
    const value = params.get(name);
    return isOneOf(list, value) ? value : fallback;
  };
  const initialPlatform = fromParam(PLATFORMS, "platform", "instagram");
  const initialFormat = fromParam(FORMATS, "format", "reel");
  const [form, setForm] = useState({
    category: fromParam(CATEGORIES, "category", "tea_coffee"),
    platform: initialPlatform,
    format: PLATFORM_FORMATS[initialPlatform].includes(initialFormat) ? initialFormat : PLATFORM_FORMATS[initialPlatform][0]!,
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
      if (!wallet && !oneOff) throw new Error(t("connectFirst"));
      if (sealing && form.passphrase.length < MIN_PASSPHRASE_LENGTH) throw new Error(t("passTooShort", { n: MIN_PASSPHRASE_LENGTH }));
      const input: ExperimentInput = {
        category: form.category, platform: form.platform, format: form.format, lang: form.lang, tier: form.tier,
        season: form.season, tone: form.tone, cta: form.cta, offer: form.offer,
        spendInr: spend, revenueInr: revenue, days: Number(form.days), expiresInDays: form.expiresInDays,
        parent: parent ?? undefined,
        sealed: sealing ? await seal({ spendInr: spend, revenueInr: revenue, orders: form.orders ? Number(form.orders) : undefined, note: form.note || undefined }, form.passphrase) : undefined,
      };
      const params = experimentCreate(input);
      // A one-time wallet is created only now, after validation, so failed forms leave no stray keys.
      const publisher = oneOff ? createOneOff() : wallet!;
      await ensureGas(publisher.address);
      const result = await publisher.client.createEntity(params);
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
      {parent && <p className="card">{t("variantOf").split("{key}")[0]}<EntityLink entityKey={parent} />{t("variantOf").split("{key}")[1]}</p>}
      <div className="form-grid">
        <Field label="category"><VocabSelect list={CATEGORIES} value={form.category} onChange={(x) => x && set("category")(x)} /></Field>
        <Field label="platform">
          <VocabSelect
            list={PLATFORMS}
            value={form.platform}
            onChange={(x) => {
              if (!x) return;
              // Keep the format if the new platform sells it, otherwise switch to its first format.
              setForm((f) => ({ ...f, platform: x, format: PLATFORM_FORMATS[x].includes(f.format) ? f.format : PLATFORM_FORMATS[x][0]! }));
            }}
          />
        </Field>
        <Field label="format"><VocabSelect list={PLATFORM_FORMATS[form.platform]} value={form.format} onChange={(x) => x && set("format")(x)} /></Field>
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
        <legend>{t("privacyLegend")}</legend>
        <div className="columns">
          <div>
            <h4>{t("publicTitle")}</h4>
            <p className="small">{[`${v(form.platform)} · ${v(form.format)}`, v(form.category), v(form.tier), v(form.lang), form.season !== "none" && v(form.season), v(form.tone), v(form.cta), form.offer !== "none" && v(form.offer), t("daysShort", { n: form.days || "?" })].filter(Boolean).join(", ")}</p>
            <p className="small">{t("spendBandIs")} <b>{valid ? SPEND_BAND_LABELS[spendBand(spend)] : "—"}</b> · {t("roiRounded")} <b>{valid ? <Roi value={roiPct(spend, revenue)} /> : "—"}</b></p>
            <p className="small muted">{t("publicNote")}</p>
          </div>
          <div>
            <h4>{t("sealedSection")}</h4>
            <p className="small">{t("sealedDesc", { s: form.spendInr || "…", r: form.revenueInr || "…" })}</p>
            <input placeholder={t("ordersPh")} inputMode="numeric" value={form.orders} onChange={(e) => set("orders")(e.target.value.replace(/\D/g, ""))} />
            <input placeholder={t("notePh")} maxLength={200} value={form.note} onChange={(e) => set("note")(e.target.value)} />
            <input type="password" placeholder={t("passMin", { label: t("passphrase"), n: MIN_PASSPHRASE_LENGTH })} value={form.passphrase} onChange={(e) => set("passphrase")(e.target.value)} autoComplete="new-password" />
          </div>
          <div>
            <h4>{t("neverTitle")}</h4>
            <p className="small">{t("neverDesc")}</p>
          </div>
        </div>
        <Field label="expiry">
          <select value={form.expiresInDays} onChange={(e) => set("expiresInDays")(Number(e.target.value) as (typeof EXPIRY_CHOICES_DAYS)[number])}>
            {EXPIRY_CHOICES_DAYS.map((d) => <option key={d} value={d}>{d} {t("daysUnit")}</option>)}
          </select>
        </Field>
        <p className="small muted">{t("expiryNote")}</p>
      </fieldset>

      <label className="check">
        <input type="checkbox" checked={oneOff} onChange={(e) => setOneOff(e.target.checked)} /> {t("oneOffLabel")}
      </label>
      {oneOff && <p className="small muted">{t("oneOffHelp")}</p>}
      <button disabled={(!wallet && !oneOff) || !valid || busy} onClick={publish}>{busy ? t("publishing") : t("publish")}</button>
      <PublishResult receipt={receipt} error={error} />
      <CsvImport />
    </section>
  );
}

function CsvImport() {
  const { wallet, ensureGas, bump } = useArkiv();
  const { t } = useI18n();
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
      <summary>{t("csvSummary")}</summary>
      <p className="small muted">{t("csvDesc", { n: MAX_BATCH })}</p>
      <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={CSV_TEMPLATE} />
      <button className="link" onClick={() => setText(CSV_TEMPLATE)}>{t("useExample")}</button>
      {parsed && <p className="small">{t("validRows", { n: parsed.rows.length })}{parsed.errors.length > 0 && t("rowErrors", { n: parsed.errors.length })}</p>}
      {parsed?.errors.slice(0, 5).map((e) => <p key={e.line} className="error small">{t("lineError", { n: e.line, message: e.message })}</p>)}
      <button disabled={!wallet || !parsed || parsed.rows.length === 0 || busy} onClick={importRows}>{busy ? t("importing") : t("publishRows", { n: parsed?.rows.length ?? 0 })}</button>
      <PublishResult receipt={receipt} error={error} />
    </details>
  );
}
