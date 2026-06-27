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
