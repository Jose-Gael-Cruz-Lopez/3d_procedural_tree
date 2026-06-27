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
  const growSpeed     = treeType.defaultGrowSpeed;
  const paramRanges   = {
    wobble:  treeType.wobbleRange,
    gravity: treeType.gravityRange,
    bloom:   treeType.bloomRange,
  };

  const growthParams: GrowthParams = useMemo(() => ({
    wobble:      treeType.defaultWobble,
    gravity:     treeType.defaultGravity,
    branchAngle: 0.5,
    taper:       DEFAULT_GROWTH_PARAMS.taper,
    stepSize,
  }), [treeType, stepSize]);

  // ── Scene refs ────────────────────────────────────────────────────────────
  const restartRef       = useRef<(() => void) | null>(null);
  const growPressRef     = useRef<(() => void) | null>(null);
  const growReleaseRef   = useRef<(() => void) | null>(null);
  const paramDecPressRef = useRef<(() => void) | null>(null);
  const paramDecRelRef   = useRef<(() => void) | null>(null);
  const breathStateRef   = useRef<((held: boolean, charge: number) => void) | null>(null);
  breathStateRef.current = (_held: boolean, _charge: number) => {};

  const cameraControlRef = useRef<{ zoom: number; yaw: number; active: boolean }>({
    zoom: 0.5, yaw: 0, active: false,
  });
  const handOpennessRef = useRef(-1);

  const paramLevelStateRef = useRef<((held: boolean, level: number) => void) | null>(null);
  paramLevelStateRef.current = (_held: boolean, _level: number) => {};

  const onGrowFillChangeRef = useRef<((fill: number) => void) | null>(null);
  onGrowFillChangeRef.current = (_fill: number) => {};

  const handleRestart = useCallback(() => { restartRef.current?.(); SFX.restart(); }, []);

  // ── Tree type switching ───────────────────────────────────────────────────
  const handleSelectType = useCallback((t: TreeType) => {
    setTreeType(t);
    setStemColor(t.stemColor);
    setLeafColor(t.leafColor);
    setFlowerCenterColor(t.flowerCenterColor);
    setFoliageMode(t.foliageMode);
    setLeafShape(t.leafShape);
    SFX.selectTree();
  }, []);

  const isMobile = useIsMobile();

  return (
    <div className="relative w-full h-full overflow-hidden" style={{ background: '#f0efe8' }}>
      <TreeScene
        pointSize={pointSize}
        stemColor={stemColor}
        leafColor={leafColor}
        leafDensity={leafDensity}
        stemOpacity={1}
        leafOpacity={1}
        terrainOpacity={0.50}
        terrainColor={treeType.terrainGrassColor}
        terrainFlowerColors={treeType.terrainFlowerColors}
        terrainDensity={0.6}
        thicknessRate={thicknessRate}
        naturalness={naturalness}
        splitLevel={treeType.defaultSplit}
        foliageMode={foliageMode}
        leafShape={leafShape}
        flowerCenterColor={flowerCenterColor}
        growthParams={growthParams}
        growthMode={growthMode}
        growSpeed={growSpeed}
        paramRanges={paramRanges}
        handOpenness={handOpennessRef}
        cameraControl={cameraControlRef}
        onRestart={restartRef}
        onGrowPress={growPressRef}
        onGrowRelease={growReleaseRef}
        onParamDecPress={paramDecPressRef}
        onParamDecRelease={paramDecRelRef}
        onBreathStateChange={breathStateRef}
        onParamLevelChange={paramLevelStateRef}
        onGrowFillChange={onGrowFillChangeRef}
        autoGrow
      />
    </div>
  );
}
