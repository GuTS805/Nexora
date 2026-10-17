import {
  CITIES, CSV_TEMPLATE, EXPIRY_CHOICES_DAYS, HOURS_BAND_LABELS, INCENTIVES, INCIDENT_TYPES, MAX_BATCH, MAX_DAYS_LOST,
  MIN_PASSPHRASE_LENGTH, PLATFORM_WORK, PLATFORMS, VEHICLES, costPct, createLocked, explainError, hoursBand, isOneOf,
  netHourly, parseShiftsCsv, seal, shiftCreate, type City, type Platform, type Vehicle, type WorkType,
} from "nexora-ledger";
import { useMemo, useState, type ReactNode } from "react";
import type { Hex } from "viem";
import { useArkiv } from "../arkiv.tsx";
import { EntityLink, Field, Hourly, TxLink, VocabSelect, WalletBar, useMonth } from "../components.tsx";
import { useI18n } from "../i18n.tsx";
import { enqueue, formParams, isOffline, randomSendTime, type FormEntry } from "../queue.ts";
import { store } from "../storage.ts";
import { MicButton } from "../voice.tsx";
import { EasyDay } from "../easy.tsx";
import { recentPeriods } from "./Explore.tsx";

type Receipt = { txHash: Hex; keys: Hex[] };
type Lifetime = (typeof EXPIRY_CHOICES_DAYS)[number];

function useQueryParams() {
  return useMemo(() => new URLSearchParams(location.hash.split("?")[1] ?? ""), []);
}

/** The worker's usual platform, work, city and vehicle, remembered on this device only. */
type Profile = { platform: Platform; work: WorkType; city: City; vehicle: Vehicle };

