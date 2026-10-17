import { CITIES, PLATFORM_WORK, PLATFORMS, type City, type Platform, type WorkType } from "nexora-ledger";
import { useEffect, useState } from "react";
import { useI18n, type StringKey, type UiLang } from "./i18n.tsx";
import { PlatformLogo } from "./logos.tsx";

/** The phone's own voice in the screen language, when it has one; nothing is sent anywhere. */
function speak(text: string, ui: UiLang) {
  if (typeof window === "undefined" || !("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = `${ui}-IN`;
  const voice = speechSynthesis.getVoices().find((v) => v.lang.replace("_", "-").toLowerCase().startsWith(ui === "en" ? "en-in" : ui));
  if (voice) utterance.voice = voice;
  speechSynthesis.speak(utterance);
}

type Day = { platform: Platform; work: WorkType; city: City; gross: number; costs: number; hours: number };
type Step = { ask: StringKey; kind: "platform" | "work" | "city" | "gross" | "costs" | "hours" };

const STEPS: Step[] = [
  { ask: "easyApp", kind: "platform" },
  { ask: "easyWork", kind: "work" },
  { ask: "easyCity", kind: "city" },
  { ask: "easyGross", kind: "gross" },
  { ask: "easyCosts", kind: "costs" },
  { ask: "easyHours", kind: "hours" },
];

/** Quick picks and the step of the − / + buttons, for each number. */
const AMOUNTS = {
  gross: { picks: [500, 800, 1000, 1200, 1500, 2000], step: 50, max: 20_000 },
  costs: { picks: [0, 100, 200, 300, 400, 500], step: 50, max: 10_000 },
  hours: { picks: [4, 6, 8, 10, 12, 14], step: 1, max: 24 },
} as const;

/**
 * Log a day without typing: one question at a time, read aloud by the phone, answered with big
 * buttons, quick amounts and − / + steps. It only fills in the form below; the worker still sees
 * the privacy preview and chooses to publish.
 */
export function EasyDay(props: { start: Omit<Day, "gross" | "costs" | "hours">; onDone: (day: Day) => void }) {
  const { t, v, ui } = useI18n();
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const [day, setDay] = useState<Day>({ ...props.start, gross: 1000, costs: 200, hours: 8 });
  const step = STEPS[i]!;
  const question = t(step.ask);

  useEffect(() => {
    if (open) speak(question, ui);
  }, [open, i, ui]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) speechSynthesis.cancel();
  }, []);

  if (!open) {
    return <button type="button" className="easy-start" onClick={() => { setI(0); setOpen(true); }}>{t("easyStart")}</button>;
  }

  const next = () => (i < STEPS.length - 1 ? setI(i + 1) : (props.onDone(day), setOpen(false)));
  const choose = (patch: Partial<Day>) => { setDay({ ...day, ...patch }); if (i < STEPS.length - 1) setI(i + 1); };
  const amount = step.kind === "gross" || step.kind === "costs" || step.kind === "hours" ? step.kind : null;

  return (
    <section className="card easy" aria-live="polite">
      <p className="small muted">{t("easyStep", { n: i + 1, m: STEPS.length })}</p>
      <h3 className="easy-q">{question} <button type="button" className="link" onClick={() => speak(question, ui)} aria-label={t("listen")}>🔊</button></h3>
      {step.kind === "platform" && (
        <div className="easy-choices">
          {PLATFORMS.filter((p) => p !== "other").map((p) => (
            <button key={p} type="button" className={day.platform === p ? "chosen" : ""} onClick={() => choose({ platform: p, work: PLATFORM_WORK[p].includes(day.work) ? day.work : PLATFORM_WORK[p][0]! })}>
              <PlatformLogo platform={p} /> {v(p)}
            </button>
          ))}
        </div>
      )}
      {step.kind === "work" && (
        <div className="easy-choices">
          {PLATFORM_WORK[day.platform].map((w) => <button key={w} type="button" className={day.work === w ? "chosen" : ""} onClick={() => choose({ work: w })}>{v(w)}</button>)}
        </div>
      )}
      {step.kind === "city" && (
        <div className="easy-choices">
          {CITIES.map((c) => <button key={c} type="button" className={day.city === c ? "chosen" : ""} onClick={() => choose({ city: c })}>{v(c)}</button>)}
        </div>
      )}
      {amount && (
        <>
          <div className="stepper">
            <button type="button" aria-label="−" onClick={() => setDay({ ...day, [amount]: Math.max(amount === "hours" ? 1 : 0, day[amount] - AMOUNTS[amount].step) })}>−</button>
            <output className="mono">{amount === "hours" ? day.hours : `₹${day[amount]}`}</output>
            <button type="button" aria-label="+" onClick={() => setDay({ ...day, [amount]: Math.min(AMOUNTS[amount].max, day[amount] + AMOUNTS[amount].step) })}>+</button>
          </div>
          <div className="easy-choices amounts">
            {AMOUNTS[amount].picks.map((n) => <button key={n} type="button" className={day[amount] === n ? "chosen" : ""} onClick={() => setDay({ ...day, [amount]: n })}>{amount === "hours" ? n : `₹${n}`}</button>)}
          </div>
        </>
      )}
      <p className="row spread">
        <button type="button" className="secondary" onClick={() => (i === 0 ? setOpen(false) : setI(i - 1))}>{i === 0 ? t("easyClose") : t("easyBack")}</button>
        <button type="button" onClick={next}>{i === STEPS.length - 1 ? t("easyDone") : t("easyNext")}</button>
      </p>
    </section>
  );
}
