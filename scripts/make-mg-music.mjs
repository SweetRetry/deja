// Synthesizes the score for promo/mg.html into a WAV, so the music is as
// reproducible as the picture and owes nobody a license.
//
//   node scripts/make-mg-music.mjs   # writes .cache/mg-music.wav
//
// Every hit sits on a cue from the film's timeline; the CUES table below is
// copied from the times in promo/mg.html and must move with them.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const OUT = resolve(process.env.MG_MUSIC_OUT ?? ".cache/mg-music.wav");
const SR = 48000;
const LENGTH = 32.5;
const N = Math.ceil(LENGTH * SR);

const CUES = {
  flashes: [0, 0.3, 0.56, 0.78, 0.97, 1.13, 1.27, 1.39, 1.5, 1.6, 1.7, 1.8],
  cutToText: 2.55,
  hashSettled: 3.35,
  wipes: [4.54, 10.86],
  treeLines: [6.3, 6.46, 6.62, 6.78, 6.94],
  pops: [8.4, 8.78, 9.16],
  title: 11.05,
  rainKeys: [13.7, 13.81, 13.92, 14.03, 14.14],
  car: 14.6,
  flowerKeys: [16.1, 16.21, 16.32, 16.43],
  found: 16.75,
  row: 17.75,
  flips: [20.4, 25.1],
  frontmatter: [21.2, 21.34, 21.48, 21.62, 21.76, 21.9, 22.04],
  moveKeys: [23.95, 24.07],
  accent: 27.66, // where the snap ease lands the drop that starts at 27.45
  wordmark: 29.0,
};

// ---------- buffers ----------

const dry = [new Float32Array(N), new Float32Array(N)];
const wet = [new Float32Array(N), new Float32Array(N)];

let seed = 4821;
const random = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const noise = () => random() * 2 - 1;
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

/** Adds `fn(t)` (seconds since `at`) for `seconds`, panned, with a reverb send. */
function voice(at, seconds, fn, { gain = 1, pan = 0, send = 0 } = {}) {
  const start = Math.max(0, Math.round(at * SR));
  const end = Math.min(N, Math.round((at + seconds) * SR));
  const left = gain * Math.cos(((pan + 1) * Math.PI) / 4);
  const right = gain * Math.sin(((pan + 1) * Math.PI) / 4);
  for (let i = start; i < end; i += 1) {
    const s = fn((i - start) / SR);
    dry[0][i] += s * left;
    dry[1][i] += s * right;
    if (send) {
      wet[0][i] += s * left * send;
      wet[1][i] += s * right * send;
    }
  }
}

/** Chamberlin state-variable filter; returns a stepping function. */
function svf(q = 0.7) {
  let low = 0;
  let band = 0;
  return (input, cutoff) => {
    const f = 2 * Math.sin((Math.PI * Math.min(cutoff, SR / 6)) / SR);
    low += f * band;
    const high = input - low - q * band;
    band += f * high;
    return { low, band, high };
  };
}
const saw = (phase) => 2 * (phase - Math.floor(phase + 0.5));

// ---------- instruments ----------

function kick(at, gain = 1) {
  let phase = 0;
  voice(at, 0.5, (t) => {
    phase += (45 + 110 * Math.exp(-t * 38)) / SR;
    return Math.sin(2 * Math.PI * phase) * Math.exp(-t * 7) + noise() * 0.12 * Math.exp(-t * 300);
  }, { gain: 0.9 * gain });
}

function hat(at, gain = 1, open = false) {
  const filter = svf(0.4);
  voice(at, open ? 0.25 : 0.06, (t) => filter(noise(), 9000).high * Math.exp(-t * (open ? 14 : 70)), { gain: 0.16 * gain, pan: 0.25, send: 0.05 });
}

