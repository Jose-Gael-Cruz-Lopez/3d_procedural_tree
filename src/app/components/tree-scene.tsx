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
        }
      }
      return { stems: new Float32Array(sp), tops: new Float32Array(tp) };
    };

    const gStemGeom    = new THREE.BufferGeometry();
    const gStemTopGeom = new THREE.BufferGeometry();
    gStemGeom.setAttribute(   'position', new THREE.BufferAttribute(new Float32Array(0), 3));
    gStemTopGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    const gStemMat    = mkMat('#8aaa78', ps * 1.15, 0.95, true);
    const gStemTopMat = mkMat('#f5d0e0', ps * 1.45, 0.90, false);  // bigger pinkish caps
    const gStemPts    = new THREE.Points(gStemGeom,    gStemMat);
    const gStemTopPts = new THREE.Points(gStemTopGeom, gStemTopMat);
    gStemPts.renderOrder    = 8;
    gStemTopPts.renderOrder = 9;
    scene.add(gStemPts);
    scene.add(gStemTopPts);

    gStemGeomRef.current    = gStemGeom;
    gStemTopGeomRef.current = gStemTopGeom;
    gStemMatRef.current     = gStemMat;
    gStemTopMatRef.current  = gStemTopMat;

    // Ground flora state — smooth float counts + throttled geometry rebuild
    let groundAccum       = 0;
    let smoothGFlower     = 0;   // smoothed float target counts
    let smoothGHerb       = 0;
    let smoothGWild       = 0;
    let smoothGStem       = 0;
    let lastBuiltFlower   = -1;
    let lastBuiltHerb     = -1;
    let lastBuiltWild     = -1;
    let lastBuiltStem     = -1;
    let lastBuiltFill     = -1;  // tracks sizeFill for stem height rebuild

    // Dynamic zoom
    let smoothedCamDist    = 9;
    let userZoomMult       = 1.0;  // modified by hand pinch in camera mode
    let currentMaxDist     = 12;   // tracks farthest auto-zoom
    let pinchZoomOverride  = 0;    // seconds remaining where user pinch overrides auto-zoom
    let lastTime = performance.now();
    let animId   = 0;

    // ── Cinematic camera move on growth completion ──────────────────────────
    // Once the tree finishes growing & blooming, glide at a steady pace to an
    // elevated, pulled-back framing, then settle (user can orbit freely after).
    //   phase 0 = idle, 1 = gliding to final angle, 2 = settled
    let cinePhase    = 0;
    let cineT        = 0;
    const CINE_DUR        = 5.0;                              // seconds — steady glide
    const CINE_TARGET_POL = THREE.MathUtils.degToRad(80);    // polar angle: gently elevated side view
    const CINE_TARGET_RAD = 8;                               // close enough to stay crisp (clear of fog)
    const CINE_SPIN_SPEED = 1.2;                             // turntable speed once settled (~50s per 360°)
    let cineStartPol = 0;
    let cineStartRad = 0;
    let cineAz       = 0;                                    // frozen azimuth — no horizontal swing

    // ── Scroll-wheel state ────────────────────────────────────────────────────
    // Sistema inercial: cada evento acumula velocidad; decae sola sin latch.
    let scrollVelocity = 0;   // unidades/s de param delta

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();

      // ── Scroll horizontal → rotar cámara azimutalmente ──────────────────
      // Umbral estricto: deltaX debe dominar claramente sobre deltaY (×2.5) y
      // superar un mínimo absoluto. En trackpad, un scroll vertical siempre
      // genera algo de deltaX por imprecisión; con un ratio bajo (×0.6) ese
      // ruido lateral ya disparaba la rotación aunque el usuario solo scrolleara.
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) * 2.5 && Math.abs(e.deltaX) > 10) {
        const rotAngle = e.deltaX * 0.004;
        const offset = camera.position.clone().sub(controls.target);
        const quat   = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0), -rotAngle,
        );
        offset.applyQuaternion(quat);
        camera.position.copy(controls.target).add(offset);
        return;
      }

      // ── Ctrl/⌘+Scroll (mouse wheel zoom) o Pinch (trackpad) → zoom ──────
      if (e.ctrlKey || e.metaKey) {
        const factor = e.deltaY > 0 ? 1.06 : 0.945;
        const newDist = Math.max(2, Math.min(13, smoothedCamDist * factor));
        smoothedCamDist = newDist;
        // Persist zoom: adjust userZoomMult so auto-zoom settles at this distance
        const treeH = engineRef.current?.getMaxHeight() ?? 0;
        const baseDist = 5 + Math.max(0, treeH - 0.5) * 0.55;
        userZoomMult = Math.max(0.35, Math.min(1.4, newDist / Math.max(1, baseDist)));
        pinchZoomOverride = 2.0;
        return;
      }

      // ── Param mode: inertial ──────────────────────────────────────────────
      // scroll up (neg deltaY) = increase; scroll down = decrease
      if (Math.abs(e.deltaY) > 2) {
        const SCROLL_SENS = 0.018;
        const SCROLL_MAX  = 2.4;
        const raw    = scrollVelocity - e.deltaY * SCROLL_SENS;
        const target = Math.max(-SCROLL_MAX, Math.min(SCROLL_MAX, raw));
        // Blend suave: la velocidad se acerca gradualmente al target en lugar
        // de saltar bruscamente → rampa de arranque más natural
        scrollVelocity += (target - scrollVelocity) * 0.60;
      }
    };
    container.addEventListener('wheel', handleWheel, { passive: false });

    // ── Native touch pinch-to-zoom (mobile two-finger) ────────────────────────
    let touchPinchStartDist    = 0;
    let touchPinchStartCamDist = smoothedCamDist;
    let touchPinchActive       = false;

    const getTouchDist = (touches: TouchList) => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        touchPinchStartDist    = getTouchDist(e.touches);
        touchPinchStartCamDist = smoothedCamDist;
        touchPinchActive       = true;
      } else {
        touchPinchActive = false;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !touchPinchActive) return;
      e.preventDefault();
      const newDist = getTouchDist(e.touches);
      if (touchPinchStartDist < 1) return;
      // Pinch in (fingers closer) → ratio > 1 → zoom in (reduce cam dist)
      const ratio       = touchPinchStartDist / newDist;
      const newCamDist  = Math.max(2, Math.min(13, touchPinchStartCamDist * ratio));
      smoothedCamDist   = newCamDist;
      const treeH       = engineRef.current?.getMaxHeight() ?? 0;
      const baseDist    = 5 + Math.max(0, treeH - 0.5) * 0.55;
      userZoomMult      = Math.max(0.35, Math.min(1.4, newCamDist / Math.max(1, baseDist)));
      pinchZoomOverride = 2.5;
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) touchPinchActive = false;
    };

    container.addEventListener('touchstart',  handleTouchStart, { passive: true });
    container.addEventListener('touchmove',   handleTouchMove,  { passive: false });
    container.addEventListener('touchend',    handleTouchEnd,   { passive: true });
    container.addEventListener('touchcancel', handleTouchEnd,   { passive: true });

    // Particle sway state
    let swayTime = 0;
    let inertiaX = 0;
    let inertiaZ = 0;
    // Track azimuthal angle around target — zoom changes radius (not angle) so it
    // never affects sway. Only auto-rotation (angle change) drives leaf movement.
    let prevCamAngle = Math.atan2(
      camera.position.x - 0,   // initial target.x = 0
      camera.position.z - 0,   // initial target.z = 0
    );

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const now = performance.now();
      const dt  = Math.min((now - lastTime) / 1000, 0.1);
      lastTime  = now;

      // ── Camera hand control (right hand solo = orbit + zoom) ────────────
      const cc = cameraControl.current;
      // Auto-rotate: drift to gentle spin; PAUSE when camera hand-control is active
      // (to avoid the subtle drift during pinch zoom)
      if (cc.active || cinePhase === 1) {
        // Hand control active, or mid-glide: hold a fixed angle (no spin)
        controls.autoRotate = false;
      } else if (cinePhase === 2) {
        // Settled: slow, steady 360° turntable around the tree
        controls.autoRotate = true;
        controls.autoRotateSpeed = CINE_SPIN_SPEED;
      } else {
        controls.autoRotate = true;
        controls.autoRotateSpeed += (0.3 - controls.autoRotateSpeed) * Math.min(1, 2 * dt);
      }

      if (cc.active) {
        // Zoom only — pinch closed = zoom in, pinch open = zoom out
        const zoomDir  = 0.5 - cc.zoom;
        userZoomMult   = Math.max(0.35, Math.min(1.4,
          userZoomMult * (1 + zoomDir * 0.8 * dt),
        ));
      } else {
        // Slowly return zoom to neutral when no hand
        userZoomMult += (1.0 - userZoomMult) * Math.min(1, 0.5 * dt);
      }

      // ── Smooth color transition ──────────────────────────────────────────
      const ce = 1 - Math.exp(-2.8 * dt);
      if (targetStemColorRef.current) {
        stemMat.color.lerp(targetStemColorRef.current, ce);
        petioleMat.color.lerp(targetStemColorRef.current, ce);
      }
      if (targetLeafColorRef.current)   leafMat.color.lerp(targetLeafColorRef.current, ce);
      if (targetCenterColorRef.current) centerMat.color.lerp(targetCenterColorRef.current, ce);

      // ── Camera inertia for particle sway (angle-based, zoom-immune) ──────
      swayTime += dt;
      const cx = camera.position.x - controls.target.x;
      const cz = camera.position.z - controls.target.z;
      const curAngle = Math.atan2(cx, cz);
      let dAngle = curAngle - prevCamAngle;
      // Wrap to [-π, +π]
      if (dAngle >  Math.PI) dAngle -= 2 * Math.PI;
      if (dAngle < -Math.PI) dAngle += 2 * Math.PI;
      prevCamAngle = curAngle;
      // Angular velocity → tangential inertia muy suave: 0.03 en vez de 0.18
      // Un valor alto hace que las hojas "vuelen" al girar rápido la cámara
      const angVel = dAngle / Math.max(dt, 0.001);
      inertiaX = inertiaX * 0.82 + (-Math.sin(curAngle)) * angVel * 0.03;
      inertiaZ = inertiaZ * 0.82 + ( Math.cos(curAngle)) * angVel * 0.03;

      const mode = growthModeRef.current;
      const eng  = engineRef.current!;

      // Helper: get current param level for ALL modes, NORMALIZADO al rango de la especie.
      // El usuario ve siempre 0–100 independientemente del rango interno.
      const getParamLevel = (): number => {
        if (mode === 'grow') return eng.sizeFill;
        if (mode === 'wobble')  return paramTRef.current.wobble;
        if (mode === 'gravity') return paramTRef.current.gravity;
        if (mode === 'bloom')   return paramTRef.current.bloom;
        return 0;
      };

      // Helper: apply signed delta to the current mode's parameter.
      // Positive delta → increase / grow.  Negative delta → decrease / shrink.
      // Both directions use the same BASE rate (scaled by growSpeed for grow mode).
      const BASE_GROW = 10;
      let energy  = 0;
      // Per-mode sound cooldowns (seconds): grow fires often, bloom is spaced out for softness
      // grow: 80ms → marimba roll feel; bloom: 160ms → chimes shimmer/overlap
      const SOUND_CD: Record<string, number> = { grow: 0.080, wobble: 0.115, gravity: 0.115, bloom: 0.160 };
      const soundCooldown: Record<string, number> = { grow: 0, wobble: 0, gravity: 0, bloom: 0 };
      const applyParamDelta = (delta: number) => {
        const speed  = growSpeedRef.current;
        const ranges = paramRangesRef.current;
        const t      = paramTRef.current;
        if (mode === 'grow') {
          if (delta > 0) {
            energy += delta * BASE_GROW * speed;
            if (soundCooldown.grow <= 0) { SFX.growTick(); soundCooldown.grow = SOUND_CD.grow; }
          } else {
            eng.shrink(Math.abs(delta) * BASE_GROW * speed);
            if (soundCooldown.grow <= 0) { SFX.shrinkTick(); soundCooldown.grow = SOUND_CD.grow; }
          }
        } else if (mode === 'wobble') {
          const prev = t.wobble;
          t.wobble = Math.max(0, Math.min(1, t.wobble + delta));
          eng.growthParams.wobble = ranges.wobble[0] + t.wobble * (ranges.wobble[1] - ranges.wobble[0]);
          if (Math.abs(t.wobble - prev) > 0.001 && soundCooldown.wobble <= 0) {
            delta > 0 ? SFX.paramTick('wobble') : SFX.paramDownTick('wobble');
            soundCooldown.wobble = SOUND_CD.wobble;
          }
        } else if (mode === 'gravity') {
          const prev = t.gravity;
          t.gravity = Math.max(0, Math.min(1, t.gravity + delta));
          eng.growthParams.gravity = ranges.gravity[0] + t.gravity * (ranges.gravity[1] - ranges.gravity[0]);
          if (Math.abs(t.gravity - prev) > 0.001 && soundCooldown.gravity <= 0) {
            delta > 0 ? SFX.paramTick('gravity') : SFX.paramDownTick('gravity');
            soundCooldown.gravity = SOUND_CD.gravity;
          }
        } else if (mode === 'bloom') {
          const prev = t.bloom;
          t.bloom = Math.max(0, Math.min(1, t.bloom + delta));
          eng.bloomLevel = Math.max(0, Math.min(ranges.bloom[1], t.bloom * ranges.bloom[1]));
          if (Math.abs(t.bloom - prev) > 0.001 && soundCooldown.bloom <= 0) {
            delta > 0 ? SFX.paramTick('bloom') : SFX.paramDownTick('bloom');
            soundCooldown.bloom = SOUND_CD.bloom;
          }
        }
      };

      // Button held → continuously increase/decrease current param (all modes)
      if (paramButtonHeldRef.current) {
        applyParamDelta(0.22 * dt);
      }
      if (paramButtonDecRef.current) {
        applyParamDelta(-0.22 * dt);
      }

      // Auto-grow: drive grow to 100%; bloom starts at 50%
      if (autoGrowRef.current) {
        if (eng.sizeFill < 1.0) {
          energy += 0.22 * dt * BASE_GROW * growSpeedRef.current;
          if (soundCooldown.grow <= 0) { SFX.growTick(); soundCooldown.grow = SOUND_CD.grow; }
        }
        if (eng.sizeFill >= 0.5 && paramTRef.current.bloom < 1.0) {
          const ranges = paramRangesRef.current;
          const t = paramTRef.current;
          const prev = t.bloom;
          t.bloom = Math.min(1, t.bloom + 0.22 * dt);
          eng.bloomLevel = Math.max(0, Math.min(ranges.bloom[1], t.bloom * ranges.bloom[1]));
          if (Math.abs(t.bloom - prev) > 0.001 && soundCooldown.bloom <= 0) {
            SFX.paramTick('bloom');
            soundCooldown.bloom = SOUND_CD.bloom;
          }
        }
        if (eng.sizeFill >= 1.0 && paramTRef.current.bloom >= 1.0 && paramTRef.current.wobble < 0.8) {
          const ranges = paramRangesRef.current;
          const t = paramTRef.current;
          const prev = t.wobble;
          t.wobble = Math.min(0.8, t.wobble + 0.22 * dt);
          eng.growthParams.wobble = ranges.wobble[0] + t.wobble * (ranges.wobble[1] - ranges.wobble[0]);
          if (Math.abs(t.wobble - prev) > 0.001 && soundCooldown.wobble <= 0) {
            SFX.paramTick('wobble');
            soundCooldown.wobble = SOUND_CD.wobble;
          }
        }
      }

      // ── Hand openness → param control ────────────────────────────────────
      // This is the primary driver when camera mode is active:
      // right hand pinch open = increase, closed = decrease
      {
        const ho = handOpenness.current;
        if (ho >= 0) {
          const DEAD_LO = 0.20, DEAD_HI = 0.45;
          const HAND_SPEED = 0.38;
          if (ho > DEAD_HI) {
            applyParamDelta( HAND_SPEED * dt * (ho - DEAD_HI) / (1 - DEAD_HI));
          } else if (ho < DEAD_LO) {
            applyParamDelta(-HAND_SPEED * dt * (DEAD_LO - ho) / DEAD_LO);
          }
        }
      }

      // Decay per-mode sound cooldowns
      for (const k in soundCooldown) { if (soundCooldown[k] > 0) soundCooldown[k] -= dt; }

      // ── Scroll inertia: accumulated velocity decays naturally ─────────────
      if (Math.abs(scrollVelocity) > 0.0003) {
        applyParamDelta(scrollVelocity * dt);
        scrollVelocity *= 0.75;
      } else {
        scrollVelocity = 0;
      }

      eng.update(dt, thicknessRateRef.current, energy);

      // ── Ground flora update — smooth lerp per frame, geometry rebuild on integer change ──
      {
        const curBloom = eng.bloomLevel;
        const curGrow  = eng.sizeFill;

        // Bloom flowers: only when foliageMode !== 'leaves', driven by bloom×grow combined
        const showBloomFlowers = foliageModeRef.current !== 'leaves';
        const bloomSignal = showBloomFlowers && curBloom > 0.06
          ? Math.pow(Math.max(0, (curBloom - 0.06) / 0.94), 1.1) * Math.pow(Math.max(0, curGrow), 0.4)
          : 0;
        const targetGF = bloomSignal * GF_POOL;

        // Herbs and wild: always, purely grow-driven
        const targetGH = Math.pow(Math.max(0, curGrow), 0.65) * GH_POOL;
        const targetGW = Math.pow(Math.max(0, curGrow), 0.55) * GW_POOL;
        const targetGS = Math.pow(Math.max(0, curGrow), 0.55) * GS_POOL;

        // Lerp smoothly: slower to appear (organic feel), faster to disappear
        const alphaF = 1 - Math.exp(-(targetGF > smoothGFlower ? 1.2 : 3.0) * dt);
        const alphaH = 1 - Math.exp(-(targetGH > smoothGHerb  ? 1.8 : 3.5) * dt);
        const alphaW = 1 - Math.exp(-(targetGW > smoothGWild  ? 1.5 : 3.0) * dt);
        const alphaS = 1 - Math.exp(-(targetGS > smoothGStem  ? 1.5 : 3.0) * dt);
        smoothGFlower += (targetGF - smoothGFlower) * alphaF;
        smoothGHerb   += (targetGH - smoothGHerb)   * alphaH;
        smoothGWild   += (targetGW - smoothGWild)    * alphaW;
        smoothGStem   += (targetGS - smoothGStem)    * alphaS;

        // Rebuild geometry only when integer count changes; throttle min 50ms
        groundAccum += dt;
        if (groundAccum >= 0.05) {
          groundAccum = 0;
          const fc = Math.round(smoothGFlower);
          const hc = Math.round(smoothGHerb);
          const wc = Math.round(smoothGWild);
          const sc = Math.round(smoothGStem);
          if (fc !== lastBuiltFlower) {
            lastBuiltFlower = fc;
            const { petals: gp, centers: gc } = buildGFlowerPts(fc);
            gFlowerPetalGeom.setAttribute( 'position', new THREE.BufferAttribute(gp, 3));
            gFlowerCenterGeom.setAttribute('position', new THREE.BufferAttribute(gc, 3));
            if (gp.length) gFlowerPetalGeom.computeBoundingSphere();
            if (gc.length) gFlowerCenterGeom.computeBoundingSphere();
          }
          if (hc !== lastBuiltHerb) {
            lastBuiltHerb = hc;
            const gh = buildGHerbPts(hc);
            gHerbExtraGeom.setAttribute('position', new THREE.BufferAttribute(gh, 3));
            if (gh.length) gHerbExtraGeom.computeBoundingSphere();
          }
          if (wc !== lastBuiltWild) {
            lastBuiltWild = wc;
            const perPool = Math.round(wc / WILD_COLORS.length);
            gWildSubGeoms.forEach((g, i) => {
              const gw = buildWildSubPts(gWildSubPools[i], perPool);
              g.setAttribute('position', new THREE.BufferAttribute(gw, 3));
              if (gw.length) g.computeBoundingSphere();
            });
          }
          // Stem rebuild: triggered by count change OR fill change (height rescales)
          if (sc !== lastBuiltStem || Math.abs(curGrow - lastBuiltFill) > 0.02) {
            lastBuiltStem = sc;
            lastBuiltFill = curGrow;
            const { stems: gs, tops: gt } = buildGStemPts(sc, curGrow);
            gStemGeom.setAttribute(   'position', new THREE.BufferAttribute(gs, 3));
            gStemTopGeom.setAttribute('position', new THREE.BufferAttribute(gt, 3));
            if (gs.length) gStemGeom.computeBoundingSphere();
            if (gt.length) gStemTopGeom.computeBoundingSphere();
          }
        }
      }

      // ── Bloom opacity: no fade — bloom controls flower COUNT, not transparency.
      // The previous bloomFade (down to ×0.28) was causing petals/blades to become
      // nearly invisible at high bloom while the petiole (which used stemOpacity as
      // base) stayed visible, giving the "only the stem remains" appearance.
      {
        leafMat.opacity    = leafOpacityRef.current;
        centerMat.opacity  = leafOpacityRef.current;
        petioleMat.opacity = stemOpacityRef.current;
      }

      // Report param level for ALL modes (including grow)
      {
        const level = getParamLevel();
        const held  = paramButtonHeldRef.current;
        const prev  = paramLastReported.current;
        if (Math.abs(level - prev.level) > 0.004 || held !== prev.held) {
          paramLastReported.current = { held, level };
          onParamLevelChange.current?.(held, level);
        }
      }

      // Always report grow fill (for the grow size bar)
      onGrowFillChange.current?.(eng.sizeFill);

      // Upload geometries — apply particle sway to foliage layers
      const sp = eng.getStemPoints();
      stemGeom.setAttribute('position', new THREE.BufferAttribute(sp, 3));
      stemGeom.computeBoundingSphere();

      const pp = eng.getLeafPetiolePoints();
      const ppS = applySway(pp, swayTime, inertiaX * 0.5, inertiaZ * 0.5, 0.7);
      petioleGeom.setAttribute('position', new THREE.BufferAttribute(ppS, 3));
      if (ppS.length) petioleGeom.computeBoundingSphere();

      const lp = eng.getLeafBladePoints();
      const lpS = applySway(lp, swayTime, inertiaX, inertiaZ, 1.0);
      leafGeom.setAttribute('position', new THREE.BufferAttribute(lpS, 3));
      if (lpS.length) leafGeom.computeBoundingSphere();

      const cp = eng.getFlowerCenterPoints();
      const cpS = applySway(cp, swayTime, inertiaX, inertiaZ, 1.0);
      centerGeom.setAttribute('position', new THREE.BufferAttribute(cpS, 3));
      if (cpS.length) centerGeom.computeBoundingSphere();

      // Dynamic zoom — centro de órbita a ¾ de la altura del árbol
      const treeHeight = eng.getMaxHeight();
      // Auto-zoom sutil: crece solo 0.5 u. por unidad de altura
      const baseTarget = 5 + Math.max(0, treeHeight - 0.5) * 0.55;
      // Hard cap so auto-zoom never exceeds the manual-pinch max
      currentMaxDist = Math.min(baseTarget * userZoomMult, 13);
      // Órbita punto medio — árbol centrado-bajo en pantalla
      const targetY = treeHeight > 0.5 ? treeHeight * 0.65 + 0.8 : 1.2;
      // Auto-zoom unless user is actively pinching
      if (pinchZoomOverride > 0) {
        pinchZoomOverride = Math.max(0, pinchZoomOverride - dt);
      } else {
        smoothedCamDist += (currentMaxDist - smoothedCamDist) * dt * 0.5;
        smoothedCamDist = Math.min(smoothedCamDist, 13); // hard cap
      }
      const camDir = camera.position.clone().sub(controls.target).normalize();
      camera.position.copy(controls.target).addScaledVector(camDir, smoothedCamDist);
      // Seguimiento suave del centro de órbita (lerp lento para no ser brusco)
      controls.target.y += (targetY - controls.target.y) * Math.min(1, dt * 0.8);

      controls.update();
      renderer.render(scene, camera);
    };

    animate();

    const onResize = () => {
      const rw = container.clientWidth, rh = container.clientHeight;
      camera.aspect = rw / rh;
      camera.updateProjectionMatrix();
      renderer.setSize(rw, rh);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(container);

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('touchstart',  handleTouchStart);
      container.removeEventListener('touchmove',   handleTouchMove);
      container.removeEventListener('touchend',    handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
      circleTex.dispose();
      [stemMat, petioleMat, leafMat, centerMat, terrainMat, herbMat, tFlowerMat,
        gFlowerPetalMat, gFlowerCenterMat, gHerbExtraMat,
        gStemMat, gStemTopMat, ...gWildSubMats].forEach(m => m.dispose());
      if (tFlowerMat2) tFlowerMat2.dispose();
      [stemGeom, petioleGeom, leafGeom, centerGeom, terrainGeom, herbGeom, tFlowerGeom,
        gFlowerPetalGeom, gFlowerCenterGeom, gHerbExtraGeom,
        gStemGeom, gStemTopGeom, ...gWildSubGeoms].forEach(g => g.dispose());
      if (tFlowerGeom2) tFlowerGeom2.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
      engineRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={containerRef} className="w-full h-full" />;
}

// ── Particle sway helper ────────────────────────────────────────────────────
// Applies height-scaled oscillation + camera-inertia displacement to a point array.
// Returns a new Float32Array so the engine's internal data is never mutated.
function applySway(
  src: Float32Array,
  t: number,
  inertiaX: number,
  inertiaZ: number,
  scale = 1.0,
): Float32Array {
  if (src.length === 0) return src;
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i], y = src[i + 1], z = src[i + 2];
    // Height factor — nothing below y=0.3, grows linearly above
    const hf = Math.max(0, y - 0.3) * 0.014 * scale;
    // Swirl: two independent sine waves for x and z
    const sx = Math.sin(t * 0.72 + y * 2.4 + x * 0.85) * hf;
    const sy = Math.cos(t * 1.15 + x * 1.2  + z * 0.8)  * hf * 0.22; // subtle vertical bob
    const sz = Math.cos(t * 0.88 + y * 1.9  + z * 0.65) * hf;
    // Inertia: higher points trail more when camera moves
    const iy = Math.max(0, y) * 0.07;
    out[i]     = x + sx + inertiaX * iy;
    out[i + 1] = y + sy;
    out[i + 2] = z + sz + inertiaZ * iy;
  }
  return out;
}