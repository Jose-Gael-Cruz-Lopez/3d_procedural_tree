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
  thicknessRate: number = 0.012;
  leafDensity: number = 0.5;
  foliageMode: FoliageMode = 'leaves';
  leafShape: LeafShape = 'oval';   // shape variant for leaf mode
  growthParams: GrowthParams = { ...DEFAULT_GROWTH_PARAMS };
  naturalness: number = 0.5; // 0 = uniform branching, 1 = high variance
  splitLevel: number = 0.65;  // fixed — no longer user-controlled; good natural branching
  maxDepth: number = 6;
  growthMode: GrowthMode = 'grow';
  bloomLevel: number = 0;  // 0–1: controls how many flowers appear at branch extremities
  /** Hard cap on total segments across all branches */
  maxTotalSegments: number = 1600;  // was 1200 — compensates for smaller stepSize
  private nextBranchId: number = 0;
  private leafSpawnAccum: number = 0;
  private trunkOrigin = new THREE.Vector3();
  private trunkNormal = new THREE.Vector3();
  private autoSplitAccum: number = 0;

  /** Current total segment count across all branches */
  get totalSegmentCount(): number {
    let n = 0;
    for (const b of this.branches) n += b.segments.length;
    return n;
  }

  /** 0–1 fill ratio toward the cap */
  get sizeFill(): number {
    return Math.min(1, this.totalSegmentCount / this.maxTotalSegments);
  }

  constructor() {
    this.initTrunk();
  }

  private randomMaxSegs(depth: number): number {
    // Much shorter segments before decision point → earlier splits
    const baseMean = depth === 0 ? 5 : Math.max(2, 4 - depth);
    const stdDev = 0.4 + this.naturalness * 1.2;
    return Math.max(2, Math.round(normalRandom(baseMean, stdDev)));
  }

  private initTrunk() {
    const spawnX = 0;
    const spawnZ = 0;
    const terrainY = terrainNoise(spawnX, spawnZ);
    const normal = terrainNormalAt(spawnX, spawnZ);
    this.trunkOrigin.set(spawnX, terrainY, spawnZ);
    this.trunkNormal.copy(normal);

    const branch: Branch = {
      segments: [{
        position: new THREE.Vector3(spawnX, terrainY, spawnZ),
        radius: 0.09, baseRadius: 0.09, initialRadius: 0.09,
        age: 0, direction: normal.clone(), segIndex: 0,
        branchBaseRadius: 0.09, creationTime: 0,
      }],
      direction: normal.clone(),
      speed: 0.35 + Math.random() * 0.2,
      wobble: 0.15 + Math.random() * 0.15,
      active: true, baseRadius: 0.09, pointsPerRing: 10,
      noiseOffset: new THREE.Vector3(Math.random() * 1000, Math.random() * 1000, Math.random() * 1000),
      growAccum: 0, id: this.nextBranchId++,
      parentBranchId: null, parentSegIdx: 0, spawnType: 'trunk',
      splitSign: 0, twistAngle: 0, spreadRandom: 0,
      depth: 0, maxSegments: this.randomMaxSegs(0),
      kind: 'main',
      presence: 1,
    };
    this.branches.push(branch);
  }

  private noise3(x: number, y: number, z: number): number {
    const a = Math.sin(x * 1.27 + y * 3.43) * 0.5 + 0.5;
    const b = Math.sin(y * 2.17 + z * 1.79) * 0.5 + 0.5;
    const c = Math.sin(z * 3.11 + x * 0.97) * 0.5 + 0.5;
    return (a + b + c) / 3.0 * 2.0 - 1.0;
  }

  private replaySegment(
    prevPos: THREE.Vector3, prevDir: THREE.Vector3,
    seg: Segment, branch: Branch, gp: GrowthParams,
  ) {
    const noiseScale = 0.4;
    const timeScale = 0.3;
    const si = seg.segIndex;
    const nx = this.noise3(branch.noiseOffset.x + si * 0.15, seg.creationTime * timeScale, branch.noiseOffset.z);
    const nz = this.noise3(branch.noiseOffset.y, seg.creationTime * timeScale, branch.noiseOffset.z + si * 0.15);
    const wobbleScale = 0.1 + gp.wobble * 1.4;
    _v1.set(nx * branch.wobble * noiseScale * wobbleScale, 0, nz * branch.wobble * noiseScale * wobbleScale);
    seg.direction.copy(prevDir).add(_v1);
    // INVERTED: high gravity = drooping, low gravity = upright
    const minY = 0.80 - gp.gravity * 0.75;
    seg.direction.y = Math.max(seg.direction.y, minY);
    seg.direction.normalize();
    seg.position.copy(prevPos).addScaledVector(seg.direction, gp.stepSize);
  }

  private computeChildRoot(branch: Branch, branchMap: Map<number, Branch>, gp: GrowthParams) {
    const parent = branchMap.get(branch.parentBranchId!);
    if (!parent) return;                          // parent not in map yet — skip safely
    const parentSeg = parent.segments[branch.parentSegIdx];
    if (!parentSeg) return;
