/**
 * Synthesized sound (Web Audio, no sound files, so nothing to license): gritty effects built from filtered noise,
 * thumps and metallic partials, and an ambient wasteland soundscape (wind, distant rumble, rare far-off metal)
 * instead of background music. See docs/VISUAL_DIRECTION.md, section "Звук".
 */
import { STORAGE_KEYS, readJson, writeJson } from "./storage";

export type SfxName =
  | "hit" | "shoot" | "bolt" | "heal" | "coin" | "step" | "click" | "build" | "level" | "win" | "lose" | "death"
  | "reward" | "error";

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
let unlocked = false;
const listeners = new Set<() => void>();

/** Effects bus (through a compressor for punch) and the quieter ambience bus. */
let fxBus: GainNode | null = null;
let ambBus: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;

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
      const a = new Ctor();
      const comp = a.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.knee.value = 12;
      comp.ratio.value = 4;
      comp.attack.value = 0.003;
      comp.release.value = 0.2;
      comp.connect(a.destination);
      fxBus = a.createGain();
      fxBus.gain.value = 0.9;
      fxBus.connect(comp);
      ambBus = a.createGain();
      ambBus.gain.value = 0;
      ambBus.connect(a.destination);
      // two seconds of white noise, shared by every noisy sound
      const len = a.sampleRate * 2;
      noiseBuf = a.createBuffer(1, len, a.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      ctx = a;
    } catch {
      failed = true;
      return null;
    }
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => undefined);
  return ctx;
}

interface NoiseOpts {
  dur: number;
  vol: number;
  type: BiquadFilterType;
  freq: number;
  /** Filter frequency at the end (sweep). */
  freq2?: number;
  q?: number;
  delay?: number;
  attack?: number;
  out?: AudioNode | null;
}

/** A burst of filtered noise with a fast attack and an exponential decay. */
function noise(o: NoiseOpts): void {
  const a = ac();
  if (!a || !noiseBuf) return;
  const t = a.currentTime + (o.delay ?? 0);
  const src = a.createBufferSource();
  src.buffer = noiseBuf;
  const f = a.createBiquadFilter();
  f.type = o.type;
  f.frequency.setValueAtTime(o.freq, t);
  if (o.freq2) f.frequency.exponentialRampToValueAtTime(o.freq2, t + o.dur);
  f.Q.value = o.q ?? 0.8;
  const g = a.createGain();
  const att = o.attack ?? 0.002;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.vol, t + att);
  g.gain.exponentialRampToValueAtTime(0.0001, t + att + o.dur);
  src.connect(f);
  f.connect(g);
  g.connect(o.out ?? fxBus ?? a.destination);
  src.start(t, Math.random() * Math.max(0, 1.9 - att - o.dur));
  src.stop(t + att + o.dur + 0.05);
}

/** A tone with a pitch glide and an exponential decay (thumps, chimes, brass). */
function tone(f: number, dur: number, type: OscillatorType, vol: number, f2 = 0, delay = 0, attack = 0.003, lowpass = 0): void {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
  let last: AudioNode = o;
  if (lowpass) {
    const lp = a.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = lowpass;
    o.connect(lp);
    last = lp;
  }
  last.connect(g);
  g.connect(fxBus ?? a.destination);
  o.start(t);
  o.stop(t + attack + dur + 0.05);
}

/** Metallic ring: inharmonic partials, like struck brass or steel. */
function metal(base: number, vol: number, dur: number, delay = 0): void {
  for (const [ratio, v] of [[1, 1], [2.76, 0.6], [5.4, 0.35], [8.93, 0.2]] as const) {
    tone(base * ratio, dur / ratio ** 0.3, "sine", vol * v, 0, delay, 0.001);
  }
}

/** A low body hit: a pitch-dropping sine plus muffled noise. */
function thump(vol: number, delay = 0, from = 120, to = 42): void {
  tone(from, 0.16, "sine", vol, to, delay, 0.002);
  noise({ dur: 0.12, vol: vol * 0.7, type: "lowpass", freq: 700, freq2: 200, delay });
}

