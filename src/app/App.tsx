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

      {isMobile ? (
        /* ══════════════ MOBILE LAYOUT ══════════════ */
        <>
          {/* TOP BAR: Reset */}
          <div className="absolute top-3 left-0 right-0 z-20 flex justify-center" style={{ pointerEvents: 'none' }}>
            <div style={{ pointerEvents: 'auto' }}>
              <button
                onClick={handleRestart}
                style={{
                  padding: '5px 14px', borderRadius: 20, border: '1.5px solid rgba(200,160,90,0.18)',
                  cursor: 'pointer', background: 'rgba(255,248,232,0.92)',
                  backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
                  display: 'flex', alignItems: 'center', gap: 4,
                  color: 'rgba(55, 35, 12, 0.45)', fontSize: '12px',
                  boxShadow: '0 2px 12px rgba(120,80,20,0.07)',
                }}
                title="Reset tree"
              >
                <span>↺</span>
                <span className="uppercase tracking-[0.10em]" style={{ fontSize: '8px' }}>Reset</span>
              </button>
            </div>
          </div>

          {/* BOTTOM: Tree type selector */}
          <div
            className="absolute bottom-0 left-0 right-0 z-10 flex justify-center"
            style={{ paddingBottom: 16, pointerEvents: 'none' }}
          >
            <div
              style={{
                pointerEvents: 'auto', maxWidth: '100vw',
                overflowX: 'auto', WebkitOverflowScrolling: 'touch',
                display: 'flex', alignItems: 'center',
                padding: '0 12px', scrollbarWidth: 'none',
              }}
            >
              <div style={{
                background: 'rgba(255,248,232,0.88)',
                backdropFilter: 'blur(28px) saturate(120%)',
                WebkitBackdropFilter: 'blur(28px) saturate(120%)',
                border: '1.5px solid rgba(200,160,90,0.20)',
                boxShadow: '0 4px 24px rgba(100,65,15,0.10)',
                borderRadius: 24, padding: '3px 6px',
                display: 'flex', alignItems: 'center', gap: 0,
              }}>
                {TREE_TYPES.map((t) => {
                  const isSelected = treeType.id === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => handleSelectType(t)}
                      style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                        padding: '6px 9px 5px',
                        background: isSelected ? `${t.accentColor}1e` : 'transparent',
                        border: 'none', outline: 'none', borderRadius: 16, cursor: 'pointer',
                        transition: 'background 0.22s ease',
                      }}
                    >
                      <span style={{ fontSize: 16, lineHeight: 1 }}>
                        {t.id === 'sakura' ? '🌸' : t.id === 'maple' ? '🍁' : t.id === 'wisteria' ? '💜' : t.id === 'orange' ? '🍊' : t.id === 'olive' ? '🫒' : '🌼'}
                      </span>
                      <span style={{
                        fontSize: '8px', letterSpacing: '0.07em', textTransform: 'uppercase',
                        color: isSelected ? 'rgba(55,35,12,0.78)' : 'rgba(55,35,12,0.38)',
                        lineHeight: 1, whiteSpace: 'nowrap', transition: 'color 0.2s',
                      }}>{t.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      ) : (
        /* ══════════════ DESKTOP LAYOUT ══════════════ */
        <TreeTypePanel
          selectedType={treeType.id}
          onSelectType={handleSelectType}
          onRestart={handleRestart}
        />
      )}
    </div>
  );
}
