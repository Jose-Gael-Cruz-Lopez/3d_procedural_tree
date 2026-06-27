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
  pointSize, stemColor, leafColor, leafDensity,
  stemOpacity, leafOpacity, terrainOpacity, terrainColor,
  terrainFlowerColors, terrainDensity, thicknessRate, naturalness, splitLevel, foliageMode, leafShape,
  flowerCenterColor, growthParams, growthMode,
  growSpeed, paramRanges,
  handOpenness,
  cameraControl,
  onRestart, onGrowPress, onGrowRelease, onParamDecPress, onParamDecRelease,
  onBreathStateChange, onParamLevelChange,
  onGrowFillChange,
  autoGrow = false,
}: TreeSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef    = useRef<TreeEngine | null>(null);

  // Material refs
  const stemMaterialRef        = useRef<THREE.PointsMaterial | null>(null);
  const leafMaterialRef        = useRef<THREE.PointsMaterial | null>(null);
  const petioleMaterialRef     = useRef<THREE.PointsMaterial | null>(null);
  const flowerCenterMaterialRef = useRef<THREE.PointsMaterial | null>(null);
  const terrainMaterialRef     = useRef<THREE.PointsMaterial | null>(null);
  const terrainGeomRef         = useRef<THREE.BufferGeometry | null>(null);
  const herbMaterialRef        = useRef<THREE.PointsMaterial | null>(null);
  const tFlowerMaterialRef     = useRef<THREE.PointsMaterial | null>(null);
  const tFlowerMaterial2Ref    = useRef<THREE.PointsMaterial | null>(null);
  // Ground flora — bloom-driven flowers + grow-driven herbs
  const gFlowerPetalGeomRef   = useRef<THREE.BufferGeometry | null>(null);
  const gFlowerCenterGeomRef  = useRef<THREE.BufferGeometry | null>(null);
  const gHerbExtraGeomRef     = useRef<THREE.BufferGeometry | null>(null);
  const gFlowerPetalMatRef    = useRef<THREE.PointsMaterial | null>(null);
  const gFlowerCenterMatRef   = useRef<THREE.PointsMaterial | null>(null);
  // Wild microflower pool — grow-driven, always visible regardless of foliage mode
  const gWildGeomRef          = useRef<THREE.BufferGeometry | null>(null);
  const gWildMatRef           = useRef<THREE.PointsMaterial | null>(null);
  // Vertical stem plants near base — grow-driven height AND count
  const gStemGeomRef          = useRef<THREE.BufferGeometry | null>(null);
  const gStemTopGeomRef       = useRef<THREE.BufferGeometry | null>(null);
  const gStemMatRef           = useRef<THREE.PointsMaterial | null>(null);
  const gStemTopMatRef        = useRef<THREE.PointsMaterial | null>(null);
  
  // Smooth color transition targets (updated when props change, lerped in animate loop)
  const targetStemColorRef   = useRef<THREE.Color | null>(null);
  const targetLeafColorRef   = useRef<THREE.Color | null>(null);
  const targetCenterColorRef = useRef<THREE.Color | null>(null);

  // Prop refs for animation-loop closure
  const thicknessRateRef     = useRef(thicknessRate);
  const leafDensityRef       = useRef(leafDensity);
  const growthParamsRef      = useRef(growthParams);
  const growthModeRef        = useRef(growthMode);
  const naturalnessRef       = useRef(naturalness);
  const splitLevelRef        = useRef(splitLevel);
  const foliageModeRef       = useRef(foliageMode);
  const leafShapeRef         = useRef(leafShape);
  const growSpeedRef         = useRef(growSpeed);
  const paramRangesRef       = useRef(paramRanges);
  const pointSizeRef         = useRef(pointSize);
  const stemColorRef         = useRef(stemColor);
  const leafColorRef         = useRef(leafColor);
  const stemOpacityRef       = useRef(stemOpacity);
  const leafOpacityRef       = useRef(leafOpacity);
  const terrainColorRef      = useRef(terrainColor);
  const terrainOpacityRef    = useRef(terrainOpacity);
  const terrainDensityRef    = useRef(terrainDensity);
  const flowerCenterColorRef = useRef(flowerCenterColor);

  // ── paramT: control interpolation position [0–1] per param, species-agnostic ──
  // This is the SOURCE OF TRUTH for all non-grow controls. It never changes when
  // the tree type changes; only user input (scroll / button) mutates it.
  // The actual engine param = lo + paramT * (hi - lo) and is re-derived whenever
  // paramT or paramRanges change, so the bar never jumps on species switch.
  const paramTRef = useRef({ wobble: 0.5, gravity: 0.5, bloom: 0 });

  const applyParamTToEngine = useCallback((ranges: typeof paramRanges) => {
    const eng = engineRef.current;
    if (!eng) return;
    const t = paramTRef.current;
    eng.growthParams.wobble  = ranges.wobble[0]  + t.wobble  * (ranges.wobble[1]  - ranges.wobble[0]);
    eng.growthParams.gravity = ranges.gravity[0] + t.gravity * (ranges.gravity[1] - ranges.gravity[0]);
    eng.bloomLevel = Math.max(0, Math.min(ranges.bloom[1], t.bloom * ranges.bloom[1]));
  }, []);

  const autoGrowRef = useRef(autoGrow);
  useEffect(() => { autoGrowRef.current = autoGrow; }, [autoGrow]);

  // Breath / grow state — simplified: now all modes use paramButtonHeldRef
  // (burst/charge mechanic removed; grow is symmetric with other params)
  const paramButtonHeldRef = useRef(false);
  const paramButtonDecRef  = useRef(false); // mobile − button: decrease direction
  const paramLastReported  = useRef({ held: false, level: 0.5 });

  // ── Restart ──────────────────────────────────────────────────────────────────
  const handleRestart = useCallback(() => {
    const eng = new TreeEngine();
    eng.leafDensity  = leafDensityRef.current;
    eng.growthParams = { ...growthParamsRef.current };
    eng.naturalness  = naturalnessRef.current;
    eng.splitLevel   = splitLevelRef.current;
    eng.foliageMode  = foliageModeRef.current;
    eng.leafShape    = leafShapeRef.current;
    eng.growthMode   = growthModeRef.current;
    engineRef.current = eng;
  }, []);
  useEffect(() => { onRestart.current = handleRestart; }, [handleRestart, onRestart]);

  // ── Grow press / release — unified for all modes ──────────────────────────
  const startGrow = useCallback(() => {
    paramButtonHeldRef.current = true;
  }, []);

  const stopGrow = useCallback(() => {
    paramButtonHeldRef.current = false;
  }, []);
  useEffect(() => {
    onGrowPress.current   = startGrow;
    onGrowRelease.current = stopGrow;
  }, [startGrow, stopGrow, onGrowPress, onGrowRelease]);

  const startDec = useCallback(() => { paramButtonDecRef.current = true;  }, []);
  const stopDec  = useCallback(() => { paramButtonDecRef.current = false; }, []);
  useEffect(() => {
    onParamDecPress.current   = startDec;
    onParamDecRelease.current = stopDec;
  }, [startDec, stopDec, onParamDecPress, onParamDecRelease]);

  // ── Prop → ref + material sync ───────────────────────────────────────────────
  useEffect(() => { thicknessRateRef.current = thicknessRate; }, [thicknessRate]);

  useEffect(() => {
    leafDensityRef.current = leafDensity;
    if (engineRef.current) engineRef.current.leafDensity = leafDensity;
  }, [leafDensity]);

  useEffect(() => {
    growthParamsRef.current = growthParams;
    if (engineRef.current) engineRef.current.growthParams = { ...growthParams };
  }, [growthParams]);

  useEffect(() => {
    growthModeRef.current = growthMode;
    if (engineRef.current) engineRef.current.growthMode = growthMode;
  }, [growthMode]);

  useEffect(() => {
    naturalnessRef.current = naturalness;
    if (engineRef.current) engineRef.current.naturalness = naturalness;
  }, [naturalness]);

  useEffect(() => {
    splitLevelRef.current = splitLevel;
    if (engineRef.current) engineRef.current.splitLevel = splitLevel;
  }, [splitLevel]);

  useEffect(() => {
    foliageModeRef.current = foliageMode;
    leafShapeRef.current   = leafShape;
    if (engineRef.current) {
      engineRef.current.foliageMode = foliageMode;
      engineRef.current.leafShape   = leafShape;
      engineRef.current.leaves = [];
    }
  }, [foliageMode, leafShape]);

  useEffect(() => {
    growSpeedRef.current   = growSpeed;
    paramRangesRef.current = paramRanges;
    // When species changes, keep paramT fixed and re-derive engine params from it.
    // This way the bar stays where the user left it but the tree feels the new range.
    applyParamTToEngine(paramRanges);
  }, [growSpeed, paramRanges, applyParamTToEngine]);

  useEffect(() => {
    pointSizeRef.current = pointSize;
    if (stemMaterialRef.current)         stemMaterialRef.current.size         = pointSize;
    if (petioleMaterialRef.current)      petioleMaterialRef.current.size      = pointSize * 0.8;
    if (leafMaterialRef.current)         leafMaterialRef.current.size         = pointSize * 1.3;
    if (flowerCenterMaterialRef.current) flowerCenterMaterialRef.current.size = pointSize * 1.1;
    // terrain & herb use sizeAttenuation=false (fixed pixels), no update needed
  }, [pointSize]);

  useEffect(() => {
    stemColorRef.current = stemColor;
    // Update smooth target instead of setting material directly
    targetStemColorRef.current?.set(stemColor);
  }, [stemColor]);

  useEffect(() => {
    leafColorRef.current = leafColor;
    targetLeafColorRef.current?.set(leafColor);
    if (gFlowerPetalMatRef.current) gFlowerPetalMatRef.current.color.set(leafColor);
  }, [leafColor]);

  useEffect(() => {
    stemOpacityRef.current = stemOpacity;
    if (stemMaterialRef.current)    stemMaterialRef.current.opacity    = stemOpacity;
    if (petioleMaterialRef.current) petioleMaterialRef.current.opacity = stemOpacity;
  }, [stemOpacity]);

  useEffect(() => {
    leafOpacityRef.current = leafOpacity;
    if (leafMaterialRef.current)         leafMaterialRef.current.opacity         = leafOpacity;
    if (flowerCenterMaterialRef.current) flowerCenterMaterialRef.current.opacity = leafOpacity;
  }, [leafOpacity]);

  useEffect(() => {
    terrainColorRef.current = terrainColor;
    if (terrainMaterialRef.current) terrainMaterialRef.current.color.set(terrainColor);
  }, [terrainColor]);

  useEffect(() => {
    terrainOpacityRef.current = terrainOpacity;
    if (terrainMaterialRef.current) terrainMaterialRef.current.opacity = terrainOpacity;
  }, [terrainOpacity]);

  useEffect(() => {
    flowerCenterColorRef.current = flowerCenterColor;
    targetCenterColorRef.current?.set(flowerCenterColor);
    if (gFlowerCenterMatRef.current) gFlowerCenterMatRef.current.color.set(flowerCenterColor);
  }, [flowerCenterColor]);

  useEffect(() => {
    terrainDensityRef.current = terrainDensity;
    if (terrainGeomRef.current) {
      const pts = generateTerrainPoints(terrainDensity);
      terrainGeomRef.current.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      terrainGeomRef.current.computeBoundingSphere();
    }
  }, [terrainDensity]);

  useEffect(() => {
    if (tFlowerMaterialRef.current && terrainFlowerColors.length > 0) {
      tFlowerMaterialRef.current.color.set(terrainFlowerColors[0]);
    }
    if (tFlowerMaterial2Ref.current && terrainFlowerColors.length > 1) {
      tFlowerMaterial2Ref.current.color.set(terrainFlowerColors[1]);
    }
  }, [terrainFlowerColors]);

  // ── Main Three.js setup (runs once) ─────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BG_COLOR);
    // Atmospheric fog: tighter — cuts off quickly to show less terrain
    scene.fog = new THREE.Fog(BG_COLOR, 8, 18);

    const w = container.clientWidth, h = container.clientHeight;
    const camera = new THREE.PerspectiveCamera(42, w / h, 0.01, 200);
    // Ligeramente elevada para una vista más aérea y acogedora
    camera.position.set(0, 3.5, 10);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.sortObjects = true;  // respect renderOrder for proper layer ordering
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 5, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 2;
    controls.maxDistance = 22;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.3;
    controls.enableRotate = true;   // drag de ratón gira la escena
    controls.enablePan = false;
    controls.maxPolarAngle = Math.PI * 0.82; // no bajar de la línea de tierra
    // Middle-click drag also rotates (same as left-click drag)
    controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;
    controls.update();

    const circleTex = createCircleTexture();

    // Engine
    const engine = new TreeEngine();
    engine.leafDensity  = leafDensityRef.current;
    engine.growthParams = { ...growthParamsRef.current };
    engine.naturalness  = naturalnessRef.current;
    engine.splitLevel   = splitLevelRef.current;
    engine.foliageMode  = foliageModeRef.current;
    engine.leafShape    = leafShapeRef.current;
    engine.growthMode   = growthModeRef.current;
    engineRef.current   = engine;

    // Initialize paramT from engine's initial params relative to the current species ranges.
    {
      const r = paramRangesRef.current;
      paramTRef.current = {
        wobble:  r.wobble[1]  > r.wobble[0]  ? (engine.growthParams.wobble  - r.wobble[0])  / (r.wobble[1]  - r.wobble[0])  : 0.5,
        gravity: r.gravity[1] > r.gravity[0] ? (engine.growthParams.gravity - r.gravity[0]) / (r.gravity[1] - r.gravity[0]) : 0.5,
        bloom:   0,
      };
    }

    // Materials — perspective-attenuated (world-space size, shrinks with distance)
    const mkMat = (color: string, size: number, opacity: number, depthWrite = false) =>
      new THREE.PointsMaterial({
        color: new THREE.Color(color), size, map: circleTex,
        transparent: true, opacity, depthWrite,
        alphaTest: 0.5,
        depthTest: true,
        sizeAttenuation: true, blending: THREE.NormalBlending,
      });

    // Fixed screen-space size (pixels) — same size at any camera distance
    const mkMatFlat = (color: string, sizePx: number, opacity: number, depthWrite = false) =>
      new THREE.PointsMaterial({
        color: new THREE.Color(color), size: sizePx, map: circleTex,
        transparent: true, opacity, depthWrite,
        alphaTest: 0.5,
        depthTest: true,
        sizeAttenuation: false, blending: THREE.NormalBlending,
      });

    const ps = pointSizeRef.current;
    // Stem/trunk: depthWrite ON — these are opaque and should occlude foliage behind them
    const stemMat    = mkMat(stemColorRef.current, ps,        stemOpacityRef.current, true);
    const petioleMat = mkMat(stemColorRef.current, ps * 0.8,  stemOpacityRef.current, true);
    // Foliage: depthWrite OFF — they're transparent layers that blend on top
    const leafMat    = mkMat(leafColorRef.current, ps * 1.3,  leafOpacityRef.current, false);
    const centerMat  = mkMat(flowerCenterColorRef.current, ps * 1.1, leafOpacityRef.current, false);
    // Terrain: fixed pixel size so dots stay same size regardless of camera distance
    const terrainMat = mkMatFlat(terrainColorRef.current, 3.0, terrainOpacityRef.current, true);

    stemMaterialRef.current         = stemMat;
    petioleMaterialRef.current      = petioleMat;
    leafMaterialRef.current         = leafMat;
    flowerCenterMaterialRef.current = centerMat;
    terrainMaterialRef.current      = terrainMat;

    // Point clouds — renderOrder controls draw order for transparent layers
    const stemGeom    = new THREE.BufferGeometry();
    const petioleGeom = new THREE.BufferGeometry();
    const leafGeom    = new THREE.BufferGeometry();
    const centerGeom  = new THREE.BufferGeometry();

    const stemPoints    = new THREE.Points(stemGeom,    stemMat);
    const petiolePoints = new THREE.Points(petioleGeom, petioleMat);
    const leafPoints    = new THREE.Points(leafGeom,    leafMat);
    const centerPoints  = new THREE.Points(centerGeom,  centerMat);

    // Opaque layers first (depthWrite: true), then transparent on top
    stemPoints.renderOrder    = 10;  // trunk/branches: solid, writes depth
    petiolePoints.renderOrder = 11;  // petioles: solid, writes depth
    leafPoints.renderOrder    = 20;  // foliage: transparent, reads depth
    centerPoints.renderOrder  = 21;  // flower centers: transparent, on top of petals

    scene.add(stemPoints);
    scene.add(petiolePoints);
    scene.add(leafPoints);
    scene.add(centerPoints);

    // Terrain
    const terrainGeom = new THREE.BufferGeometry();
    terrainGeomRef.current = terrainGeom;
    terrainGeom.setAttribute('position', new THREE.BufferAttribute(generateTerrainPoints(terrainDensityRef.current), 3));
    const terrainPoints = new THREE.Points(terrainGeom, terrainMat);
    terrainPoints.renderOrder = 0;  // ground renders first
    scene.add(terrainPoints);

    // Herbs
    const herbMat = mkMatFlat('#8aaa78', 2.5, 0.45, true);
    const herbGeom = new THREE.BufferGeometry();
    herbGeom.setAttribute('position', new THREE.BufferAttribute(generateHerbPoints(), 3));
    const herbPoints = new THREE.Points(herbGeom, herbMat);
    herbPoints.renderOrder = 1;
    scene.add(herbPoints);
    herbMaterialRef.current = herbMat;

    // Terrain flowers layer 1
    const tFlowerColor = terrainFlowerColors.length > 0 ? terrainFlowerColors[0] : '#ffffff';
    const tFlowerMat = mkMatFlat(tFlowerColor, 2.0, 1, false);
    const tFlowerGeom = new THREE.BufferGeometry();
    tFlowerGeom.setAttribute('position', new THREE.BufferAttribute(generateTerrainFlowers(), 3));
    const tFlowerPoints = new THREE.Points(tFlowerGeom, tFlowerMat);
    tFlowerPoints.renderOrder = 2;
    scene.add(tFlowerPoints);
    tFlowerMaterialRef.current = tFlowerMat;

    // Terrain flowers layer 2
    let tFlowerMat2: THREE.PointsMaterial | null = null;
    let tFlowerGeom2: THREE.BufferGeometry | null = null;
    if (terrainFlowerColors.length > 1) {
      tFlowerMat2 = mkMatFlat(terrainFlowerColors[1], 1.8, 1, false);
      tFlowerGeom2 = new THREE.BufferGeometry();
      tFlowerGeom2.setAttribute('position', new THREE.BufferAttribute(generateTerrainFlowers(), 3));
      const tFlowerPoints2 = new THREE.Points(tFlowerGeom2, tFlowerMat2);
      tFlowerPoints2.renderOrder = 3;
      scene.add(tFlowerPoints2);
      tFlowerMaterial2Ref.current = tFlowerMat2;
    }

    // Initialize smooth-color targets from initial prop values
    targetStemColorRef.current   = new THREE.Color(stemColorRef.current);
    targetLeafColorRef.current   = new THREE.Color(leafColorRef.current);
    targetCenterColorRef.current = new THREE.Color(flowerCenterColorRef.current);

    // ── Ground flora pools — fixed random positions, generated once ──────────
    // Flowers: bloom-driven. Each entry has all randomness pre-baked so
    // rebuilding the geometry at a new count never causes positional jitter.

    // Spoke-sort: buckets items into N angular sectors sorted near→far, then
    // interleaves. At any count prefix every angular direction is represented equally.
    // This prevents the directional bias that a plain sort-by-noisy-key creates —
    // the phase offsets in multi-octave noise produce systematically lower key values
    // in some directions, so early items all cluster on one side of the trunk.
    const spokeSort = <T extends { x: number; z: number }>(pool: T[], N = 8): T[] => {
      const spokes: T[][] = Array.from({ length: N }, () => []);
      for (const f of pool) {
        const ang = Math.atan2(f.z, f.x);
        const bi  = Math.floor(((ang + Math.PI) / (2 * Math.PI)) * N) % N;
        spokes[bi].push(f);
      }
      for (const sp of spokes)
        sp.sort((a, b) => Math.sqrt(a.x * a.x + a.z * a.z) - Math.sqrt(b.x * b.x + b.z * b.z));
      const out: T[] = [];
      const maxLen = Math.max(...spokes.map(s => s.length));
      for (let i = 0; i < maxLen; i++)
        for (const sp of spokes)
          if (i < sp.length) out.push(sp[i]);
      return out;
    };

    interface GFlower { x: number; z: number; petals: number; r: number; offsets: number[] }
    const GF_POOL = 300;
    const gFlowerPool: GFlower[] = [];
    for (let i = 0; i < GF_POOL; i++) {
      const a = Math.random() * Math.PI * 2;
      const radius = Math.pow(Math.random(), 2.5) * 10;
      const petals = 4 + Math.floor(Math.random() * 5);
      const r = 0.022 + Math.random() * 0.048;
      const offsets: number[] = [];
      for (let p = 0; p < petals; p++) {
        const pa = (p / petals) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
        offsets.push(Math.cos(pa), Math.sin(pa));
      }
      gFlowerPool.push({ x: Math.cos(a) * radius, z: Math.sin(a) * radius, petals, r, offsets });
    }
    // Spoke-sort: flowers always encircle the tree at any count prefix
    Object.assign(gFlowerPool, spokeSort(gFlowerPool));

    // Herbs: grow-driven. Two blade points per clump.
    interface GHerb { x: number; z: number; dx: number; dz: number; h: number }
    const GH_POOL = 400;
    const gHerbPool: GHerb[] = [];
    for (let i = 0; i < GH_POOL; i++) {
      const a = Math.random() * Math.PI * 2;
      const radius = Math.pow(Math.random(), 2.0) * 10;
      gHerbPool.push({
        x: Math.cos(a) * radius, z: Math.sin(a) * radius,
        dx: (Math.random() - 0.5) * 0.06, dz: (Math.random() - 0.5) * 0.06,
        h: 0.04 + Math.random() * 0.055,
      });
    }
    // spokeSort ensures herbs grow outward uniformly in all directions from the trunk
    Object.assign(gHerbPool, spokeSort(gHerbPool));

    const buildGFlowerPts = (count: number): { petals: Float32Array; centers: Float32Array } => {
      const pp: number[] = [], cp: number[] = [];
      const n = Math.min(count, gFlowerPool.length);
      for (let i = 0; i < n; i++) {
        const f = gFlowerPool[i];
        const y = terrainNoise(f.x, f.z);
        cp.push(f.x, y + 0.022, f.z);
        for (let p = 0; p < f.petals; p++) {
          const ox = f.offsets[p * 2], oz = f.offsets[p * 2 + 1];
          pp.push(f.x + ox * f.r,        y + 0.018, f.z + oz * f.r);
          pp.push(f.x + ox * f.r * 0.5,  y + 0.019, f.z + oz * f.r * 0.5);
        }
      }
      return { petals: new Float32Array(pp), centers: new Float32Array(cp) };
    };

    const buildGHerbPts = (count: number): Float32Array => {
      const pts: number[] = [];
      const n = Math.min(count, gHerbPool.length);
      for (let i = 0; i < n; i++) {
        const h = gHerbPool[i];
        const y = terrainNoise(h.x, h.z);
        pts.push(h.x, y + 0.01, h.z);
        pts.push(h.x + h.dx, y + h.h, h.z + h.dz);
      }
      return new Float32Array(pts);
    };

    // Ground flower geometries & materials
    const gFlowerPetalGeom  = new THREE.BufferGeometry();
    const gFlowerCenterGeom = new THREE.BufferGeometry();
    const gHerbExtraGeom    = new THREE.BufferGeometry();
    gFlowerPetalGeom.setAttribute( 'position', new THREE.BufferAttribute(new Float32Array(0), 3));
    gFlowerCenterGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    gHerbExtraGeom.setAttribute(  'position', new THREE.BufferAttribute(new Float32Array(0), 3));

    const gFlowerPetalMat  = mkMat(leafColorRef.current,        ps * 1.6, 0.82, false);
    const gFlowerCenterMat = mkMat(flowerCenterColorRef.current, ps * 1.3, 0.90, false);
    const gHerbExtraMat    = mkMatFlat('#96b080', 2.5, 0.48, true);

    const gFlowerPetalPts  = new THREE.Points(gFlowerPetalGeom,  gFlowerPetalMat);
    const gFlowerCenterPts = new THREE.Points(gFlowerCenterGeom, gFlowerCenterMat);
    const gHerbExtraPts    = new THREE.Points(gHerbExtraGeom,    gHerbExtraMat);
    gFlowerPetalPts.renderOrder  = 5;
    gFlowerCenterPts.renderOrder = 6;
    gHerbExtraPts.renderOrder    = 4;
    scene.add(gFlowerPetalPts);
    scene.add(gFlowerCenterPts);
    scene.add(gHerbExtraPts);

    gFlowerPetalGeomRef.current  = gFlowerPetalGeom;
    gFlowerCenterGeomRef.current = gFlowerCenterGeom;
    gHerbExtraGeomRef.current    = gHerbExtraGeom;
    gFlowerPetalMatRef.current   = gFlowerPetalMat;
    gFlowerCenterMatRef.current  = gFlowerCenterMat;

    // Wild microflower pool — grow-driven, 5 colour sub-pools for variety
    const WILD_COLORS = ['#f5e8b8', '#f0b8c0', '#d0bce8', '#a8d4e8', '#f8d498'];
    const GW_PER = 200;                  // 200 per color × 5 = 1000 total
    const GW_POOL = GW_PER * WILD_COLORS.length;
    type WildFlower = { x: number; z: number; r: number; offsets: number[] };
    const gWildSubPools: WildFlower[][] = WILD_COLORS.map(() => []);

    for (let i = 0; i < GW_POOL; i++) {
      const a = Math.random() * Math.PI * 2;
      const radius = Math.pow(Math.random(), 2.5) * 10;
      const r = 0.01 + Math.random() * 0.016;
      const offsets: number[] = [];
      const petals = 5 + Math.floor(Math.random() * 6);
      for (let p = 0; p < petals; p++) {
        const pa = (p / petals) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
        offsets.push(Math.cos(pa), Math.sin(pa));
      }
      gWildSubPools[i % WILD_COLORS.length].push({
        x: Math.cos(a) * radius, z: Math.sin(a) * radius, r, offsets,
      });
    }
    gWildSubPools.forEach((pool, i) => { gWildSubPools[i] = spokeSort(pool); });

    const buildWildSubPts = (pool: WildFlower[], count: number): Float32Array => {
      const pts: number[] = [];
      const n = Math.min(count, pool.length);
      for (let i = 0; i < n; i++) {
        const f = pool[i];
        const y = terrainNoise(f.x, f.z);
        pts.push(f.x, y + 0.015, f.z);
        for (let p = 0; p < f.offsets.length / 2; p++) {
          const ox = f.offsets[p * 2], oz = f.offsets[p * 2 + 1];
          pts.push(f.x + ox * f.r,       y + 0.018, f.z + oz * f.r);
          pts.push(f.x + ox * f.r * 0.5, y + 0.019, f.z + oz * f.r * 0.5);
        }
      }
      return new Float32Array(pts);
    };

    // Create one geometry + material + Points per color
    const gWildSubGeoms = WILD_COLORS.map(() => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
      return g;
    });
    const gWildSubMats = WILD_COLORS.map(c => mkMat(c, ps * 1.2, 0.82, false));
    gWildSubGeoms.forEach((g, i) => {
      const pts = new THREE.Points(g, gWildSubMats[i]);
      pts.renderOrder = 7;
      scene.add(pts);
    });

    // Keep backward-compat refs pointing to the first sub-pool
    const gWildGeom = gWildSubGeoms[0];
    const gWildMat  = gWildSubMats[0];
    gWildGeomRef.current = gWildGeom;
    gWildMatRef.current  = gWildMat;

    // ── Vertical stem plants — concentrated near trunk base, grow-driven ──���──
    // Each plant renders differently based on type for rich visual variety.
    // Height AND count scale with sizeFill → grow/degrow affects both.
    interface GStemPlant {
      x: number; z: number;
      type: 0 | 1 | 2 | 3 | 4;  // 0=fern, 1=grass fan, 2=bush dome, 3=rosette, 4=daisy
      maxH: number;
      leanX: number; leanZ: number;
      hasTop: boolean;
      rand: number;  // per-plant random seed 0-1
    }
    const GS_POOL = 700;
    const gStemPool: GStemPlant[] = [];
    for (let i = 0; i < GS_POOL; i++) {
      const a = Math.random() * Math.PI * 2;
      const u = Math.random();
      // 65% near base (r<2.5), 35% wider scatter
      const radius = u < 0.65
        ? 0.10 + Math.pow(Math.random(), 1.8) * 2.4
        : 1.5 + Math.pow(Math.random(), 1.5) * 5.5;
      const type = Math.floor(Math.random() * 5) as 0 | 1 | 2 | 3 | 4;
      gStemPool.push({
        x: Math.cos(a) * radius, z: Math.sin(a) * radius,
        type,
        maxH: 0.06 + Math.random() * 0.22,
        leanX: (Math.random() - 0.5) * 0.025,
        leanZ: (Math.random() - 0.5) * 0.025,
        hasTop: Math.random() > 0.35,
        rand: Math.random(),
      });
    }
    // spokeSort ensures stem plants encircle trunk from all angles as count grows
    Object.assign(gStemPool, spokeSort(gStemPool));

    const buildGStemPts = (count: number, fill: number): { stems: Float32Array; tops: Float32Array } => {
      if (fill <= 0 || count <= 0) return { stems: new Float32Array(0), tops: new Float32Array(0) };
      const sp: number[] = [], tp: number[] = [];
      const n = Math.min(count, gStemPool.length);
      for (let i = 0; i < n; i++) {
        const s = gStemPool[i];
        const baseY = terrainNoise(s.x, s.z);
        const h = s.maxH * fill;

        if (s.type === 0) {
          // Fern: vertical spine + lateral frond pairs
          const segs = Math.max(2, Math.round(4 * fill));
          for (let seg = 0; seg <= segs; seg++) {
            const t = seg / segs;
            const sx = s.x + s.leanX * t, sy = baseY + t * h, sz = s.z + s.leanZ * t;
            sp.push(sx, sy, sz);
            if (seg > 0 && seg < segs) {
              const fl = (1 - t) * h * 0.38;
              const px = -s.leanZ * 6 + 0.001, pz = s.leanX * 6;
              const pn = Math.sqrt(px * px + pz * pz) || 1;
              sp.push(sx + (px / pn) * fl, sy - fl * 0.08, sz + (pz / pn) * fl);
              sp.push(sx - (px / pn) * fl, sy - fl * 0.08, sz - (pz / pn) * fl);
              // extra midpoint per frond for more bulk
              sp.push(sx + (px / pn) * fl * 0.5, sy, sz + (pz / pn) * fl * 0.5);
              sp.push(sx - (px / pn) * fl * 0.5, sy, sz - (pz / pn) * fl * 0.5);
            }
          }
        } else if (s.type === 1) {
          // Grass fan: 5-8 arcing blades from same base
          const bladeCount = 5 + Math.floor(s.rand * 4);
          for (let b = 0; b < bladeCount; b++) {
            const angle = (b / bladeCount) * Math.PI * 2 + s.rand;
            const lean = 0.28 + s.rand * 0.45;
            const bPoints = 3 + Math.round(fill * 3);
            for (let p = 0; p <= bPoints; p++) {
              const t = p / bPoints;
              const curve = t * t;
              sp.push(
                s.x + Math.cos(angle) * curve * lean * h,
                baseY + t * h * (1 - curve * 0.35),
                s.z + Math.sin(angle) * curve * lean * h,
              );
            }
          }
        } else if (s.type === 2) {
          // Bush dome: ellipsoidal cluster of points (Fibonacci sphere)
          const dotCount = Math.round(10 + fill * 18);
          const rx = h * 0.62, ry = h * 0.55, rz = h * 0.62;
          for (let d = 0; d < dotCount; d++) {
            const phi   = Math.acos(1 - 2 * (d + 0.5) / dotCount);
            const theta = Math.PI * (1 + Math.sqrt(5)) * d;
            sp.push(
              s.x + rx * Math.sin(phi) * Math.cos(theta),
              baseY + h * 0.35 + ry * (Math.cos(phi) * 0.5 + 0.5),
              s.z + rz * Math.sin(phi) * Math.sin(theta),
            );
          }
        } else if (s.type === 3) {
          // Flat rosette: horizontal oval leaf at ground level + central stem
          const petalCount = 6 + Math.floor(s.rand * 5);
          const lr = h * 0.55;
          for (let p = 0; p < petalCount; p++) {
            const angle = (p / petalCount) * Math.PI * 2;
            for (let dot = 0; dot < 4; dot++) {
              const t = (dot + 0.5) / 4;
              sp.push(
                s.x + Math.cos(angle) * lr * t,
                baseY + 0.01 + dot * 0.007,
                s.z + Math.sin(angle) * lr * t,
              );
            }
          }
          // Central stem
          const stemSegs = Math.round(fill * 3);
          for (let seg = 0; seg <= stemSegs; seg++) {
            sp.push(s.x, baseY + (seg / Math.max(1, stemSegs)) * h * 0.55, s.z);
          }
        } else {
          // Daisy: flat ring of petals + upright stem
          const petalCount = 5 + Math.floor(s.rand * 5);
          const pr = h * 0.34;
          for (let p = 0; p < petalCount; p++) {
            const angle = (p / petalCount) * Math.PI * 2 + s.rand * 0.4;
            sp.push(s.x + Math.cos(angle) * pr,       baseY + 0.015, s.z + Math.sin(angle) * pr);
            sp.push(s.x + Math.cos(angle) * pr * 0.6, baseY + 0.013, s.z + Math.sin(angle) * pr * 0.6);
            sp.push(s.x + Math.cos(angle) * pr * 0.3, baseY + 0.011, s.z + Math.sin(angle) * pr * 0.3);
          }
          // Stem
          const stemSegs = 2 + Math.round(fill * 3);
          for (let seg = 0; seg <= stemSegs; seg++) {
            const t = seg / stemSegs;
            sp.push(s.x + s.leanX * t, baseY + t * h, s.z + s.leanZ * t);
          }
        }

        // Flower cap at tip (types 0, 1, 4)
        if (s.hasTop && fill > 0.10 && s.type !== 2 && s.type !== 3) {
          const topY = baseY + h;
          const r = 0.018 * Math.min(1, fill * 2.2);
          tp.push(s.x, topY + 0.007, s.z);
          const petals = 4 + Math.floor(s.rand * 4);
          for (let p = 0; p < petals; p++) {
            const ang = (p / petals) * Math.PI * 2;
            tp.push(s.x + Math.cos(ang) * r, topY + 0.004, s.z + Math.sin(ang) * r);
            tp.push(s.x + Math.cos(ang) * r * 0.5, topY + 0.006, s.z + Math.sin(ang) * r * 0.5);
          }