/** A soft brass chord that opens up (level up, victory). */
function brass(freqs: readonly number[], vol: number, dur: number, delay = 0): void {
  for (const f of freqs) {
    tone(f, dur, "sawtooth", vol, 0, delay, 0.08, 1400);
    tone(f * 1.003, dur, "sawtooth", vol * 0.6, 0, delay, 0.1, 900);
  }
}

export function sfx(n: SfxName): void {
  if (!prefs.snd) return;
  try {
    switch (n) {
      case "shoot":
        // crack, body and a short tail
        noise({ dur: 0.012, vol: 0.5, type: "highpass", freq: 3500 });
        noise({ dur: 0.09, vol: 0.45, type: "bandpass", freq: 1600, freq2: 500, q: 0.7 });
        tone(95, 0.09, "sine", 0.35, 40);
        noise({ dur: 0.35, vol: 0.12, type: "lowpass", freq: 900, freq2: 150, delay: 0.03 });
        break;
      case "hit":
        thump(0.5);
        noise({ dur: 0.05, vol: 0.25, type: "bandpass", freq: 2400, q: 1.2 });
        break;
      case "bolt":
        // crackling discharge and a thunder roll
        for (let i = 0; i < 7; i++) noise({ dur: 0.03, vol: 0.35, type: "highpass", freq: 2500 + Math.random() * 3000, delay: i * 0.035 + Math.random() * 0.02 });
        noise({ dur: 0.9, vol: 0.4, type: "lowpass", freq: 400, freq2: 60, delay: 0.08, attack: 0.03 });
        tone(55, 0.7, "sine", 0.3, 30, 0.05);
        break;
      case "heal":
        noise({ dur: 0.5, vol: 0.12, type: "bandpass", freq: 600, freq2: 3200, q: 2, attack: 0.15 });
        tone(660, 0.6, "sine", 0.08, 0, 0.05, 0.08);
        tone(990, 0.5, "sine", 0.05, 0, 0.15, 0.08);
        break;
      case "coin":
        metal(1850, 0.07, 0.35);
        metal(2400, 0.05, 0.3, 0.07);
        break;
      case "reward":
        metal(1320, 0.08, 0.7);
        metal(1980, 0.06, 0.7, 0.09);
        noise({ dur: 0.6, vol: 0.06, type: "bandpass", freq: 5000, q: 1.5, attack: 0.1 });
        break;
      case "step":
        noise({ dur: 0.05, vol: 0.12, type: "lowpass", freq: 500 });
        noise({ dur: 0.03, vol: 0.04, type: "highpass", freq: 3000 });
        break;
      case "click":
        noise({ dur: 0.008, vol: 0.18, type: "highpass", freq: 4000 });
        tone(2200, 0.02, "sine", 0.025);
        break;
      case "error":
        tone(180, 0.1, "square", 0.05, 0, 0, 0.004, 900);
        tone(150, 0.14, "square", 0.05, 0, 0.13, 0.004, 900);
        break;
      case "build":
        for (let i = 0; i < 3; i++) {
          thump(0.35, i * 0.16, 160, 60);
          metal(620, 0.05, 0.25, i * 0.16);
        }
        break;
      case "level":
        brass([196, 247, 294], 0.035, 0.9);
        metal(1568, 0.04, 0.8, 0.25);
        break;
      case "win":
        thump(0.5);
        brass([196, 247, 294, 392], 0.035, 1.6, 0.05);
        metal(1568, 0.05, 1.2, 0.4);
        break;
      case "lose":
        thump(0.45);
        brass([147, 175, 220], 0.03, 1.8, 0.05);
        noise({ dur: 1.6, vol: 0.12, type: "lowpass", freq: 300, freq2: 80, attack: 0.2 });
        break;
      case "death":
        noise({ dur: 0.45, vol: 0.2, type: "lowpass", freq: 900, freq2: 120, attack: 0.02 });
        tone(150, 0.4, "sawtooth", 0.05, 55, 0, 0.02, 500);
        thump(0.3, 0.25, 90, 35);
        break;
    }
  } catch {
    // audio is best effort
  }
}

