import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { TreeScene } from './components/tree-scene';
import { TreeTypePanel, TREE_TYPES } from './components/tree-type-panel';
import type { TreeType } from './components/tree-type-panel';
import { DEFAULT_GROWTH_PARAMS } from './components/tree-engine';
import type { GrowthParams, FoliageMode, GrowthMode, LeafShape } from './components/tree-engine';
import { SFX } from './components/sound-manager';

const DEFAULT_TYPE = TREE_TYPES.find(t => t.id === 'olive') || TREE_TYPES[4]; // Olive

// ── Mobile detection hook ─────────────────────────────────────────────────────
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 700);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 700);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
}

export default function App() {
  // ── Tree type ────────────────────────────────────────────────────────────
  const [treeType, setTreeType] = useState<TreeType>(DEFAULT_TYPE);

  // ── Growth mode ───────────────────────────────────────────────────────────
  const [growthMode] = useState<GrowthMode>('grow');

  // ── Derived from tree type ────────────────────────────────────────────────
  const [stemColor,         setStemColor]         = useState(DEFAULT_TYPE.stemColor);
  const [leafColor,         setLeafColor]         = useState(DEFAULT_TYPE.leafColor);
  const [flowerCenterColor, setFlowerCenterColor] = useState(DEFAULT_TYPE.flowerCenterColor);
  const [foliageMode,       setFoliageMode]       = useState<FoliageMode>(DEFAULT_TYPE.foliageMode);
  const [leafShape,         setLeafShape]         = useState<LeafShape>(DEFAULT_TYPE.leafShape);

  // Fixed values
  const pointSize   = 0.06;
  const naturalness = 0.5;
  const stepSize    = DEFAULT_GROWTH_PARAMS.stepSize;
  const leafDensity = 0.6;

  // Per-species dynamic values
  const thicknessRate = treeType.defaultThickness;
