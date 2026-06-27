import { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TreeEngine, terrainNoise } from './tree-engine';
import type { GrowthParams, FoliageMode, GrowthMode, LeafShape } from './tree-engine';
import { SFX } from './sound-manager';

const BG_COLOR = '#f0efe8';
const MAX_HOLD = 4; // seconds for full charge

interface TreeSceneProps {
  pointSize: number;
  stemColor: string;
  leafColor: string;
  leafDensity: number;
  stemOpacity: number;
  leafOpacity: number;
  terrainOpacity: number;
  terrainColor: string;
  terrainFlowerColors: string[];
  terrainDensity: number;
  thicknessRate: number;
  naturalness: number;
  splitLevel: number;
  foliageMode: FoliageMode;
  leafShape: LeafShape;
  flowerCenterColor: string;
  /** Per-species grow energy multiplier (0.5–2.0) */
  growSpeed: number;
  /** Per-species clamped intervals for each adjustable param */
  paramRanges: {
    wobble:  [number, number];
    gravity: [number, number];
    bloom:   [number, number];
  };
  growthParams: GrowthParams;
  growthMode: GrowthMode;
  handOpenness: React.RefObject<number>;
  cameraControl: React.RefObject<{ zoom: number; yaw: number; active: boolean }>;
  onRestart: React.MutableRefObject<(() => void) | null>;
  onGrowPress: React.MutableRefObject<(() => void) | null>;
  onGrowRelease: React.MutableRefObject<(() => void) | null>;
  /** Decrease param button press/release — used by mobile − button */
  onParamDecPress: React.MutableRefObject<(() => void) | null>;
  onParamDecRelease: React.MutableRefObject<(() => void) | null>;
  onBreathStateChange: React.MutableRefObject<((held: boolean, charge: number) => void) | null>;
  /** Called with (held, level 0–1) for wobble/split/bloom modes */
  onParamLevelChange: React.MutableRefObject<((held: boolean, level: number) => void) | null>;
  /** Called every frame with 0–1 grow fill (segment count / cap) */
  onGrowFillChange: React.MutableRefObject<((fill: number) => void) | null>;
  /** When true, grow mode is driven automatically until sizeFill reaches 1 */
  autoGrow?: boolean;
}

function createCircleTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  // Limpiar a transparente antes de dibujar
  ctx.clearRect(0, 0, size, size);
  // Círculo sólido blanco — los fragmentos fuera del círculo quedarán alfa=0
  // y serán descartados por alphaTest en el material, eliminando el cuadrado blanco
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 0.5, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function generateTerrainPoints(density: number): Float32Array {
  const tSize = 13;
  const pts: number[] = [];

  // Smooth density gradient: one unified pass with distance-based probability.
  // No hard radial cutoffs — density decays continuously from centre to edge.
  //   dist=0   → p=1.0  (always kept, max density)
  //   dist=4   → p≈0.72
  //   dist=8   → p≈0.28
  //   dist=13  → p≈0.05 (nearly invisible fringe)
  //
  // We sample a fine base grid and keep each point with probability p(dist).
  // A secondary boost layer near the trunk (r<3) ensures the ground close-up
  // is always well-covered independently of the density slider.

  const baseStep = 0.14 - density * 0.07; // 0.07–0.14 depending on slider
  const smoothstep = (edge0: number, edge1: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  };

  for (let x = -tSize; x <= tSize; x += baseStep) {
    for (let z = -tSize; z <= tSize; z += baseStep) {
      const jx = x + (Math.random() - 0.5) * baseStep * 0.6;
      const jz = z + (Math.random() - 0.5) * baseStep * 0.6;
      const dist = Math.sqrt(jx * jx + jz * jz);
      // Probability: 1 at centre → falls smoothly to ~0 at tSize
      const fade = 1 - smoothstep(0, tSize, dist);
      // Extra density bonus near the trunk (Gaussian bell, σ≈2.5)
      const near = Math.exp(-(dist * dist) / 6.25) * 0.6;
      const p = Math.min(1, fade + near);
      if (Math.random() < p) {
        pts.push(jx, terrainNoise(jx, jz), jz);
      }
    }
  }

  return new Float32Array(pts);
}

function generateHerbPoints(): Float32Array {
  const pts: number[] = [];
  const tSize = 13;
  const herbCount = 5500;                        // dense lush carpet
  for (let i = 0; i < herbCount; i++) {
    const cx = (Math.random() - 0.5) * tSize * 2;
    const cz = (Math.random() - 0.5) * tSize * 2;
    const baseY = terrainNoise(cx, cz);
    const blades = 3 + Math.floor(Math.random() * 4);
    for (let b = 0; b < blades; b++) {
      const dx = (Math.random() - 0.5) * 0.08;
      const dz = (Math.random() - 0.5) * 0.08;
      const height = 0.03 + Math.random() * 0.08;
      pts.push(cx + dx, baseY + 0.01, cz + dz);
      pts.push(cx + dx + (Math.random() - 0.5) * 0.02, baseY + height, cz + dz + (Math.random() - 0.5) * 0.02);
    }
  }
  return new Float32Array(pts);
}

function generateTerrainFlowers(): Float32Array {
  const pts: number[] = [];
  const tSize = 9;                               // flowers closer to tree
  const flowerCount = 300;
  for (let i = 0; i < flowerCount; i++) {
    const cx = (Math.random() - 0.5) * tSize * 2;
    const cz = (Math.random() - 0.5) * tSize * 2;
    const baseY = terrainNoise(cx, cz);
    const stemH = 0.04 + Math.random() * 0.06;
    pts.push(cx, baseY + stemH * 0.5, cz);
    const petals = 3 + Math.floor(Math.random() * 3);
    for (let p = 0; p < petals; p++) {
      const a = (p / petals) * Math.PI * 2 + Math.random() * 0.5;
      const r = 0.01 + Math.random() * 0.015;
      pts.push(cx + Math.cos(a) * r, baseY + stemH + (Math.random() - 0.5) * 0.005, cz + Math.sin(a) * r);
    }
  }
  return new Float32Array(pts);
}

export function TreeScene({
