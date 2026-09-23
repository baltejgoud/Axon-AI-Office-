export type HairStyle = 'short' | 'bob' | 'bun' | 'ponytail' | 'curly' | 'wavy';

export interface Appearance {
  /** Standing height in metres. Everyone shares one skeleton, scaled. */
  height: number;
  /** Shoulder-width multiplier. */
  build: number;
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  shirt: string;
  /** Open blazer or cardigan over the shirt, or none. */
  jacket: string | null;
  trousers: string;
  shoes: string;
  /** Role colour: badge, selection ring and outline. */
  accent: string;
  glasses: boolean;
}

export const APPEARANCES: Readonly<Record<string, Appearance>> = {
  'research-analyst': {
    height: 1.66,
    build: 0.94,
    skin: '#e9c4a3',
    hair: '#2b2220',
    hairStyle: 'bob',
    shirt: '#f4f6fb',
    jacket: '#2f5bd3',
    trousers: '#3b4250',
    shoes: '#1f2328',
    accent: '#2563eb',
    glasses: false
  },
  writer: {
    height: 1.78,
    build: 1.04,
    skin: '#c89574',
    hair: '#2a211d',
    hairStyle: 'short',
    shirt: '#7a5ac8',
    jacket: null,
    trousers: '#34363d',
    shoes: '#5a3d2b',
    accent: '#8b5cf6',
    glasses: true
  },
  designer: {
    height: 1.62,
    build: 0.92,
    skin: '#b98262',
    hair: '#1c1717',
    hairStyle: 'bun',
    shirt: '#e2559a',
    jacket: null,
    trousers: '#ece7df',
    shoes: '#f3f3f3',
    accent: '#ec4899',
    glasses: false
  },
  'product-coach': {
    height: 1.76,
    build: 1.02,
    skin: '#f0c9a8',
    hair: '#6b4a32',
    hairStyle: 'wavy',
    shirt: '#e8823a',
    jacket: null,
    trousers: '#c9b79c',
    shoes: '#6b4a32',
    accent: '#f97316',
    glasses: false
  },
  'knowledge-librarian': {
    height: 1.68,
    build: 0.95,
    skin: '#7a4f35',
    hair: '#1d1512',
    hairStyle: 'curly',
    shirt: '#eef1ee',
    jacket: '#138a80',
    trousers: '#2d3440',
    shoes: '#2b2b2b',
    accent: '#0d9488',
    glasses: true
  },
  'files-agent': {
    height: 1.75,
    build: 1.03,
    skin: '#9a6647',
    hair: '#141110',
    hairStyle: 'short',
    shirt: '#d7efe2',
    jacket: '#1b8e5e',
    trousers: '#2b3a55',
    shoes: '#1f1f1f',
    accent: '#10b981',
    glasses: false
  },
  'marketing-strategist': {
    height: 1.7,
    build: 0.94,
    skin: '#f1d0b5',
    hair: '#b0703a',
    hairStyle: 'ponytail',
    shirt: '#fbfaf6',
    jacket: '#d9a514',
    trousers: '#f1ece2',
    shoes: '#b88e52',
    accent: '#eab308',
    glasses: false
  },
  'ops-coordinator': {
    height: 1.8,
    build: 1.06,
    skin: '#dcae8c',
    hair: '#8a8683',
    hairStyle: 'short',
    shirt: '#dde6ef',
    jacket: '#56657a',
    trousers: '#2c3037',
    shoes: '#222222',
    accent: '#64748b',
    glasses: false
  }
};

export const FALLBACK_APPEARANCE: Appearance = APPEARANCES['ops-coordinator'];

/** Stable identities for the full catalog, with varied silhouettes and coordinated clothing. */
export function appearanceFor(id: string, accent?: string): Appearance {
  if (APPEARANCES[id]) return APPEARANCES[id];
  let hash = 0;
  for (const letter of id) hash = (Math.imul(hash, 31) + letter.charCodeAt(0)) >>> 0;
  const skin = ['#e9c4a3', '#b98262', '#7a4f35', '#f0c9a8', '#9a6647', '#dcae8c'];
  const hair = ['#2b2220', '#6b4a32', '#141110', '#b0703a', '#555052'];
  const styles: HairStyle[] = ['short', 'bob', 'bun', 'ponytail', 'curly', 'wavy'];
  return {
    ...FALLBACK_APPEARANCE,
    height: 1.65 + (hash % 5) * 0.035,
    build: 0.94 + (hash % 4) * 0.04,
    skin: skin[hash % skin.length],
    hair: hair[(hash >>> 3) % hair.length],
    hairStyle: styles[(hash >>> 5) % styles.length],
    shirt: hash % 2 ? '#f2ede4' : (accent ?? '#3867f6'),
    jacket: hash % 2 ? (accent ?? '#3867f6') : null,
    trousers: hash % 3 ? '#344052' : '#c4b396',
    accent: accent ?? '#3867f6',
    glasses: hash % 3 === 0
  };
}
