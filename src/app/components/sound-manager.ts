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