function clap(at, gain = 1) {
  const filter = svf(0.6);
  voice(at, 0.3, (t) => {
    const bursts = t < 0.03 ? (Math.floor(t / 0.01) % 2 ? 0.6 : 1) : 1;
    return filter(noise(), 1800).band * bursts * Math.exp(-t * 18);
  }, { gain: 0.45 * gain, send: 0.25 });
}

function bass(at, midi, seconds, gain = 1) {
  const filter = svf(0.5);
  let phase = 0;
  voice(at, seconds, (t) => {
    phase += hz(midi) / SR;
    const raw = saw(phase) * 0.7 + Math.sign(Math.sin(2 * Math.PI * phase)) * 0.3;
    const env = Math.min(1, t / 0.005) * Math.exp(-t * 3) * Math.min(1, (seconds - t) / 0.02);
    return filter(raw, 180 + 900 * Math.exp(-t * 12)).low * env;
  }, { gain: 0.42 * gain });
}

function pad(at, notes, seconds, { gain = 1, attack = 0.4, release = 0.8, bright = 1400 } = {}) {
  notes.forEach((midi, n) => {
    for (const detune of [-0.11, 0.11]) {
      const filter = svf(0.6);
      let phase = random();
      voice(at, seconds + release, (t) => {
        phase += hz(midi + detune) / SR;
        const env = Math.min(1, t / attack) * (t > seconds ? Math.max(0, 1 - (t - seconds) / release) : 1);
        return filter(saw(phase), bright).low * env;
      }, { gain: (0.06 * gain) / Math.sqrt(notes.length), pan: detune > 0 ? 0.5 - n * 0.1 : -0.5 + n * 0.1, send: 0.35 });
    }
  });
}

/** Karplus-Strong: a plucked string. */
function pluck(at, midi, gain = 1, pan = 0) {
  const period = Math.round(SR / hz(midi));
  const ring = Float32Array.from({ length: period }, noise);
  let index = 0;
  voice(at, 1.6, () => {
    const next = (index + 1) % period;
    const s = ring[index];
    ring[index] = 0.996 * 0.5 * (ring[index] + ring[next]);
    index = next;
    return s;
  }, { gain: 0.3 * gain, pan, send: 0.3 });
}

function bell(at, midi, gain = 1, pan = 0) {
  const f = hz(midi);
  voice(at, 2.5, (t) =>
    Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 2.2) +
    0.45 * Math.sin(2 * Math.PI * f * 2.76 * t) * Math.exp(-t * 4.5) +
    0.2 * Math.sin(2 * Math.PI * f * 5.4 * t) * Math.exp(-t * 9),
  { gain: 0.16 * gain, pan, send: 0.5 });
}

/** A key or a tick: a short bright click. */
function tick(at, gain = 1, pitch = 3500) {
  const filter = svf(0.3);
  voice(at, 0.03, (t) => filter(noise(), pitch).band * Math.exp(-t * 220), { gain: 0.35 * gain, pan: (random() - 0.5) * 0.4, send: 0.08 });
}

/** Filtered noise sweeping up into `at + seconds`, cut dead at the end. */
function riser(at, seconds, gain = 1) {
  const filter = svf(0.25);
  voice(at, seconds, (t) => {
    const k = t / seconds;
    return filter(noise(), 300 + 7000 * k * k).band * k * k;
  }, { gain: 0.5 * gain, send: 0.2 });
}

/** Air past the ear, centered on `at`. */
function whoosh(at, seconds = 0.5, gain = 1) {
  const filter = svf(0.35);
  voice(at - seconds / 2, seconds, (t) => {
    const k = t / seconds;
    return filter(noise(), 400 + 5000 * Math.sin(Math.PI * k)).band * Math.sin(Math.PI * k) ** 2;
  }, { gain: 0.55 * gain, send: 0.15 });
}

