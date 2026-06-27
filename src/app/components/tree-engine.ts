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
    const parentDir = parentSeg.direction;
    const parentPos = parentSeg.position;
    const parentRadius = parentSeg.baseRadius;
    const arbitrary = Math.abs(parentDir.y) > 0.9 ? _v1.set(1, 0, 0) : _v1.set(0, 1, 0);
    const axis = _v2.crossVectors(parentDir, arbitrary).normalize();
    axis.applyAxisAngle(parentDir, branch.twistAngle);
    const rootSeg = branch.segments[0];

    if (branch.spawnType === 'split') {
      const baseSpread = 0.15 + gp.branchAngle * 0.7;
      const spreadAngle = baseSpread + branch.spreadRandom;
      rootSeg.direction.copy(parentDir).applyAxisAngle(axis, branch.splitSign * spreadAngle);
      // INVERTED gravity
      rootSeg.direction.y = Math.max(rootSeg.direction.y, 0.50 - gp.gravity * 0.45);
      rootSeg.direction.normalize();
      const childRadius = parentRadius * 0.55;
      _v3.copy(axis).multiplyScalar(branch.splitSign * (parentRadius - childRadius) * 0.8);
      rootSeg.position.copy(parentPos).add(_v3);
    } else {
      const lateralAngle = 0.5 + gp.branchAngle * 0.8 + branch.spreadRandom;
      rootSeg.direction.copy(parentDir).applyAxisAngle(axis, lateralAngle);
      // INVERTED gravity
      rootSeg.direction.y = Math.max(rootSeg.direction.y, 0.35 - gp.gravity * 0.35);
      rootSeg.direction.normalize();
      _v3.copy(axis).multiplyScalar(parentRadius);
      rootSeg.position.copy(parentPos).add(_v3);
    }
    branch.direction.copy(rootSeg.direction);
  }

  private recalculateAll(rate: number) {
    const gp = this.growthParams;
    // Increased multipliers: more aggressive taper from base to tips
    const taperHeight = 0.04 + gp.taper * 0.10;  // was 0.01 + 0.06
    const taperSeg    = 0.005 + gp.taper * 0.014; // was 0.001 + 0.005

    // Only update radii — no retroactive position replay
    for (const branch of this.branches) {
      for (const seg of branch.segments) {
        const ht = Math.max(0.015, 1.0 - seg.position.y * taperHeight); // floor was 0.08
        const st = Math.max(0.015, 1.0 - seg.segIndex * taperSeg);      // floor was 0.08
        seg.initialRadius = seg.branchBaseRadius * ht * st;
        const fillT = 1 - Math.exp(-seg.age * 0.8);
        const filled = seg.initialRadius * (0.3 + 0.7 * fillT);
        const logSpeed = 3.0;
        const continuousGrowth = rate * Math.log(1 + seg.age * logSpeed);
        // Taper the growth contribution too: base thickens, tips stay thin
        const taperFactor = Math.max(0.04, ht * st);
        const taperedGrowth = continuousGrowth * taperFactor;
        seg.baseRadius = seg.initialRadius + taperedGrowth;
        seg.radius     = filled           + taperedGrowth;
      }
    }
  }

  private syncLeafPositions() {
    const branchMap = new Map<number, Branch>();
    for (const b of this.branches) branchMap.set(b.id, b);
    for (const leaf of this.leaves) {
      const branch = branchMap.get(leaf.branchId);
      if (!branch) continue;
      const seg = branch.segments[leaf.segIdx];
      if (seg) leaf.position.copy(seg.position);
    }
  }

  /** Auto-branching: check if active branches have reached their segment limit */
  private autoSplit() {
    // At the cap: just extend existing budgets — no new branches
    if (this.totalSegmentCount >= this.maxTotalSegments) {
      for (const branch of this.branches) {
        if (!branch.active) continue;
        if (branch.segments.length < branch.maxSegments) continue;
        if (branch.depth >= this.maxDepth) { branch.active = false; continue; }
        branch.maxSegments += this.randomMaxSegs(branch.depth);
      }
      return;
    }

    const toSplit: Branch[] = [];
    const toLateral: Branch[] = [];

    for (const branch of this.branches) {
      if (!branch.active) continue;
      if (branch.segments.length < branch.maxSegments) continue;
      if (branch.depth >= this.maxDepth) {
        branch.active = false;
        continue;
      }

      // effectiveSplit: how often ANYTHING happens (lateral or split)
      // High floor so branches always branch quickly regardless of splitLevel
      const effectiveSplit = 0.65 + this.splitLevel * 0.30; // 65–95%
      if (Math.random() > effectiveSplit) {
        // Extend but only briefly — 2–3 extra segs max
        branch.maxSegments += Math.max(2, Math.round(this.randomMaxSegs(branch.depth) * 0.5));
        continue;
      }

      // splitProb: low splitLevel → laterals; high → Y-forks
      const splitProb = Math.pow(this.splitLevel, 1.5);
      if (Math.random() < splitProb) {
        toSplit.push(branch);
      } else {
        toLateral.push(branch);
      }
    }

    for (const branch of toSplit) this.splitBranch(branch);
    for (const branch of toLateral) this.lateralFromBranch(branch);
  }

  /**
   * update() — mode-based growth:
   *  - grow: elongate segments, autoSplit fires using current splitLevel
   *  - wobble/split/bloom: parameter adjustments done externally; only time advances
   *  Always: thicken, recalculate radii, sync leaves
   */
  update(dt: number, thicknessRate: number, breathEnergy: number = 0) {
    const mode = this.growthMode;
    const rate = thicknessRate;

    this.time += dt;
    // No passive aging — seg.age is controlled exclusively by grow/shrink.
    // This lets it return cleanly to 0 (small initial radius) on full de-grow.

    if (breathEnergy > 0) {
      switch (mode) {
        case 'grow':
          this.applyGrowth(breathEnergy);
          break;
        case 'bloom':
          this.applyBloomGrowth(breathEnergy);
          break;
      }
    }

    const lerpFactor = 1 - Math.exp(-dt * 45);
    this.retroactiveReplay(lerpFactor);

    this.recalculateAll(rate);
    this.syncLeafPositions();

    // Per-frame orphaned leaf purge — catches any leaf whose branch was removed
    // between shrink() calls and this update tick.
    {
      const liveIds = new Set(this.branches.map(b => b.id));
      this.leaves = this.leaves.filter(l => liveIds.has(l.branchId));
    }

    this.updateLeaves(dt);
  }

  /** GROW: grow main branches with curvature + natural thickness increase */
  private applyGrowth(energy: number) {
    // Grow segments (elongation) — respect size cap
    for (const branch of this.branches) {
      if (!branch.active || branch.kind !== 'main') continue;
      branch.growAccum += energy * branch.speed;
      const growInterval = 0.25;
      while (branch.growAccum >= growInterval) {
        if (this.totalSegmentCount >= this.maxTotalSegments) {
          branch.growAccum = 0; // drain pending accumulation
          break;
        }
        branch.growAccum -= growInterval;
        this.growBranch(branch);
      }
    }
    this.autoSplit();

    // Gentle thickening via age only — branchBaseRadius stays fixed at birth value
    // so at age=0 the radius is always branchBaseRadius*taper*0.3 (small initial).
    for (const branch of this.branches) {
      for (const seg of branch.segments) {
        seg.age += energy * 0.18;
      }
    }
  }

  /** BLOOM: spawn lots of bloom branches at tips, much more exaggerated */
  private bloomGrowAccum: number = 0;

  private applyBloomGrowth(energy: number) {
    // Bloom mode: accumulate bloom level — controls flower count/extension at tips
    this.bloomLevel = Math.min(1, this.bloomLevel + energy * 0.06);
  }

  /** Adjust bloomLevel directly (used by hand tracking and bloom button) */
  adjustBloom(delta: number) {
    this.bloomLevel = Math.max(0, Math.min(1, this.bloomLevel + delta));
  }

  /** Adjust wobble curvature */
  adjustWobble(delta: number) {
    this.growthParams.wobble = Math.max(0, Math.min(1, this.growthParams.wobble + delta));
  }

  /** Adjust gravity (branch verticality) — retroactive via retroactiveReplay */
  adjustGravity(delta: number) {
    this.growthParams.gravity = Math.max(0, Math.min(1, this.growthParams.gravity + delta));
  }

  /** Adjust branch spread angle — retroactive via computeChildRoot in replay */
  adjustAngle(delta: number) {
    this.growthParams.branchAngle = Math.max(0, Math.min(1, this.growthParams.branchAngle + delta));
  }

  /** Adjust split level threshold directly */
  adjustSplitLevel(delta: number) {
    this.splitLevel = Math.max(0, Math.min(1, this.splitLevel + delta));
  }

  private growBranch(branch: Branch) {
    const lastSeg = branch.segments[branch.segments.length - 1];
    const gp = this.growthParams;
    const segIdx = branch.segments.length;
    const noiseScale = 0.4;
    const timeScale = 0.3;
    const nx = this.noise3(branch.noiseOffset.x + segIdx * 0.15, this.time * timeScale, branch.noiseOffset.z);
    const nz = this.noise3(branch.noiseOffset.y, this.time * timeScale, branch.noiseOffset.z + segIdx * 0.15);
    const wobbleScale = 0.1 + gp.wobble * 3.5;
    const wander = new THREE.Vector3(nx * branch.wobble * noiseScale * wobbleScale, 0, nz * branch.wobble * noiseScale * wobbleScale);
    const newDir = lastSeg.direction.clone().add(wander);
    // INVERTED: high gravity = drooping, low gravity = upright
    const gravityMinY = 0.95 - gp.gravity * 1.05;
    newDir.y = Math.max(newDir.y, gravityMinY);
    newDir.normalize();
    branch.direction.copy(newDir);
    const newPos = lastSeg.position.clone().addScaledVector(newDir, gp.stepSize);
    const taperHeight  = 0.04 + gp.taper * 0.10;  // kept in sync with recalculateAll
    const taperSeg     = 0.005 + gp.taper * 0.014;
    const heightTaper  = Math.max(0.015, 1.0 - newPos.y * taperHeight);
    const segTaper     = Math.max(0.015, 1.0 - segIdx * taperSeg);
    const newBaseRadius = branch.baseRadius * heightTaper * segTaper;
    branch.segments.push({
      position: newPos, radius: newBaseRadius * 0.3,
      baseRadius: newBaseRadius, initialRadius: newBaseRadius,
      age: 0, direction: newDir.clone(), segIndex: segIdx,
      branchBaseRadius: branch.baseRadius, creationTime: this.time,
    });
  }

  private splitBranch(branch: Branch) {
    const gp = this.growthParams;
    branch.active = false;
    const lastSegIdx = branch.segments.length - 1;
    const lastSeg = branch.segments[lastSegIdx];
    const parentRadius = lastSeg.baseRadius;
    const twist = Math.random() * Math.PI * 2;
    const spreadRandom = Math.random() * 0.2;
    const childDepth = branch.depth + 1;

    for (let i = 0; i < 2; i++) {
      const sign = i === 0 ? 1 : -1;
      const arbitrary = Math.abs(branch.direction.y) > 0.9
        ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const rotAxis = new THREE.Vector3().crossVectors(branch.direction, arbitrary).normalize();
      rotAxis.applyAxisAngle(branch.direction, twist);
      const baseSpread = 0.15 + gp.branchAngle * 0.7;
      const spreadAngle = baseSpread + spreadRandom;
      const newDir = branch.direction.clone().applyAxisAngle(rotAxis, sign * spreadAngle);
      // INVERTED gravity
      newDir.y = Math.max(newDir.y, 0.50 - gp.gravity * 0.45);
      newDir.normalize();
      const childRadius = parentRadius * 0.55;
      const spawnOffset = rotAxis.clone().multiplyScalar(sign * (parentRadius - childRadius) * 0.8);
      const spawnPos = lastSeg.position.clone().add(spawnOffset);
      this.branches.push({
        segments: [{
          position: spawnPos, radius: childRadius * 0.3,
          baseRadius: childRadius, initialRadius: childRadius,
          age: 0, direction: newDir.clone(), segIndex: 0,
          branchBaseRadius: childRadius, creationTime: this.time,
        }],
        direction: newDir, speed: 0.25 + Math.random() * 0.3,
        wobble: 0.1 + Math.random() * 0.4, active: true,
        baseRadius: childRadius,
        pointsPerRing: Math.max(4, Math.floor(branch.pointsPerRing * 0.85)),
        noiseOffset: new THREE.Vector3(Math.random() * 1000, Math.random() * 1000, Math.random() * 1000),
        growAccum: 0, id: this.nextBranchId++,
        parentBranchId: branch.id, parentSegIdx: lastSegIdx,
        spawnType: 'split', splitSign: sign,
        twistAngle: twist, spreadRandom,
        depth: childDepth, maxSegments: this.randomMaxSegs(childDepth),
        kind: 'main',
        presence: 1,
      });
    }
  }

  private lateralFromBranch(branch: Branch) {
    const gp = this.growthParams;
    const lastSegIdx = branch.segments.length - 1;
    const lastSeg = branch.segments[lastSegIdx];
    const parentRadius = lastSeg.baseRadius;
    const twist = Math.random() * Math.PI * 2;
    const spreadRandom = Math.random() * 0.3;
    const childDepth = branch.depth + 1;

    const arbitrary = Math.abs(branch.direction.y) > 0.9
      ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const sideAxis = new THREE.Vector3().crossVectors(branch.direction, arbitrary).normalize();
    sideAxis.applyAxisAngle(branch.direction, twist);
    const lateralAngle = 0.5 + gp.branchAngle * 0.8 + spreadRandom;
    const newDir = branch.direction.clone().applyAxisAngle(sideAxis, lateralAngle);
