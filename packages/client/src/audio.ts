/** WebAudio sound effects and a tiny background melody, ported from the prototype. */
import { STORAGE_KEYS, readJson, writeJson } from "./storage";

export type SfxName =
  | "hit" | "shoot" | "bolt" | "heal" | "coin" | "step" | "click" | "build" | "level" | "win" | "lose" | "death";

interface AudioPrefs {
  snd: boolean;
  mus: boolean;
}

type AudioCtor = typeof AudioContext;

let ctx: AudioContext | null = null;
let failed = false;
const prefs: AudioPrefs = { snd: true, mus: false };
{
  const saved = readJson<Partial<AudioPrefs>>(STORAGE_KEYS.audio);
  if (saved?.snd === false) prefs.snd = false;
  if (saved?.mus === true) prefs.mus = true;
}
let musicTimer: ReturnType<typeof setInterval> | null = null;
let melodyIndex = 0;
let unlocked = false;
const listeners = new Set<() => void>();

function save(): void {
  writeJson(STORAGE_KEYS.audio, prefs);
  for (const cb of listeners) cb();
}

/** The AudioContext, created lazily (only after a user gesture, see `unlockAudio`). */
function ac(): AudioContext | null {
  if (failed || !unlocked) return null;
  if (!ctx) {
    try {
      const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
      const Ctor = w.AudioContext ?? w.webkitAudioContext;
      if (!Ctor) {
        failed = true;
        return null;
      }
      ctx = new Ctor();
    } catch {
      failed = true;
      return null;
    }
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => undefined);
  return ctx;
}

function tone(f: number, dur: number, type: OscillatorType = "square", vol = 0.08, f2 = 0, delay = 0): void {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, vol = 0.15, freq = 1200, delay = 0): void {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + delay;
  const len = Math.max(1, Math.floor(a.sampleRate * dur));
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  const f = a.createBiquadFilter();
  const g = a.createGain();
  src.buffer = buf;
  f.type = "lowpass";
  f.frequency.value = freq;
  g.gain.value = vol;
  src.connect(f);
  f.connect(g);
  g.connect(a.destination);
  src.start(t);
}

export function sfx(n: SfxName): void {
  if (!prefs.snd) return;
  try {
    switch (n) {
      case "hit":
        noise(0.14, 0.22, 900);
        tone(120, 0.1, "square", 0.05, 60);
        break;
      case "shoot":
        tone(1100, 0.16, "triangle", 0.06, 300);
        noise(0.08, 0.08, 3000);
        break;
      case "bolt":
        noise(0.4, 0.3, 5000);
        tone(70, 0.35, "sawtooth", 0.08, 40);
        break;
      case "heal":
        tone(520, 0.35, "sine", 0.08, 1040);
        tone(780, 0.3, "sine", 0.05, 1300, 0.08);
        break;
      case "coin":
        tone(1320, 0.07, "square", 0.05);
        tone(1760, 0.12, "square", 0.05, 0, 0.07);
        break;
      case "step":
        tone(180, 0.03, "triangle", 0.025);
        break;
      case "click":
        tone(640, 0.04, "triangle", 0.04);
        break;
      case "build":
        noise(0.08, 0.2, 600);
        noise(0.08, 0.2, 600, 0.15);
        tone(330, 0.2, "triangle", 0.05, 0, 0.3);
        break;
      case "level":
      case "win":
        [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, "triangle", 0.07, 0, i * 0.11));
        break;
      case "lose":
        [392, 330, 262, 196].forEach((f, i) => tone(f, 0.35, "triangle", 0.07, 0, i * 0.18));
        break;
      case "death":
        tone(220, 0.3, "sawtooth", 0.04, 80);
        break;
    }
  } catch {
    // audio is best effort
  }
}

const MELODY = [220, 262, 294, 330, 392, 440, 523];
const PATTERN = [0, 2, 4, 3, 5, 4, 2, 1, 0, 4, 6, 5, 4, 2, 3, 1];

function musicTick(): void {
  if (!prefs.mus) return;
  const f = MELODY[PATTERN[melodyIndex % PATTERN.length] ?? 0] ?? 220;
  tone(f, 0.5, "triangle", 0.035);
  if (melodyIndex % 4 === 0) tone(f / 2, 0.9, "sine", 0.05);
  melodyIndex++;
}

function syncMusic(): void {
  if (prefs.mus && unlocked) {
    if (!musicTimer) musicTimer = setInterval(musicTick, 380);
  } else if (musicTimer) {
    clearInterval(musicTimer);
    musicTimer = null;
  }
}

/** Call from the first user gesture: browsers only allow audio after one. */
export function unlockAudio(): void {
  if (unlocked) return;
  unlocked = true;
  ac();
  syncMusic();
}

export function soundOn(): boolean {
  return prefs.snd;
}

export function musicOn(): boolean {
  return prefs.mus;
}

export function setSound(on: boolean): void {
  prefs.snd = on;
  save();
  if (on) sfx("click");
}

export function setMusic(on: boolean): void {
  prefs.mus = on;
  save();
  syncMusic();
}

export function onAudioChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
