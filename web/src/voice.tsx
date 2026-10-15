import { useEffect, useRef, useState } from "react";
import { useI18n } from "./i18n.tsx";
import { parseSpokenDay, type SpokenDay } from "./voice.ts";

/** The parts of the Web Speech API used here; Chrome and Edge ship it prefixed. */
type Recognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function recognitionClass(): (new () => Recognition) | undefined {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

/**
 * "Say your day": fills earnings, costs and hours from one spoken sentence, in Hindi or English.
 * Hidden where the browser has no speech recognition. The worker still sees and can fix every
 * number before publishing.
 */
export function MicButton({ onDay }: { onDay: (day: SpokenDay) => void }) {
  const { t, lang } = useI18n();
  const [listening, setListening] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const recognition = useRef<Recognition | null>(null);
  useEffect(() => () => recognition.current?.stop(), []);
  const Speech = typeof window === "undefined" ? undefined : recognitionClass();
  if (!Speech) return null;

  function start() {
    const r = new Speech!();
    r.lang = lang === "hi" ? "hi-IN" : "en-IN";
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onresult = (event) => {
      const text = event.results[0]?.[0]?.transcript?.trim() ?? "";
      const day = parseSpokenDay(text);
      if (Object.keys(day).length === 0) setMessage(t("micNothing", { text }));
      else {
        onDay(day);
        setMessage(t("micHeard", { text }));
      }
    };
    r.onerror = (event) => setMessage(event.error === "no-speech" ? t("micNothing", { text: "…" }) : t("micError", { error: event.error }));
    r.onend = () => setListening(false);
    recognition.current = r;
    setMessage(t("micListening"));
    setListening(true);
    try {
      r.start();
    } catch (cause) {
      setListening(false);
      setMessage(t("micError", { error: cause instanceof Error ? cause.message : String(cause) }));
    }
  }

  return (
    <div className="voice">
      <button type="button" className={listening ? "secondary listening" : "secondary"} onClick={() => (listening ? recognition.current?.stop() : start())}>
        {listening ? t("micStop") : t("micStart")}
      </button>
      {message && <p className="small" role="status">{message}</p>}
      <p className="small muted">{t("micPrivacy")}</p>
    </div>
  );
}

/** Reads text aloud in the page language, for workers who would rather listen than read. Links are skipped. */
export function SpeakButton({ text }: { text: string }) {
  const { t, lang } = useI18n();
  const [speaking, setSpeaking] = useState(false);
  const supported = typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
  useEffect(() => () => {
    if (supported) speechSynthesis.cancel();
  }, [supported]);
  if (!supported) return null;

  function speak() {
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.replace(/https?:\/\/\S+/g, "").replace(/[[\]]/g, ""));
    utterance.lang = lang === "hi" ? "hi-IN" : "en-IN";
    const voice = speechSynthesis.getVoices().find((v) => v.lang.replace("_", "-").toLowerCase().startsWith(lang === "hi" ? "hi" : "en-in"));
    if (voice) utterance.voice = voice;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    speechSynthesis.speak(utterance);
  }

  return (
    <button type="button" className="secondary" onClick={() => (speaking ? (speechSynthesis.cancel(), setSpeaking(false)) : speak())}>
      {speaking ? t("listenStop") : t("listen")}
    </button>
  );
}
