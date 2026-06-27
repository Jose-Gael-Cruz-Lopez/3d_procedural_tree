import type { FoliageMode, LeafShape } from './tree-engine';

export interface TreeType {
  id: string;
  name: string;
  accentColor: string;
  category: 'natural' | 'figma';
  stemColor: string;
  leafColor: string;
  flowerCenterColor: string;
  foliageMode: FoliageMode;
  leafShape: LeafShape;
  defaultWobble: number;
  defaultGravity: number;
  defaultSplit: number;
  defaultBloom: number;
  defaultThickness: number;
  defaultGrowSpeed: number;
  wobbleRange:  [number, number];
  gravityRange: [number, number];
  angleRange:   [number, number];
  bloomRange:   [number, number];
  terrainGrassColor: string;
  terrainFlowerColors: string[];
}

export const TREE_TYPES: TreeType[] = [
  {
    id: 'sakura', name: 'Sakura', accentColor: '#e8507a', category: 'natural',
    stemColor: '#4a2a1a', leafColor: '#f0a0b8', flowerCenterColor: '#f5e060',
    foliageMode: 'flowers', leafShape: 'round',
    defaultWobble: 0.35, defaultGravity: 0.60, defaultSplit: 0.15, defaultBloom: 0.55,
    defaultThickness: 0.005, defaultGrowSpeed: 1.2,
    wobbleRange: [0.05, 2.2], gravityRange: [0.40, 0.88], angleRange: [0.25, 0.75], bloomRange: [0.25, 0.90],
    terrainGrassColor: '#3a6832', terrainFlowerColors: ['#f0a0b8', '#e88aa0', '#ffffff'],
  },
  {
    id: 'maple', name: 'Maple', accentColor: '#d44820', category: 'natural',
    stemColor: '#5a3a1a', leafColor: '#d45030', flowerCenterColor: '#e8c840',
    foliageMode: 'leaves', leafShape: 'palmate',
    defaultWobble: 0.40, defaultGravity: 0.42, defaultSplit: 0.13, defaultBloom: 0.78,
    defaultThickness: 0.007, defaultGrowSpeed: 1.0,
    wobbleRange: [0.05, 2.2], gravityRange: [0.15, 0.62], angleRange: [0.25, 0.80], bloomRange: [0.35, 0.90],
    terrainGrassColor: '#4a6a30', terrainFlowerColors: ['#d45030', '#e8a020'],
  },
  {
    id: 'wisteria', name: 'Wisteria', accentColor: '#7748c8', category: 'figma',
    stemColor: '#2a1a4a', leafColor: '#8858d8', flowerCenterColor: '#e0d0ff',
    foliageMode: 'flowers', leafShape: 'oval',
    defaultWobble: 0.42, defaultGravity: 0.78, defaultSplit: 0.16, defaultBloom: 0.65,
    defaultThickness: 0.005, defaultGrowSpeed: 1.1,
    wobbleRange: [0.05, 2.2], gravityRange: [0.55, 0.95], angleRange: [0.22, 0.72], bloomRange: [0.28, 0.98],
    terrainGrassColor: '#3a5540', terrainFlowerColors: ['#8858d8', '#b090f0', '#e0d0ff'],
  },
  {
    id: 'orange', name: 'Orange', accentColor: '#d08818', category: 'natural',
    stemColor: '#4a2a10', leafColor: '#2a7a28', flowerCenterColor: '#ff8c00',
    foliageMode: 'fruits', leafShape: 'oval',
    defaultWobble: 0.28, defaultGravity: 0.38, defaultSplit: 0.14, defaultBloom: 0.80,
    defaultThickness: 0.008, defaultGrowSpeed: 0.85,
    wobbleRange: [0.05, 1.8], gravityRange: [0.20, 0.62], angleRange: [0.20, 0.70], bloomRange: [0.50, 0.96],
    terrainGrassColor: '#3a6830', terrainFlowerColors: ['#2a7a28', '#ff8c00'],
  },
  {
    id: 'olive', name: 'Olive', accentColor: '#3a8a38', category: 'natural',
    stemColor: '#6a6a5a', leafColor: '#7a9a60', flowerCenterColor: '#c8c890',
    foliageMode: 'leaves', leafShape: 'oval',
    defaultWobble: 0.75, defaultGravity: 0.50, defaultSplit: 0.22, defaultBloom: 0.75,
    defaultThickness: 0.011, defaultGrowSpeed: 0.7,
    wobbleRange: [0.15, 3.0], gravityRange: [0.30, 0.70], angleRange: [0.25, 0.70], bloomRange: [0.30, 0.85],
    terrainGrassColor: '#4a7238', terrainFlowerColors: ['#c8c890', '#b0a870'],
  },
  {
    id: 'almond', name: 'Almond', accentColor: '#b0a890', category: 'figma',
    stemColor: '#4a3828', leafColor: '#f8f8f2', flowerCenterColor: '#f5e060',
    foliageMode: 'flowers', leafShape: 'round',
    defaultWobble: 0.18, defaultGravity: 0.22, defaultSplit: 0.12, defaultBloom: 0.45,
    defaultThickness: 0.008, defaultGrowSpeed: 0.85,
    wobbleRange: [0.02, 1.6], gravityRange: [0.05, 0.40], angleRange: [0.20, 0.60], bloomRange: [0.20, 0.80],
    terrainGrassColor: '#3a6030', terrainFlowerColors: ['#f8f8f2', '#e8e0d0', '#fff8e0'],
  },
];

// ── Styles ────────────────────────────────────────────────────────────────────
const TEXT  = 'rgba(55, 35, 12, 0.78)';
const MUTED = 'rgba(55, 35, 12, 0.38)';

const COZY: import('react').CSSProperties = {
  background: 'rgba(255, 248, 232, 0.88)',
  backdropFilter: 'blur(28px) saturate(120%)',
