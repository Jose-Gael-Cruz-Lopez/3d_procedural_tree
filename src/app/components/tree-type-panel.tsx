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
  WebkitBackdropFilter: 'blur(28px) saturate(120%)',
  border: '1.5px solid rgba(200, 160, 90, 0.20)',
  boxShadow: '0 4px 24px rgba(100, 65, 15, 0.10)',
};

// ── SVG Tree Icons ─────────────────────────────────────────────────────────────
function TreeIcon({ id, color, selected }: { id: string; color: string; selected: boolean }) {
  const s = 22;
  const op = selected ? 1 : 0.72;

  if (id === 'sakura') return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" style={{ opacity: op }}>
      {[0, 72, 144, 216, 288].map(a => (
        <ellipse key={a} cx="12" cy="5" rx="2.7" ry="4.3" fill={color}
          transform={`rotate(${a},12,12)`} />
      ))}
      {[36, 108, 180, 252, 324].map(a => (
        <ellipse key={a} cx="12" cy="5.8" rx="2.0" ry="3.4" fill={color} opacity="0.55"
          transform={`rotate(${a},12,12)`} />
      ))}
      <circle cx="12" cy="12" r="2.2" fill="#f5e060" />
    </svg>
  );

  if (id === 'maple') return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" style={{ opacity: op }}>
      <path d="M12,2.5 L13.8,7.5 L19,6 L16,10.5 L21,12 L16.5,13.5 L18.5,18 L13,15.5 L12,21 L11,15.5 L5.5,18 L7.5,13.5 L3,12 L8,10.5 L5,6 L10.2,7.5 Z"
        fill={color} />
      <line x1="12" y1="19" x2="12" y2="23" stroke={color} strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  );

  if (id === 'wisteria') return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" style={{ opacity: op }}>
      <path d="M4,5 Q12,2.5 20,5" stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round"/>
      {[8, 12, 16].map(x => (
        <line key={x} x1={x} y1="5" x2={x} y2="8" stroke={color} strokeWidth="1.2" strokeLinecap="round"/>
      ))}
      {[[8,9.5],[7.2,12],[8.8,12],[8,14.5],[8.2,17]].map(([x,y],i) => (
        <ellipse key={i} cx={x} cy={y} rx="1.7" ry="1.3" fill={color} opacity={0.9 - i * 0.07}/>
      ))}
      {[[12,8.5],[11.2,11],[12.8,11],[12,13.5],[12,16]].map(([x,y],i) => (
        <ellipse key={i} cx={x} cy={y} rx="1.6" ry="1.25" fill={color} opacity={0.88 - i * 0.07}/>
      ))}
      {[[16,9.5],[15.2,12],[16.8,12],[16,14.5]].map(([x,y],i) => (
        <ellipse key={i} cx={x} cy={y} rx="1.7" ry="1.3" fill={color} opacity={0.85 - i * 0.07}/>
      ))}
    </svg>
  );

  if (id === 'orange') return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" style={{ opacity: op }}>
      <line x1="12" y1="22" x2="12" y2="13" stroke="#6a4a20" strokeWidth="2" strokeLinecap="round"/>
      <ellipse cx="12" cy="10" rx="8" ry="7" fill={color} opacity="0.30"/>
      <ellipse cx="7"  cy="12" rx="4" ry="5" fill={color} opacity="0.25"/>
      <ellipse cx="17" cy="12" rx="4" ry="5" fill={color} opacity="0.25"/>
      <ellipse cx="12" cy="6"  rx="5" ry="4" fill={color} opacity="0.22"/>
      <ellipse cx="12" cy="10" rx="7.5" ry="6.5" fill={color} opacity="0.20"/>
      <circle cx="9"  cy="11" r="2.0" fill="#ff8800" />
      <circle cx="15" cy="13" r="1.8" fill="#ff8800" />
      <circle cx="12" cy="15" r="1.6" fill="#ff9a10" />
    </svg>
  );

  if (id === 'olive') return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" style={{ opacity: op }}>
      <line x1="12" y1="22" x2="12" y2="5" stroke={color} strokeWidth="1.8" strokeLinecap="round" opacity="0.7"/>
      <ellipse cx="8"  cy="9"  rx="5.2" ry="3.0" fill={color} transform="rotate(-28,8,9)"/>
      <ellipse cx="16" cy="13" rx="5.2" ry="3.0" fill={color} opacity="0.88" transform="rotate(28,16,13)"/>
      <ellipse cx="8"  cy="17" rx="4.8" ry="2.8" fill={color} opacity="0.76" transform="rotate(-22,8,17)"/>
    </svg>
  );

  if (id === 'almond') return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" style={{ opacity: op }}>
      {[0, 60, 120, 180, 240, 300].map(a => (
        <ellipse key={a} cx="12" cy="5.5" rx="2.5" ry="4.2"
          fill={color} stroke="rgba(100,65,20,0.45)" strokeWidth="1.0"
          transform={`rotate(${a},12,12)`}/>
      ))}
      <circle cx="12" cy="12" r="2.3" fill="#f5e060" stroke="rgba(120,80,30,0.40)" strokeWidth="0.8"/>
    </svg>
  );

  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" style={{ opacity: op }}>
      <circle cx="12" cy="12" r="8" stroke={color} strokeWidth="1.8" fill="none" strokeDasharray="3 2"/>
      <circle cx="12" cy="12" r="3" fill={color} opacity="0.6"/>
    </svg>
  );
}

// ── Tree pill button ──────────────────────────────────────────────────────────
function TreeButton({ t, isSelected, onSelectType }: {
  t: TreeType; isSelected: boolean; onSelectType: (t: TreeType) => void;
}) {
  return (
    <button
      onClick={() => onSelectType(t)}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
        padding: '8px 12px 7px',
        background: isSelected ? `${t.accentColor}1e` : 'transparent',
        border: 'none', outline: 'none',
        borderRadius: 18, cursor: 'pointer',
        transition: 'background 0.22s ease',
      }}
    >
      <TreeIcon id={t.id} color={t.accentColor} selected={isSelected} />
      <span style={{
        fontSize: '9px', letterSpacing: '0.09em', textTransform: 'uppercase',
        color: isSelected ? TEXT : MUTED,
        lineHeight: 1, whiteSpace: 'nowrap',
        transition: 'color 0.2s',
      }}>
        {t.name}
      </span>
    </button>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────────
interface TreeTypePanelProps {
  selectedType: string;
  onSelectType: (type: TreeType) => void;
  onRestart: () => void;
}

export function TreeTypePanel({ selectedType, onSelectType, onRestart }: TreeTypePanelProps) {
  return (
    <>
      {/* ── Bottom centre: tree type buttons ── */}
      <div
        className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 select-none"
      >