function impact(at, gain = 1) {
  let phase = 0;
  voice(at, 2.5, (t) => {
    phase += (34 + 40 * Math.exp(-t * 6)) / SR;
    return Math.sin(2 * Math.PI * phase) * Math.exp(-t * 1.6);
  }, { gain: 0.8 * gain });
  const filter = svf(0.5);
  voice(at, 1.2, (t) => filter(noise(), 2500).low * Math.exp(-t * 6), { gain: 0.5 * gain, send: 0.6 });
  hat(at, 1.4 * gain, true);
}

// ---------- the score ----------

const CHORDS = [
  { pad: [50, 53, 57, 62], root: 38 }, // Dm
  { pad: [50, 53, 58, 62], root: 34 }, // Bb
  { pad: [48, 53, 57, 60], root: 41 }, // F
  { pad: [48, 52, 55, 60], root: 36 }, // C
];
const BEAT = 0.5;

/** Four-on-the-floor from `from` to `to`, a chord a bar. */
function groove(from, to, { kicks = true, half = false, claps = true, energy = 1 } = {}) {
  for (let beat = 0; from + beat * BEAT < to - 0.01; beat += 1) {
    const at = from + beat * BEAT;
    const chord = CHORDS[Math.floor(beat / 4) % CHORDS.length];
    if (kicks && (!half || beat % 2 === 0)) kick(at, energy);
    if (claps && beat % 4 === 2) clap(at, 0.8 * energy);
    hat(at + BEAT / 2, energy);
    if (beat % 4 === 0) pad(at, chord.pad, Math.min(4 * BEAT, to - at), { gain: energy });
    for (const eighth of [0, 1]) {
      const t = at + (eighth * BEAT) / 2;
      if (t < to) bass(t, chord.root + (eighth && beat % 2 ? 12 : 0), BEAT / 2 - 0.01, 0.9 * energy);
    }
  }
}

// 1. Flashes: a hit per cut, the pitch climbing with the pace.
riser(0, CUES.cutToText, 0.8);
CUES.flashes.forEach((at, i) => {
  kick(at, 0.35 + i * 0.04);
  tick(at, 0.8, 2000 + i * 400);
});
impact(CUES.cutToText, 1);
for (let t = CUES.cutToText + 0.05; t < CUES.hashSettled; t += 1 / 30) tick(t, 0.25, 4000 + random() * 3000);
bell(CUES.hashSettled, 81, 0.9);
pad(CUES.cutToText, [38, 50, 57], CUES.wipes[0] - CUES.cutToText, { gain: 0.9, attack: 1.2, bright: 700 });
riser(3.4, CUES.wipes[0] - 3.4, 1);

// 2. The vault: the groove arrives with the wall.
whoosh(CUES.wipes[0] - 0.1, 0.45);
impact(CUES.wipes[0], 0.8);
groove(CUES.wipes[0], 10.55);
CUES.treeLines.forEach((at) => tick(at, 0.5, 3000));
CUES.pops.forEach((at, i) => pluck(at, [74, 77, 81][i], 1.2, [-0.3, 0, 0.3][i]));
riser(9.6, CUES.wipes[1] - 9.6, 0.7);

// 3. The model: a breath for the name, keys for the queries, the groove back on the car.
whoosh(CUES.wipes[1] - 0.1, 0.45);
impact(CUES.wipes[1], 0.9);
pad(CUES.wipes[1], [50, 57, 62, 65], 13.4 - CUES.wipes[1], { gain: 1.2, attack: 0.6, bright: 2200 });
for (let t = CUES.title, k = 0; t < 13.4; t += BEAT / 4, k += 1) pluck(t, [62, 65, 69, 74][k % 4] + 12, 0.35, (k % 2) - 0.5);
for (let t = 12.3; t < 13.3; t += 0.06) tick(t, 0.15, 5000 + random() * 2000);
groove(13.6, CUES.car, { kicks: false, claps: false, energy: 0.6 });
CUES.rainKeys.forEach((at) => tick(at, 0.9));
impact(CUES.car, 0.9);
groove(CUES.car, 19.4);
CUES.flowerKeys.forEach((at) => tick(at, 0.9));
bell(CUES.found, 86, 1.1);
bell(CUES.found + 0.12, 81, 0.6, 0.4);
whoosh(CUES.row + 0.3, 0.7, 0.7);

