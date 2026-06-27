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
