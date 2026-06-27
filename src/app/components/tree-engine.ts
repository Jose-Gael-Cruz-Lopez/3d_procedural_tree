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
    // INVERTED gravity
    newDir.y = Math.max(newDir.y, 0.35 - gp.gravity * 0.35);
    newDir.normalize();
    const childRadius = parentRadius * 0.4;
    const spawnPos = lastSeg.position.clone().addScaledVector(sideAxis, parentRadius);

    // Parent continues growing (reset its max segs)
    branch.maxSegments = branch.segments.length + this.randomMaxSegs(branch.depth);

    this.branches.push({
      segments: [{
        position: spawnPos, radius: childRadius * 0.3,
        baseRadius: childRadius, initialRadius: childRadius,
        age: 0, direction: newDir.clone(), segIndex: 0,
        branchBaseRadius: childRadius, creationTime: this.time,
      }],
      direction: newDir, speed: 0.2 + Math.random() * 0.25,
      wobble: 0.15 + Math.random() * 0.35, active: true,
      baseRadius: childRadius,
      pointsPerRing: Math.max(4, Math.floor(branch.pointsPerRing * 0.7)),
      noiseOffset: new THREE.Vector3(Math.random() * 1000, Math.random() * 1000, Math.random() * 1000),
      growAccum: 0, id: this.nextBranchId++,
      parentBranchId: branch.id, parentSegIdx: lastSegIdx,
      spawnType: 'lateral', splitSign: 1,
      twistAngle: twist, spreadRandom,
      depth: childDepth, maxSegments: this.randomMaxSegs(childDepth),
      kind: 'main',
      presence: 1,
    });
  }

  private updateLeaves(dt: number) {
    if (this.leafDensity <= 0) {
      for (const leaf of this.leaves) leaf.targetScale = 0;
      this.leaves = this.leaves.filter(leaf => {
        leaf.age += dt;
        leaf.scale = THREE.MathUtils.lerp(leaf.scale, leaf.targetScale, dt * 3.0);
        return leaf.scale > 0.01;
      });
      return;
    }

    const branchMap = new Map<number, Branch>();
    for (const b of this.branches) branchMap.set(b.id, b);

    // Global bloom params
    // maxTipSegs=0 at bloomLevel=0 means NO foliage at all (bloom=0 → 0 leaves)
    // blEff: power curve so low-end bloom is much more gradual.
    // bl=0.05→blEff=0.011  bl=0.1→0.032  bl=0.3→0.164  bl=0.7→0.586  bl=1→1.0
    const bl    = this.bloomLevel;
    const blEff = Math.pow(bl, 1.5);

    // Spawn interval: denser at high bloom
    const baseInterval = Math.max(1, Math.round(
      (3 - this.leafDensity * 2) * (1 - blEff * 0.92)
    ));

    // Height-based bloom: compute max tip-Y across all branches so we can normalize
    let maxBranchY = 0.01;
    for (const b of this.branches) {
      if (b.segments.length > 0) {
        const tipY = b.segments[b.segments.length - 1].position.y;
        if (tipY > maxBranchY) maxBranchY = tipY;
      }
    }

    // Per-branch tipSegCount: PROPORTIONAL to that branch's own length × blEff × heightFactor.
    // This is the key to symmetric increase/decrease:
    //   - bloom ↑ → frac grows → more segments from tip become visible (smooth in)
    //   - bloom ↓ → frac shrinks → segments from base toward tip fade out (smooth out)
    // No global maxTipSegs constant that exceeds branch length and makes tc=totalSegs at any bloom.
    const branchTipCount = (branch: Branch): number => {
      if (blEff <= 0) return 0;
      const totalSegs = branch.segments.length;
      if (totalSegs < 2) return 0;
      const tipY = branch.segments[totalSegs - 1].position.y;
      const heightRatio = Math.max(0, tipY / maxBranchY);
      // pow(3): concentrates bloom in top canopy; bottom 40% of height gets <6%
      const heightFactor = Math.pow(heightRatio, 3);
      if (heightFactor < 0.005) return 0;
      // frac: at blEff=1 + top branch → 1.0 (all segs show). At blEff=0.3 → ~0.27.
      // ×1.8 so full coverage arrives around bloom=0.75 for top branches rather than bloom=1.
      const frac = Math.min(1, blEff * heightFactor * 1.8);
      return Math.round(totalSegs * frac);
    };

    const childMap = new Map<number, number[]>();
    for (const b of this.branches) {
      if (b.parentBranchId !== null) {
        const list = childMap.get(b.parentBranchId) || [];
        list.push(b.id);
        childMap.set(b.parentBranchId, list);
      }
    }

    const hasActiveDescendant = (branchId: number): boolean => {
      const branch = branchMap.get(branchId);
      if (!branch) return false;
      if (branch.active) return true;
      const children = childMap.get(branchId);
      // Terminal inactive branch: stopped at maxDepth with no children (not shrunk away).
      // Treat as "alive" so its leaves stay visible — they'll be removed when the branch
      // is explicitly deleted by _removeBranchSubtree during shrink.
      if (!children || children.length === 0) return branch.segments.length > 1;
      return children.some(cid => hasActiveDescendant(cid));
    };

    for (const leaf of this.leaves) {
      leaf.age += dt;
      const branch = branchMap.get(leaf.branchId);
      if (!branch) {
        leaf.targetScale = 0;
      } else {
        const tc = branchTipCount(branch);
        if (tc === 0) {
          // bloom=0: hide all foliage
          leaf.targetScale = 0;
        } else {
          const totalSegs = branch.segments.length;
          const tipStart = Math.max(0, totalSegs - tc);
          if (branch.active || hasActiveDescendant(leaf.branchId)) {
            leaf.targetScale = leaf.segIdx < tipStart ? 0 : 1;
          } else {
            leaf.targetScale = 0;
          }
        }
      }
      leaf.scale = THREE.MathUtils.lerp(leaf.scale, leaf.targetScale, dt * 3.0);
    }

    this.leaves = this.leaves.filter(l => !(l.targetScale === 0 && l.scale < 0.01));

    // ── Throttled spawn: every 0.15 s ────────────────────────────────────────
    this.leafSpawnAccum += dt;
    if (this.leafSpawnAccum < 0.15) return;
    this.leafSpawnAccum = 0;

    const existingLeafKeys = new Set<string>();
    for (const leaf of this.leaves) existingLeafKeys.add(`${leaf.branchId}:${leaf.segIdx}:${leaf.clusterIdx}`);

    // Bloom cluster: blEff (power curve) keeps low-end density gradual.
    // At bl=0.1 (blEff=0.032) cluster stays at 1; density visibly picks up mid-range.
    const bloomCluster  = this.foliageMode === 'flowers' ? 1 + Math.floor(blEff * 6) : 1;
    // Larger petals at high bloom (up to 2.5× at bloomLevel=1)
    const bloomSizeMult = 1 + blEff * 1.5;

    for (const branch of this.branches) {
      // ── Trunk (depth=0): allow bloom at the upper tip ────────────────────────
      // The height guard (segY / maxBranchY < 0.55) and branchTipCount's heightFactor
      // already ensure only the very top of the trunk gets flowers. Skip only if bloom is very low.
      if (branch.depth === 0 && blEff < 0.15) continue;

      // At low bloom: only active branches and inactive-terminal branches spawn foliage.
      // At high bloom (>0.5): open it up to ALL inactive branches — non-terminal
      // branches have many more segment positions, and without them the spawn map
      // fills up on the short terminal tips and nothing new appears past ~70%.
      const children = childMap.get(branch.id);
      const isTerminalInactive = !branch.active &&
        (!children || children.length === 0) &&
        branch.segments.length > 1;
      const isHighBloomInactive = !branch.active &&
        this.bloomLevel > 0.5 &&
        branch.segments.length > 1;
      // Trunk tip exception: allow bloom at trunk top once blEff is meaningful
      const isTrunkTipBloom = branch.depth === 0 && blEff >= 0.15;
      if (!branch.active && !isTerminalInactive && !isHighBloomInactive && !isTrunkTipBloom) continue;
      const totalSegs = branch.segments.length;
      if (totalSegs < 4) continue;
      const tc = branchTipCount(branch);
      if (tc === 0) continue; // bloom=0: no spawn
      const tipStart = Math.max(2, totalSegs - tc);
      for (let si = tipStart; si < totalSegs; si += baseInterval) {
        // ── Per-segment height guard ──────────────────────────────────────────
        // branchTipCount checks only the tip Y. For long branches the counted-back
        // range can include segments well below the visual canopy floor. Skip any
        // segment whose own Y falls in the lower 55% of the tree.
        const segY = branch.segments[si].position.y;
        // Trunk uses a higher threshold so bloom only appears near the very top
        const heightFloor = branch.depth === 0 ? 0.72 : 0.55;
        if (segY / maxBranchY < heightFloor) continue;

        for (let ci = 0; ci < bloomCluster; ci++) {
          const key = `${branch.id}:${si}:${ci}`;
          if (existingLeafKeys.has(key)) continue;
          // Fully random twist per (si, ci) — not deterministic per cluster index.
          // If we used (ci / bloomCluster)*2π, all flowers at every segment would face
          // the same evenly-spaced angles, producing a perfect line along the branch.
          const twistSeed = Math.random() * Math.PI * 2;
          if (this.foliageMode === 'flowers') {
            this.spawnFlowerAt(branch.id, si, branch.segments[si], ci, twistSeed, bloomSizeMult);
          } else if (this.foliageMode === 'fruits') {
            this.spawnFruitAt(branch.id, si, branch.segments[si], bloomSizeMult);
          } else {
            this.spawnLeafAt(branch.id, si, branch.segments[si]);
          }
        }
      }
    }
  }

  private spawnLeafAt(branchId: number, segIdx: number, seg: Segment) {
    const up = seg.direction.clone().normalize();
    const arbitrary = Math.abs(up.y) > 0.9
      ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const perp1 = new THREE.Vector3().crossVectors(up, arbitrary).normalize();
    const perp2 = new THREE.Vector3().crossVectors(up, perp1).normalize();

    const twist = Math.random() * Math.PI * 2;
    const outDir = perp1.clone().multiplyScalar(Math.cos(twist))
      .add(perp2.clone().multiplyScalar(Math.sin(twist))).normalize();
    const sideDir = new THREE.Vector3().crossVectors(up, outDir).normalize();

    const r = seg.radius;
    const allPoints: THREE.Vector3[] = [];

    const petioleSteps = 3 + Math.floor(Math.random() * 3);
    const petioleLen = 0.02 + Math.random() * 0.03;

    for (let i = 0; i <= petioleSteps; i++) {
      const t = i / petioleSteps;
      const dist = r + t * petioleLen;
      const droopY = -t * t * 0.003;
      const liftY  = t * 0.002;
      allPoints.push(new THREE.Vector3(
        outDir.x * dist + up.x * (droopY + liftY),
        outDir.y * dist + up.y * (droopY + liftY),
        outDir.z * dist + up.z * (droopY + liftY),
      ));
    }
    const petioleCount = allPoints.length;

    const bladeOriginDist = r + petioleLen;
    const bOx = outDir.x * bladeOriginDist;
    const bOy = outDir.y * bladeOriginDist;
    const bOz = outDir.z * bladeOriginDist;

    const shape = this.leafShape;

    if (shape === 'palmate') {
      // ── Palmate / maple: 5 lobes fanning from the base ──────────────────
      const lobeBaseLen = 0.048 + Math.random() * 0.032;
      const lobeSpread  = 0.58; // ~33° between adjacent lobes
      for (let l = 0; l < 5; l++) {
        const lobeAngle   = (l - 2) * lobeSpread;
        const dist2Center = Math.abs(l - 2);
        const lobeLen  = lobeBaseLen * (1.0 - dist2Center * 0.22);
        const lobeWidth = lobeLen * 0.38;
        // Rotate outDir by lobeAngle around up-axis
        const lobeDir = new THREE.Vector3(
          outDir.x * Math.cos(lobeAngle) + sideDir.x * Math.sin(lobeAngle),
          outDir.y * Math.cos(lobeAngle) + sideDir.y * Math.sin(lobeAngle),
          outDir.z * Math.cos(lobeAngle) + sideDir.z * Math.sin(lobeAngle),
        ).normalize();
        const lobeSide = new THREE.Vector3().crossVectors(up, lobeDir).normalize();
        const lobePts = 6 + Math.floor(Math.random() * 3);
        for (let i = 0; i < lobePts; i++) {
          const a = (i / lobePts) * Math.PI * 2;
          const along = (lobeLen * 0.5) + Math.cos(a) * (lobeLen * 0.5);
          const across = Math.sin(a) * (lobeWidth * 0.5);
          allPoints.push(new THREE.Vector3(
            bOx + lobeDir.x * along + lobeSide.x * across,
            bOy + lobeDir.y * along + lobeSide.y * across,
            bOz + lobeDir.z * along + lobeSide.z * across,
          ));
        }
        for (let i = 0; i < 3; i++) {
          const along = Math.random() * lobeLen;
          const across = (Math.random() - 0.5) * lobeWidth * 0.6;
          allPoints.push(new THREE.Vector3(
            bOx + lobeDir.x * along + lobeSide.x * across,
            bOy + lobeDir.y * along + lobeSide.y * across,
            bOz + lobeDir.z * along + lobeSide.z * across,
          ));
        }
      }
      // Central midrib
      for (let i = 0; i < 3; i++) {
        const t2 = i / 2;
        allPoints.push(new THREE.Vector3(
          bOx + outDir.x * t2 * lobeBaseLen * 0.45,
          bOy + outDir.y * t2 * lobeBaseLen * 0.45,
          bOz + outDir.z * t2 * lobeBaseLen * 0.45,
        ));
      }
    } else {
      // ── Ellipse-based shapes: oval / needle / round / elongated ──────────
      let leafLen: number, leafWidth: number;
      if (shape === 'needle') {
        leafLen   = 0.10 + Math.random() * 0.07;
        leafWidth = leafLen * 0.09;
      } else if (shape === 'round') {
        leafLen   = 0.055 + Math.random() * 0.03;
        leafWidth = leafLen * (0.88 + Math.random() * 0.10);
      } else if (shape === 'elongated') {
        leafLen   = 0.075 + Math.random() * 0.055;
        leafWidth = leafLen * 0.18;
      } else {
        // 'oval' — default
        leafLen   = 0.04 + Math.random() * 0.04;
        leafWidth = leafLen * (0.45 + Math.random() * 0.3);
      }

      const addBlade = (along: number, across: number, thick: number) => {
        allPoints.push(new THREE.Vector3(
          bOx + outDir.x * along + sideDir.x * across + up.x * thick,
          bOy + outDir.y * along + sideDir.y * across + up.y * thick,
          bOz + outDir.z * along + sideDir.z * across + up.z * thick,
        ));
      };

      const perimeterPts = shape === 'needle' ? 6
        : (shape === 'round' ? 18 : 12) + Math.floor(Math.random() * 4);
      for (let i = 0; i < perimeterPts; i++) {
        const t = i / perimeterPts;
        const angle = t * Math.PI * 2;
        const along = (leafLen * 0.5) + Math.cos(angle) * (leafLen * 0.5);
        const across = Math.sin(angle) * (leafWidth * 0.5);
        addBlade(along, across, (Math.random() - 0.5) * 0.004);
      }
      const fillPts = shape === 'needle' ? 2 : 6 + Math.floor(Math.random() * 4);
      for (let i = 0; i < fillPts; i++) {
        const angle = Math.random() * Math.PI * 2;
        const rFrac = Math.sqrt(Math.random());
        const along = (leafLen * 0.5) + Math.cos(angle) * (leafLen * 0.5) * rFrac;
        const across = Math.sin(angle) * (leafWidth * 0.5) * rFrac;
        addBlade(along, across, (Math.random() - 0.5) * 0.003);
      }
      for (let i = 0; i < 3; i++) addBlade((i + 1) / 4 * leafLen, 0, 0);
      addBlade(0, 0, 0);
      addBlade(leafLen, 0, 0);
    }

    this.leaves.push({
      position: seg.position.clone(),
      points: allPoints,
      petioleCount,
      centerCount: 0,
      scale: 0,
      targetScale: 1,
      age: 0,
      branchId,
      segIdx,
      clusterIdx: 0,
    });
  }

  /** Fruit cluster: dense sphere (flowerCenterColor) + calyx leaves (leafColor) */
  private spawnFruitAt(branchId: number, segIdx: number, seg: Segment, sizeMult: number) {
    const up = seg.direction.clone().normalize();
    const arbitrary = Math.abs(up.y) > 0.9
      ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const perp1 = new THREE.Vector3().crossVectors(up, arbitrary).normalize();
    const perp2 = new THREE.Vector3().crossVectors(up, perp1).normalize();

    const twist  = Math.random() * Math.PI * 2;
    const outDir = perp1.clone().multiplyScalar(Math.cos(twist))
      .add(perp2.clone().multiplyScalar(Math.sin(twist))).normalize();

    const r = seg.radius;
    const allPoints: THREE.Vector3[] = [];

    // Fruit stalk (petiole)
    const stemClear  = Math.max(seg.baseRadius, r) * 1.6;
    const petioleLen = 0.018 + Math.random() * 0.022;
    for (let i = 0; i <= 2; i++) {
      const t = i / 2;
      const d = r + stemClear + t * petioleLen;
      allPoints.push(new THREE.Vector3(outDir.x * d, outDir.y * d, outDir.z * d));
    }
    const petioleCount = allPoints.length;

    // Fruit body — dense sphere (centerCount → flowerCenterColor)
    const fruitDist = r + stemClear + petioleLen;
    const fOx = outDir.x * fruitDist;
    const fOy = outDir.y * fruitDist;
    const fOz = outDir.z * fruitDist;
    const fruitR = (0.016 + Math.random() * 0.012) * Math.min(sizeMult, 1.6);
    const fruitPts = 18 + Math.floor(Math.random() * 8);
    for (let i = 0; i < fruitPts; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos(2 * Math.random() - 1);
      const rr    = fruitR * (0.65 + Math.random() * 0.35);
      allPoints.push(new THREE.Vector3(
        fOx + Math.sin(phi) * Math.cos(theta) * rr,
        fOy + Math.sin(phi) * Math.sin(theta) * rr,
        fOz + Math.cos(phi) * rr,
      ));
    }
    const centerCount = fruitPts;

    // Calyx — small leaf points around base (leafColor = green)
    const calyxPts = 5 + Math.floor(Math.random() * 3);
    for (let i = 0; i < calyxPts; i++) {
      const a  = (i / calyxPts) * Math.PI * 2;
      const cr = fruitR * (0.7 + Math.random() * 0.5);
      allPoints.push(new THREE.Vector3(
        fOx + perp1.x * Math.cos(a) * cr + perp2.x * Math.sin(a) * cr,
        fOy + perp1.y * Math.cos(a) * cr + perp2.y * Math.sin(a) * cr,
        fOz + perp1.z * Math.cos(a) * cr + perp2.z * Math.sin(a) * cr,
      ));
    }

    this.leaves.push({
      position: seg.position.clone(),
      points: allPoints,
      petioleCount,
      centerCount,
      scale: 0,
      targetScale: 1,
      age: 0,
      branchId,
      segIdx,
      clusterIdx: 0,
    });
  }

  private spawnFlowerAt(branchId: number, segIdx: number, seg: Segment, clusterIdx: number, twistSeed: number, sizeMult: number) {
    const up = seg.direction.clone().normalize();
    const arbitrary = Math.abs(up.y) > 0.9
      ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const perp1 = new THREE.Vector3().crossVectors(up, arbitrary).normalize();
    const perp2 = new THREE.Vector3().crossVectors(up, perp1).normalize();

    // twistSeed is now fully random per flower (passed from spawn loop).
    // Add a small extra jitter so cluster members at the same si differ slightly.
    const twist = twistSeed + Math.random() * Math.PI * 0.3;
    const outDir = perp1.clone().multiplyScalar(Math.cos(twist))
      .add(perp2.clone().multiplyScalar(Math.sin(twist))).normalize();

    // Random upward tilt: flowers don't all face purely horizontal — they tilt
    // slightly up or down, breaking the "row of badges along a stick" look.
    const tiltAngle = (Math.random() - 0.3) * 0.6; // bias slightly upward
    const tiltAxis = new THREE.Vector3().crossVectors(outDir, up).normalize();
    const tiltedOut = outDir.clone().applyAxisAngle(tiltAxis, tiltAngle).normalize();

    // Small random radial offset on the anchor position so flowers at adjacent
    // segments don't all sit exactly on the branch centerline.
    const radialJitter = (Math.random() - 0.5) * seg.radius * 1.2;
    const jitterDir = perp1.clone()
      .multiplyScalar(Math.cos(twist + Math.PI * 0.5))
      .add(perp2.clone().multiplyScalar(Math.sin(twist + Math.PI * 0.5)));
    const spawnPos = seg.position.clone()
      .addScaledVector(jitterDir, radialJitter)
      .addScaledVector(up, (Math.random() - 0.5) * 0.01);

    const r = seg.radius;
    const allPoints: THREE.Vector3[] = [];

    // Short petiole — follows tiltedOut direction instead of flat outDir
    // stemClearance + petioleLen both grow with bloomLevel:
    //   bloom=0 → clearance=1.5×, petiole=0.04–0.08
    //   bloom=1 → clearance=4.0×, petiole=0.14–0.18
    const bl = this.bloomLevel;
    const stemClearance = Math.max(seg.baseRadius, r) * (1.5 + bl * 2.5);
    const petioleSteps = 2;
    const petioleLen = (0.04 + bl * 0.10) + Math.random() * 0.04;
    for (let i = 0; i <= petioleSteps; i++) {
      const t = i / petioleSteps;
      const dist = r + stemClearance + t * petioleLen;
