import * as THREE from 'three';

// Shared terrain noise function — used by both engine and scene
export function terrainNoise(x: number, z: number): number {
  const n1 = Math.sin(x * 0.25 + 1.7) * Math.cos(z * 0.3 + 0.3) * 0.6;
  const n2 = Math.sin(x * 0.6 + z * 0.4) * Math.cos(z * 0.8 - x * 0.25) * 0.3;
  const n3 = Math.sin(x * 1.3 + 2.1) * Math.cos(z * 1.1 + 1.1) * 0.15;
  const n4 = Math.sin(x * 2.5 + z * 1.8) * 0.06;
  // Gaussian hill at the origin — tree sits at its peak, terrain slopes down around it
  const hill = Math.exp(-(x * x + z * z) / 9) * 1.1;
  return n1 + n2 + n3 + n4 + hill;
}

export function terrainNormalAt(x: number, z: number): THREE.Vector3 {
  const eps = 0.05;
  const hL = terrainNoise(x - eps, z);
  const hR = terrainNoise(x + eps, z);
  const hD = terrainNoise(x, z - eps);
  const hU = terrainNoise(x, z + eps);
  const normal = new THREE.Vector3(
    (hL - hR) / (2 * eps),
    1,
    (hD - hU) / (2 * eps)
  );
  return normal.normalize();
}

export interface Segment {
  position: THREE.Vector3;
  radius: number;
  baseRadius: number;
  initialRadius: number;
  age: number;
  direction: THREE.Vector3;
  segIndex: number;
  branchBaseRadius: number;
  creationTime: number;
}

export interface Branch {
  segments: Segment[];
  direction: THREE.Vector3;
  speed: number;
  wobble: number;
  active: boolean;
  baseRadius: number;
  pointsPerRing: number;
  noiseOffset: THREE.Vector3;
  growAccum: number;
  id: number;
  parentBranchId: number | null;
  parentSegIdx: number;
  spawnType: 'trunk' | 'split' | 'lateral';
  splitSign: number;
  twistAngle: number;
  spreadRandom: number;
  depth: number;
  maxSegments: number;
  kind: 'main';
  /** 0–1 smooth visibility driven by splitLevel retroactively */
  presence: number;
}

export type FoliageMode = 'leaves' | 'flowers' | 'fruits';

export type LeafShape = 'oval' | 'needle' | 'palmate' | 'round' | 'elongated';

export type GrowthMode = 'grow' | 'wobble' | 'gravity' | 'angle' | 'bloom';

export interface GrowthParams {
  wobble: number;
  gravity: number;
  branchAngle: number;
  taper: number;
  stepSize: number;
}

export const DEFAULT_GROWTH_PARAMS: GrowthParams = {
  wobble: 0.5,
  gravity: 0.5,
  branchAngle: 0.5,
  taper: 0.5,
  stepSize: 0.09,   // was 0.12 — shorter steps → denser, better-defined branches
};

// Box-Muller normal distribution
function normalRandom(mean: number, stdDev: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-10))) * Math.cos(2 * Math.PI * u2);
  return mean + z * stdDev;
}

// Reusable vectors
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

export class TreeEngine {
  branches: Branch[] = [];
  leaves: Leaf[] = [];
  time: number = 0;
