// ── Procedural musical sound manager (Web Audio API) ─────────────────────────
// All continuous ticks use real pentatonic scale notes so they always
// sound harmonious regardless of timing.
let _ctx: AudioContext | null = null;

// Global floor: no two tick calls closer than MIN_TICK_MS ms
const MIN_TICK_MS = 140;
let _lastTickAt = 0;
function canTick(): boolean {
  const now = Date.now();
  if (now - _lastTickAt < MIN_TICK_MS) return false;
  _lastTickAt = now;
  return true;
}

function ctx(): AudioContext {
  if (!_ctx) _ctx = new AudioContext();
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

// ── C major pentatonic: C D E G A across 3 octaves ───────────────────────────
const PENTA = [
  130.81, 146.83, 164.81, 196.00, 220.00,   // oct 3
  261.63, 293.66, 329.63, 392.00, 440.00,   // oct 4
  523.25, 587.33, 659.25, 784.00, 880.00,   // oct 5
];

// Note pools per mode (indices into PENTA)
const POOL = {
  grow:    [7, 8, 9, 10, 11, 12],   // E4–E5  — bright, ascending
  shrink:  [4, 5, 6,  7,  8,  9],   // A3–A4  — softer, mid
  wobble:  [8, 9, 10, 11],          // G4–D5  — airy, swaying
  gravity: [2, 3, 4,  5,  6,  7],   // E3–E4  — low, weighted
  bloom:   [10, 11, 12, 13, 14],    // C5–A5  — crystalline, high
};

function pick(pool: number[]): number {
  return PENTA[pool[Math.floor(Math.random() * pool.length)]];
}

// ── Core voices ──────────────────────────────────────────────────────────────

// Marimba-style pluck: snappy 4 ms attack, exponential decay, high-partial for warmth
function pluck(hz: number, dur: number, vol: number, partialRatio = 3.91) {
  try {
    const c   = ctx();
    const now = c.currentTime;
    const atk = 0.004;

    // Fundamental
    const o1 = c.createOscillator(), g1 = c.createGain();
    o1.type = 'sine'; o1.frequency.value = hz;
    o1.connect(g1); g1.connect(c.destination);
    g1.gain.setValueAtTime(0.0001, now);
    g1.gain.linearRampToValueAtTime(vol, now + atk);
    g1.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o1.start(now); o1.stop(now + dur + 0.01);

    // Inharmonic partial — decays 3× faster, adds attack transient
    const o2 = c.createOscillator(), g2 = c.createGain();
    o2.type = 'sine'; o2.frequency.value = hz * partialRatio;
    o2.connect(g2); g2.connect(c.destination);
    g2.gain.setValueAtTime(0.0001, now);
    g2.gain.linearRampToValueAtTime(vol * 0.22, now + atk);
    g2.gain.exponentialRampToValueAtTime(0.0001, now + dur * 0.28);
    o2.start(now); o2.stop(now + dur * 0.28 + 0.01);
  } catch (_) {}
}

// Bell voice: very fast attack, long shimmer, true bell partial at 2.756×
function chime(hz: number, dur: number, vol: number) {
  try {
    const c   = ctx();
    const now = c.currentTime;
    const atk = 0.003;

    // Fundamental
    const o1 = c.createOscillator(), g1 = c.createGain();
    o1.type = 'sine'; o1.frequency.value = hz;
    o1.connect(g1); g1.connect(c.destination);
    g1.gain.setValueAtTime(0.0001, now);
    g1.gain.linearRampToValueAtTime(vol, now + atk);
    g1.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o1.start(now); o1.stop(now + dur + 0.01);

    // Tierce partial (2.756×) — the signature bell colour
    const o2 = c.createOscillator(), g2 = c.createGain();
    o2.type = 'sine'; o2.frequency.value = hz * 2.756;
    o2.connect(g2); g2.connect(c.destination);
    g2.gain.setValueAtTime(0.0001, now);
    g2.gain.linearRampToValueAtTime(vol * 0.38, now + atk);
    g2.gain.exponentialRampToValueAtTime(0.0001, now + dur * 0.55);
    o2.start(now); o2.stop(now + dur * 0.55 + 0.01);
  } catch (_) {}
}

// Simple sweep (for transition sounds)
function sweep(fromHz: number, toHz: number, dur: number, type: OscillatorType = 'sine', vol = 0.055) {
  try {
    const c = ctx();
    const osc = c.createOscillator(), gain = c.createGain();
    osc.connect(gain); gain.connect(c.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(fromHz, c.currentTime);
    osc.frequency.linearRampToValueAtTime(toHz, c.currentTime + dur);
    gain.gain.setValueAtTime(vol, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    osc.start(c.currentTime); osc.stop(c.currentTime + dur + 0.02);
  } catch (_) {}
}

function tone(hz: number, dur: number, type: OscillatorType = 'sine', vol = 0.05) {
  sweep(hz, hz, dur, type, vol);
}

function jitter(v: number, range: number) {
  return v + (Math.random() * 2 - 1) * range;
}

// ── Autoplay unlock ────────────────────────────────────────────────────────────
// Browsers create the AudioContext suspended until a user gesture. With the UI
// removed and the tree auto-growing, nothing else triggers a gesture — so we
// resume (and prime) the context on the first interaction anywhere on the page.
// After that, the procedural grow/bloom ticks become audible.
function unlock() {
  try {
    const c = ctx();                 // creates the context and calls resume()
    // Prime with a near-silent one-sample buffer so iOS/Safari fully opens
    // the audio output path on the gesture.
    const src = c.createBufferSource();
    src.buffer = c.createBuffer(1, 1, 22050);
    src.connect(c.destination);
    src.start(0);
  } catch (_) {}
}

if (typeof window !== 'undefined') {
  const gestureEvents = ['pointerdown', 'keydown', 'touchstart'] as const;
  const onFirstGesture = () => {
    unlock();
    gestureEvents.forEach(e => window.removeEventListener(e, onFirstGesture));
  };
  gestureEvents.forEach(e =>
    window.addEventListener(e, onFirstGesture, { passive: true }),
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

export const SFX = {
  // Resume/prime the AudioContext (auto-called on first user gesture).
  unlock,

  // ── One-shot transition sounds ───────────────────────────────────────────
  grow()   { sweep(jitter(220, 20), jitter(440, 30), 0.16, 'sine', 0.045); },
  shrink() { sweep(jitter(330, 20), jitter(165, 20), 0.14, 'sine', 0.038); },
  bloom()  {
    // Rising chord: C5 → E5 → G5 (C major)
    chime(523.25, 0.55, 0.045);
    setTimeout(() => chime(659.25, 0.50, 0.032), 60);
    setTimeout(() => chime(784.00, 0.45, 0.024), 120);
  },
  sway()   { sweep(jitter(196, 15), jitter(262, 15), 0.22, 'sine', 0.03); },
  droop()  { sweep(jitter(330, 20), jitter(220, 20), 0.18, 'sine', 0.03); },
  paramUp()   { chime(523.25, 0.18, 0.028); },
  paramDown() { chime(392.00, 0.18, 0.028); },
  modeSwitch() { chime(528, 0.12, 0.022); },
  selectTree() {
    chime(440.00, 0.18, 0.032);
    setTimeout(() => chime(587.33, 0.16, 0.022), 70);
  },
  restart() {
    sweep(440, 220, 0.15, 'sine', 0.04);
    setTimeout(() => tone(330, 0.18, 'sine', 0.025), 120);
  },

  // ── Continuous tick sounds ───────────────────────────────────────────────

  // Grow: bright marimba pluck on E4–E5 notes.
  // At 80 ms intervals the overlap gives a gentle roll feel.
  growTick()   {
    if (!canTick()) return;
    pluck(pick(POOL.grow), 0.14, 0.032, 3.91);
  },

  // Shrink: softer marimba on A3–A4, slightly darker timbre
  shrinkTick() {
    if (!canTick()) return;
    pluck(pick(POOL.shrink), 0.13, 0.026, 3.91);
  },

  // Wobble/Sway: airy pluck in mid range, lighter partial
  // Bloom: overlapping chimes on high pentatonic — shimmer at 160 ms gap
  paramTick(mode: string) {
    if (!canTick()) return;
    switch (mode) {
      case 'wobble':
        pluck(pick(POOL.wobble), 0.15, 0.024, 2.0);
        break;
      case 'gravity':
        pluck(pick(POOL.gravity), 0.17, 0.026, 3.0);
        break;
      case 'bloom':
        // Bell tones — long enough that they overlap at 160 ms cooldown
        chime(pick(POOL.bloom), 0.38, 0.020);
        break;
      default:
        pluck(pick(POOL.grow), 0.14, 0.024, 3.91);
    }
  },

  paramDownTick(mode: string) {
    if (!canTick()) return;
    switch (mode) {
      case 'wobble':
        // Step one note down in the wobble pool for descending feel
        pluck(PENTA[POOL.wobble[0] + Math.floor(Math.random() * 2)], 0.15, 0.022, 2.0);
        break;
      case 'gravity':
        pluck(PENTA[POOL.gravity[0] + Math.floor(Math.random() * 3)], 0.17, 0.024, 3.0);
        break;
      case 'bloom':
        // Descend: pick from lower half of bloom pool
        chime(PENTA[POOL.bloom[0] + Math.floor(Math.random() * 3)], 0.38, 0.018);
        break;
      default:
        pluck(pick(POOL.shrink), 0.14, 0.022, 3.91);
    }
  },
};