// ================= ambience: wind, distant rumble and rare far-off sounds =================

let ambNodes: AudioScheduledSourceNode[] = [];
let ambTimer: ReturnType<typeof setTimeout> | null = null;

function startAmbience(): void {
  const a = ac();
  if (!a || !noiseBuf || !ambBus || ambNodes.length > 0) return;
  const t = a.currentTime;
  ambBus.gain.cancelScheduledValues(t);
  ambBus.gain.setValueAtTime(ambBus.gain.value, t);
  ambBus.gain.linearRampToValueAtTime(1, t + 2.5);

  // wind: band-passed noise whose centre and loudness drift with slow LFOs
  const wind = a.createBufferSource();
  wind.buffer = noiseBuf;
  wind.loop = true;
  const bp = a.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 420;
  bp.Q.value = 0.9;
  const wg = a.createGain();
  wg.gain.value = 0.05;
  const lfo = a.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoAmt = a.createGain();
  lfoAmt.gain.value = 220;
  lfo.connect(lfoAmt).connect(bp.frequency);
  const lfo2 = a.createOscillator();
  lfo2.frequency.value = 0.043;
  const lfo2Amt = a.createGain();
  lfo2Amt.gain.value = 0.03;
  lfo2.connect(lfo2Amt).connect(wg.gain);
  wind.connect(bp).connect(wg).connect(ambBus);

  // distant rumble of the ruins
  const rumble = a.createBufferSource();
  rumble.buffer = noiseBuf;
  rumble.loop = true;
  const lp = a.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 110;
  const rg = a.createGain();
  rg.gain.value = 0.09;
  rumble.connect(lp).connect(rg).connect(ambBus);

  for (const n of [wind, lfo, lfo2, rumble]) n.start(t, n === wind ? 0.3 : 0);
  ambNodes = [wind, lfo, lfo2, rumble];
  scheduleDistant();
}

/** Every 7-19 s: a far-off boom or a creak of metal, very quiet. */
function scheduleDistant(): void {
  ambTimer = setTimeout(() => {
    const a = ac();
    if (a && ambBus && ambNodes.length > 0) {
      if (Math.random() < 0.5) {
        noise({ dur: 1.4, vol: 0.05, type: "lowpass", freq: 220, freq2: 60, attack: 0.05, out: ambBus });
      } else {
        const t = a.currentTime;
        const o = a.createOscillator();
        o.type = "sawtooth";
        o.frequency.setValueAtTime(90 + Math.random() * 60, t);
        o.frequency.linearRampToValueAtTime(70 + Math.random() * 90, t + 1.2);
        const bp = a.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 900;
        bp.Q.value = 6;
        const g = a.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.012, t + 0.4);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
        o.connect(bp).connect(g).connect(ambBus);
        o.start(t);
        o.stop(t + 1.4);
      }
    }
    if (ambNodes.length > 0) scheduleDistant();
  }, 7000 + Math.random() * 12000);
}

function stopAmbience(): void {
  if (ambTimer) clearTimeout(ambTimer);
  ambTimer = null;
  const a = ctx;
  const nodes = ambNodes;
  ambNodes = [];
  if (!a || !ambBus) return;
  const t = a.currentTime;
  ambBus.gain.cancelScheduledValues(t);
  ambBus.gain.setValueAtTime(ambBus.gain.value, t);
  ambBus.gain.linearRampToValueAtTime(0, t + 0.8);
  for (const n of nodes) n.stop(t + 0.9);
}

function syncMusic(): void {
  if (prefs.mus && unlocked) startAmbience();
  else stopAmbience();
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