function savedProfile(params: URLSearchParams): Profile {
  let saved: Partial<Record<keyof Profile, unknown>> = {};
  try {
    saved = JSON.parse(store.get("profile") ?? "{}") as typeof saved;
  } catch {
    /* corrupt or missing: use defaults */
  }
  const choose = <T extends string>(list: readonly T[], name: keyof Profile, fallback: T): T => {
    const fromLink = params.get(name);
    if (isOneOf(list, fromLink)) return fromLink;
    return isOneOf(list, saved[name]) ? (saved[name] as T) : fallback;
  };
  const platform = choose(PLATFORMS, "platform", "swiggy");
  const work = choose(PLATFORM_WORK[platform], "work", PLATFORM_WORK[platform][0]!);
  return { platform, work, city: choose(CITIES, "city", "bengaluru"), vehicle: choose(VEHICLES, "vehicle", "petrol_bike") };
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

/** Platform and kind of work, kept consistent: changing the platform keeps the work only if offered. */
function PlatformWork({ profile, setProfile }: { profile: Profile; setProfile: (p: Profile) => void }) {
  return (
    <>
      <Field label="platform">
        <VocabSelect
          list={PLATFORMS}
          value={profile.platform}
          onChange={(x) => x && setProfile({ ...profile, platform: x, work: PLATFORM_WORK[x].includes(profile.work) ? profile.work : PLATFORM_WORK[x][0]! })}
        />
      </Field>
      <Field label="work"><VocabSelect list={PLATFORM_WORK[profile.platform]} value={profile.work} onChange={(x) => x && setProfile({ ...profile, work: x })} /></Field>
      <Field label="city"><VocabSelect list={CITIES} value={profile.city} onChange={(x) => x && setProfile({ ...profile, city: x })} /></Field>
    </>
  );
}

/** Shared tail of both forms: privacy columns, lifetime, one-time wallet and the publish button. */
function PublishPanel(props: {
  publicPreview: ReactNode;
  sealedDescription: string;
  sealedFields?: ReactNode;
  passphrase: string;
  setPassphrase: (p: string) => void;
  expiresInDays: Lifetime;
  setExpiresInDays: (d: Lifetime) => void;
  valid: boolean;
  entry: (sealed: Awaited<ReturnType<typeof seal>> | undefined) => FormEntry;
  sealedContent: () => Parameters<typeof seal>[0];
  defaultOneOff?: boolean;
}) {
  const { reader, wallet, ensureGas, bump, createOneOff } = useArkiv();
  const { t } = useI18n();
  const [oneOff, setOneOff] = useState(props.defaultOneOff ?? false);
  const [lock, setLock] = useState(false);
  const [later, setLater] = useState(false);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [queued, setQueued] = useState<"offline" | number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sealing = props.passphrase.length > 0;

  async function publish() {
    setBusy(true);
    setError(null);
    setReceipt(null);
    setQueued(null);
    try {
      if (!wallet && !oneOff) throw new Error(t("connectFirst"));
      if (sealing && props.passphrase.length < MIN_PASSPHRASE_LENGTH) throw new Error(t("passTooShort", { n: MIN_PASSPHRASE_LENGTH }));
      // Sealing is local, so it works offline too; the passphrase is never part of what is saved.
      const entry = props.entry(sealing ? await seal(props.sealedContent(), props.passphrase) : undefined);
      const params = formParams(entry);
      // Held back to a random moment: kept on the phone, exactly as it will be published, until then.
      if (later || isOffline()) {
        const notBefore = later ? randomSendTime() : undefined;
        enqueue(entry, { oneOff, lock, notBefore });
        setQueued(notBefore ?? "offline");
        props.setPassphrase("");
        return;
      }
      // A one-time wallet is created only now, after validation, so failed forms leave no stray keys.
      const publisher = oneOff ? createOneOff() : wallet!;
      await ensureGas(publisher.address);
      // Locked: created and handed to 0x…dEaD in one transaction, so nobody can delete it early.
      const result = lock ? await createLocked(reader, publisher.client, publisher.address, params) : await publisher.client.createEntity(params);
      setReceipt({ txHash: result.txHash, keys: [result.entityKey] });
      props.setPassphrase("");
      bump();
    } catch (cause) {
      setError(explainError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <fieldset className="privacy">
        <legend>{t("privacyLegend")}</legend>
        <div className="columns">
          <div>
            <h4>{t("publicTitle")}</h4>
            {props.publicPreview}
            <p className="small muted">{t("publicNote")}</p>
          </div>
          <div>
            <h4>{t("sealedSection")}</h4>
            <p className="small">{props.sealedDescription}</p>
            {props.sealedFields}
            <input type="password" placeholder={t("passMin", { label: t("passphrase"), n: MIN_PASSPHRASE_LENGTH })} value={props.passphrase} onChange={(e) => props.setPassphrase(e.target.value)} autoComplete="new-password" />
          </div>
          <div>
            <h4>{t("neverTitle")}</h4>
            <p className="small">{t("neverDesc")}</p>
          </div>
        </div>
        <Field label="expiry">
          <select value={props.expiresInDays} onChange={(e) => props.setExpiresInDays(Number(e.target.value) as Lifetime)}>
            {EXPIRY_CHOICES_DAYS.map((d) => <option key={d} value={d}>{d} {t("daysUnit")}</option>)}
          </select>
        </Field>
        <p className="small muted">{t("expiryNote")}</p>
      </fieldset>
      <label className="check">
        <input type="checkbox" checked={oneOff} onChange={(e) => setOneOff(e.target.checked)} /> {t("oneOffLabel")}
      </label>
      {oneOff && <p className="small muted">{t("oneOffHelp")}</p>}
      <label className="check">
        <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} /> {t("lockLabel")}
      </label>
      {lock && <p className="small muted">{t("lockHelp")}</p>}
      <label className="check">
        <input type="checkbox" checked={later} onChange={(e) => setLater(e.target.checked)} /> {t("laterLabel")}
      </label>
      {later && <p className="small muted">{t("laterHelp")}</p>}
      <button disabled={(!wallet && !oneOff) || !props.valid || busy} onClick={publish}>{busy ? t("publishing") : t("publish")}</button>
      {queued === "offline" && <p className="card success" role="status">{t("offlineSaved")}</p>}
      {typeof queued === "number" && <p className="card success" role="status">{t("laterSaved", { time: new Date(queued).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) })}</p>}
      <PublishResult receipt={receipt} error={error} />
    </>
  );
}

const digits = (value: string) => value.replace(/[^\d.]/g, "");

function ShiftForm({ profile, setProfile }: { profile: Profile; setProfile: (p: Profile) => void }) {
  const { t, v } = useI18n();
  const month = useMonth();
  const [period, setPeriod] = useState(recentPeriods()[0]!);
  const [gross, setGross] = useState("");
  const [costs, setCosts] = useState("");
  const [hours, setHours] = useState("");
  const [incentive, setIncentive] = useState<(typeof INCENTIVES)[number]>("none");
  const [orders, setOrders] = useState("");
  const [note, setNote] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [expiresInDays, setExpiresInDays] = useState<Lifetime>(365);

  const g = Number(gross), c = Number(costs || "0"), h = Number(hours);
  const valid = gross !== "" && g >= 0 && c >= 0 && h > 0 && h <= 24;
  const input = { ...profile, period, grossInr: g, costsInr: c, hours: h, incentive, expiresInDays, demo: false };

  return (
    <>
      <EasyDay start={profile} onDone={(day) => {
        setProfile({ ...profile, platform: day.platform, work: day.work, city: day.city });
        setGross(String(day.gross));
        setCosts(String(day.costs));
        setHours(String(day.hours));
      }} />
      <MicButton onDay={(day) => {
        if (day.grossInr !== undefined) setGross(String(day.grossInr));
        if (day.costsInr !== undefined) setCosts(String(day.costsInr));
        if (day.hours !== undefined) setHours(String(day.hours));
      }} />
      <div className="form-grid">
        <PlatformWork profile={profile} setProfile={setProfile} />
        <Field label="vehicle"><VocabSelect list={VEHICLES} value={profile.vehicle} onChange={(x) => x && setProfile({ ...profile, vehicle: x })} /></Field>
        <label className="field">
          <span>{t("month")}</span>
          <select value={period} onChange={(e) => setPeriod(Number(e.target.value))}>{recentPeriods().map((p) => <option key={p} value={p}>{month(p)}</option>)}</select>
        </label>
        <Field label="incentive"><VocabSelect list={INCENTIVES} value={incentive} onChange={(x) => x && setIncentive(x)} /></Field>
        <Field label="gross"><input inputMode="decimal" value={gross} onChange={(e) => setGross(digits(e.target.value))} placeholder="1180" /></Field>
        <Field label="costs"><input inputMode="decimal" value={costs} onChange={(e) => setCosts(digits(e.target.value))} placeholder="240" /></Field>
        <Field label="hours"><input inputMode="decimal" value={hours} onChange={(e) => setHours(digits(e.target.value))} placeholder="10" /></Field>
      </div>
      <PublishPanel
        publicPreview={
          <>
            <p className="small">{[`${v(profile.platform)} · ${v(profile.work)}`, v(profile.city), v(profile.vehicle), month(period), `${t("incentive")}: ${v(incentive)}`].join(", ")}</p>
            <p className="small">
              {t("hoursBandIs")} <b>{valid ? HOURS_BAND_LABELS[hoursBand(h)] : "—"}</b> · {t("netRounded")} <b>{valid ? <Hourly value={netHourly(g, c, h)} /> : "—"}</b> · {t("costShareIs")} <b>{valid ? `${costPct(g, c)}%` : "—"}</b>
            </p>
          </>
        }
        sealedDescription={t("sealedDescShift", { g: gross || "…", c: costs || "…" })}
        sealedFields={
          <>
            <input placeholder={t("ordersPh")} inputMode="numeric" value={orders} onChange={(e) => setOrders(e.target.value.replace(/\D/g, ""))} />
            <input placeholder={t("notePh")} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
          </>
        }
        passphrase={passphrase}
        setPassphrase={setPassphrase}
        expiresInDays={expiresInDays}
        setExpiresInDays={setExpiresInDays}
        valid={valid}
        entry={(sealed) => ({ kind: "shift", input: { ...input, sealed } })}
        sealedContent={() => ({ grossInr: g, costsInr: c, hours: h, orders: orders ? Number(orders) : undefined, note: note || undefined })}
      />
      <CsvImport />
    </>
  );
}

function IncidentForm({ profile, setProfile, params }: { profile: Profile; setProfile: (p: Profile) => void; params: URLSearchParams }) {
  const { t, v } = useI18n();
  const month = useMonth();
  const parent = params.get("parent");
  const validParent = parent && /^0x[0-9a-fA-F]{64}$/.test(parent) ? (parent as Hex) : undefined;
  const [type, setType] = useState(isOneOf(INCIDENT_TYPES, params.get("type")) ? (params.get("type") as (typeof INCIDENT_TYPES)[number]) : "id_blocked");
  const [period, setPeriod] = useState(recentPeriods()[0]!);
  const [daysLost, setDaysLost] = useState("0");
  const [reasonGiven, setReasonGiven] = useState(false);
  const [appealed, setAppealed] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [note, setNote] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [expiresInDays, setExpiresInDays] = useState<Lifetime>(365);
  const days = Number(daysLost || "0");
  const valid = Number.isInteger(days) && days >= 0 && days <= MAX_DAYS_LOST;
  const yesNo = (b: boolean) => (b ? t("yes") : t("no"));

  // Incident reports default to a fresh one-time wallet (defaultOneOff below): a report should not be
  // linkable to the worker's earnings history, or to their other reports, by wallet address.
  return (
    <>
      {validParent && <p className="card">{t("updateOf").split("{key}")[0]}<EntityLink entityKey={validParent} />{t("updateOf").split("{key}")[1]}</p>}
      <div className="form-grid">
        <Field label="incidentType"><VocabSelect list={INCIDENT_TYPES} value={type} onChange={(x) => x && setType(x)} /></Field>
        <PlatformWork profile={profile} setProfile={setProfile} />
        <label className="field">
          <span>{t("month")}</span>
          <select value={period} onChange={(e) => setPeriod(Number(e.target.value))}>{recentPeriods().map((p) => <option key={p} value={p}>{month(p)}</option>)}</select>
        </label>
        <Field label="daysLost"><input inputMode="numeric" value={daysLost} onChange={(e) => setDaysLost(e.target.value.replace(/\D/g, ""))} /></Field>
      </div>
      <label className="check"><input type="checkbox" checked={reasonGiven} onChange={(e) => setReasonGiven(e.target.checked)} /> {t("reasonGiven")}</label>
      <label className="check"><input type="checkbox" checked={appealed} onChange={(e) => setAppealed(e.target.checked)} /> {t("appealed")}</label>
      <label className="check"><input type="checkbox" checked={resolved} onChange={(e) => setResolved(e.target.checked)} /> {t("resolved")}</label>
      <PublishPanel
        publicPreview={
          <p className="small">
            {[v(type), `${v(profile.platform)} · ${v(profile.work)}`, v(profile.city), month(period), t("daysShort", { n: days }),
              `${t("reasonGiven")}: ${yesNo(reasonGiven)}`, `${t("appealed")}: ${yesNo(appealed)}`, `${t("resolved")}: ${yesNo(resolved)}`].join(", ")}
          </p>
        }
        sealedDescription={t("sealedDescIncident")}
        sealedFields={<textarea rows={3} placeholder={t("notePh")} maxLength={1_000} value={note} onChange={(e) => setNote(e.target.value)} />}
        passphrase={passphrase}
        setPassphrase={setPassphrase}
        expiresInDays={expiresInDays}
        setExpiresInDays={setExpiresInDays}
        valid={valid}
        entry={(sealed) => ({ kind: "incident", input: {
          platform: profile.platform, work: profile.work, city: profile.city, type, period, daysLost: days,
          reasonGiven, appealed, resolved, expiresInDays, parent: validParent, demo: false, sealed,
        } })}
        sealedContent={() => ({ note: note || undefined })}
        defaultOneOff
      />
    </>
  );
}

export function Log() {
  const { t } = useI18n();
  const params = useQueryParams();
  const [tab, setTab] = useState<"shift" | "incident">(params.get("tab") === "incident" || params.has("parent") ? "incident" : "shift");
  const [profile, setProfileState] = useState(() => savedProfile(params));
  const setProfile = (next: Profile) => {
    setProfileState(next);
    store.set("profile", JSON.stringify(next));
  };

  return (
    <section>
      <h2>{t("navLog")}</h2>
      <WalletBar />
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "shift"} className={tab === "shift" ? "" : "secondary"} onClick={() => setTab("shift")}>{t("tabShift")}</button>
        <button role="tab" aria-selected={tab === "incident"} className={tab === "incident" ? "" : "secondary"} onClick={() => setTab("incident")}>{t("tabIncident")}</button>
      </div>
      {tab === "shift" ? <ShiftForm profile={profile} setProfile={setProfile} /> : <IncidentForm profile={profile} setProfile={setProfile} params={params} />}
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
  const parsed = text.trim() ? parseShiftsCsv(text, 365) : null;

  async function importRows() {
    if (!wallet || !parsed) return;
    setBusy(true);
    setError(null);
    try {
      await ensureGas();
      const keys: Hex[] = [];
      let txHash: Hex | null = null;
      for (let i = 0; i < parsed.rows.length; i += MAX_BATCH) {
        const result = await wallet.client.executeBatch({ creates: parsed.rows.slice(i, i + MAX_BATCH).map(shiftCreate) });
        keys.push(...result.createdEntities);
        txHash = result.txHash;
      }
      if (txHash) setReceipt({ txHash, keys });
      bump();
    } catch (cause) {
      setError(explainError(cause));
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