// 4. The Markdown: half-time, quieter, the paper turning over.
groove(19.4, 25.9, { half: true, claps: false, energy: 0.65 });
CUES.flips.forEach((at) => whoosh(at + 0.45, 0.9, 0.8));
CUES.frontmatter.forEach((at) => tick(at, 0.45, 2800));
for (let t = 23.5; t < 23.95; t += 0.05) tick(t, 0.3, 1800);
CUES.moveKeys.forEach((at) => tick(at, 0.9));
bell(CUES.moveKeys[1] + 0.12, 79, 0.6);

// 5. The icon: everything pulled in, the accent lands, the chord resolves.
riser(25.9, CUES.accent - 25.9, 1.2);
whoosh(26.6, 1.2, 0.8);
impact(CUES.accent, 1.2);
pad(CUES.accent, [53, 57, 60, 65, 69], LENGTH - CUES.accent - 1.2, { gain: 1.4, attack: 0.05, release: 1.2, bright: 2600 });
bass(CUES.accent, 29, 3.5, 1.2);
[65, 69, 72, 77].forEach((midi, i) => pluck(CUES.wordmark + i * 0.09, midi, 0.8, i * 0.2 - 0.3));
bell(CUES.wordmark + 0.4, 84, 0.7);

// ---------- reverb, master, file ----------

/** Schroeder: four combs into two allpasses, a different spread per side. */
function reverb(input, spread) {
  const out = new Float32Array(N);
  for (const [ms, feedback] of [[29.7, 0.82], [37.1, 0.8], [41.1, 0.78], [43.7, 0.76]]) {
    const size = Math.round(((ms + spread) * SR) / 1000);
    const line = new Float32Array(size);
    let damp = 0;
    for (let i = 0; i < N; i += 1) {
      const k = i % size;
      const y = line[k];
      damp = y * 0.6 + damp * 0.4;
      line[k] = input[i] + damp * feedback;
      out[i] += y * 0.25;
    }
  }
  for (const ms of [5, 1.7]) {
    const size = Math.round(((ms + spread / 10) * SR) / 1000);
    const line = new Float32Array(size);
    for (let i = 0; i < N; i += 1) {
      const k = i % size;
      const delayed = line[k];
      const v = out[i] + delayed * 0.5;
      line[k] = v;
      out[i] = delayed - v * 0.5;
    }
  }
  return out;
}
const tails = [reverb(wet[0], 0), reverb(wet[1], 2.3)];

const mix = [new Float32Array(N), new Float32Array(N)];
let peak = 0;
for (let c = 0; c < 2; c += 1) {
  for (let i = 0; i < N; i += 1) {
    const t = i / SR;
    const fade = Math.min(1, t / 0.01, (LENGTH - t) / 1.0);
    mix[c][i] = Math.tanh(1.3 * (dry[c][i] + tails[c][i] * 0.7)) * fade;
    peak = Math.max(peak, Math.abs(mix[c][i]));
  }
}
const scale = 0.89 / peak; // -1 dBFS

const data = Buffer.alloc(N * 4);
for (let i = 0; i < N; i += 1) {
  data.writeInt16LE(Math.round(mix[0][i] * scale * 32767), i * 4);
  data.writeInt16LE(Math.round(mix[1][i] * scale * 32767), i * 4 + 2);
}
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + data.length, 4);
header.write("WAVEfmt ", 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(2, 22);
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 4, 28);
header.writeUInt16LE(4, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(data.length, 40);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, Buffer.concat([header, data]));
console.log(`${OUT} · ${LENGTH}s · peak scaled from ${peak.toFixed(2)}`);
