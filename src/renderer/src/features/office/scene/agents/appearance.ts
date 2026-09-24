import type { DistrictId } from '../../campus/districts';
import { districtById } from '../../campus/districts';
import { OFFICE_AGENTS } from '../../data/officeAgents';
import { hashString } from '../../simulation/random';

export type HairStyle =
  | 'short'
  | 'crop'
  | 'side-part'
  | 'buzz'
  | 'bob'
  | 'long'
  | 'ponytail'
  | 'bun'
  | 'curly'
  | 'afro'
  | 'braids'
  | 'wavy'
  | 'bald';

/** What someone wears on top; decides sleeves, layers and small details (hood, tie, collar). */
export type Top = 'tee' | 'shirt' | 'polo' | 'hoodie' | 'blazer' | 'cardigan' | 'suit' | 'vest';

export interface Appearance {
  /** Standing height in metres. Everyone shares one skeleton, scaled. */
  height: number;
  /** Shoulder-width multiplier. */
  build: number;
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  shirt: string;
  /** Outer layer (blazer, cardigan, suit jacket, vest), or none. */
  jacket: string | null;
  trousers: string;
  shoes: string;
  /** Role colour: badge, tie, selection ring and outline. */
  accent: string;
  glasses: boolean;
  top: Top;
  /** Beard colour, or none. */
  beard: string | null;
  headphones: boolean;
}

/** Tops with an outer layer drawn over the shirt. */
export const LAYERED: ReadonlySet<Top> = new Set(['blazer', 'cardigan', 'suit', 'vest']);

type CoreLook = Omit<Appearance, 'top' | 'beard' | 'headphones'> & Partial<Appearance>;
const core = (look: CoreLook): Appearance => ({
  top: look.jacket ? 'blazer' : 'shirt',
  beard: null,
  headphones: false,
  ...look
});

/** The core team, drawn by hand. */
export const APPEARANCES: Readonly<Record<string, Appearance>> = {
  receptionist: core({
    height: 1.67,
    build: 0.93,
    skin: '#e6b996',
    hair: '#7b3f2a',
    hairStyle: 'bun',
    shirt: '#fbfaf6',
    jacket: '#d7385e',
    trousers: '#2f3440',
    shoes: '#3a2a2a',
    accent: '#e11d48',
    glasses: false,
    top: 'cardigan',
    headphones: true
  }),
  'research-analyst': core({
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
  }),
  writer: core({
    height: 1.78,
    build: 1.04,
    skin: '#c89574',
    hair: '#2a211d',
    hairStyle: 'side-part',
    shirt: '#7a5ac8',
    jacket: null,
    trousers: '#34363d',
    shoes: '#5a3d2b',
    accent: '#8b5cf6',
    glasses: true,
    beard: '#2a211d'
  }),
  designer: core({
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
    glasses: false,
    top: 'tee'
  }),
  'product-coach': core({
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
    glasses: false,
    top: 'polo'
  }),
  'knowledge-librarian': core({
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
    glasses: true,
    top: 'cardigan'
  }),
  'files-agent': core({
    height: 1.75,
    build: 1.03,
    skin: '#9a6647',
    hair: '#141110',
    hairStyle: 'crop',
    shirt: '#d7efe2',
    jacket: '#1b8e5e',
    trousers: '#2b3a55',
    shoes: '#1f1f1f',
    accent: '#10b981',
    glasses: false,
    top: 'vest',
    headphones: true
  }),
  'marketing-strategist': core({
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
  }),
  'ops-coordinator': core({
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
    glasses: false,
    beard: '#8a8683'
  })
};

export const FALLBACK_APPEARANCE: Appearance = APPEARANCES['ops-coordinator'];

export interface DressCode {
  tops: Top[];
  /** Colours for the visible top (or outer layer). */
  colours: string[];
  /** Shirts under an outer layer. */
  shirts: string[];
  trousers: string[];
  shoes: string[];
}

/** How each district dresses. */
export const DRESS_CODES: Readonly<Record<DistrictId, DressCode>> = {
  commons: {
    tops: ['shirt', 'blazer', 'cardigan', 'polo'],
    colours: ['#2f5bd3', '#7a5ac8', '#138a80', '#d9a514', '#b07a3a', '#8a5a2b'],
    shirts: ['#f4f6fb', '#fbfaf6'],
    trousers: ['#3b4250', '#2d3440'],
    shoes: ['#1f2328', '#5a3d2b']
  },
  engineering: {
    tops: ['hoodie', 'tee', 'tee', 'polo', 'shirt', 'hoodie'],
    colours: [
      '#27334d',
      '#3a3f47',
      '#9aa1ab',
      '#2f5d3a',
      '#7a2e38',
      '#c99a2e',
      '#1f7a7a',
      '#ece8df',
      '#4a5fc1',
      '#5b7fd9'
    ],
    shirts: ['#f3f1ec', '#dfe6ef'],
    trousers: ['#35507a', '#23272e', '#b8a47e', '#2f3a52'],
    shoes: ['#f2f2f2', '#23272e', '#8a5a35', '#3b4250']
  },
  'ai-data': {
    tops: ['vest', 'shirt', 'tee', 'hoodie'],
    colours: ['#4b5565', '#1f7a7a', '#3f3d9e', '#f3f4f6', '#2b2f36', '#5b7fa6', '#2b8aa3'],
    shirts: ['#f3f4f6', '#dde7f0', '#e7ecef'],
    trousers: ['#2d3440', '#3b4250', '#45506a'],
    shoes: ['#1f2328', '#f2f2f2', '#2b2f36']
  },
  design: {
    tops: ['tee', 'cardigan', 'shirt', 'tee'],
    colours: ['#e76f51', '#d9a514', '#a78bdb', '#2a9d74', '#1f1f24', '#6fb3e0', '#e2559a', '#c94a8a'],
    shirts: ['#fbfaf6', '#f1ece2'],
    trousers: ['#ece7df', '#1f1f24', '#6b705c', '#35507a'],
    shoes: ['#f3f3f3', '#1f1f24', '#c78d64']
  },
  product: {
    tops: ['shirt', 'cardigan', 'polo', 'blazer'],
    colours: ['#a9c6e8', '#f4f6fb', '#9fb8a0', '#27334d', '#d8c7a3', '#8c6fb8', '#7e57c9'],
    shirts: ['#f4f6fb', '#e8eef7'],
    trousers: ['#3b4250', '#c9b79c', '#2d3440'],
    shoes: ['#5a3d2b', '#1f2328', '#8a5a35']
  },
  business: {
    tops: ['shirt', 'blazer', 'polo', 'blazer'],
    colours: ['#f8fafc', '#bcd4ee', '#1f2a44', '#3a3f47', '#6e2433', '#2f5bd3', '#c0602f', '#a8502a'],
    shirts: ['#f8fafc', '#dbe8f6'],
    trousers: ['#1f2a44', '#2c3037', '#4a4f57'],
    shoes: ['#1f1f1f', '#5a3d2b']
  },
  'people-ops': {
    tops: ['cardigan', 'shirt', 'polo', 'cardigan'],
    colours: ['#efe6d6', '#e8b4b8', '#9fb8a0', '#b8a9d9', '#1f7a7a', '#d9a514', '#5f8f58', '#4e7f4a'],
    shirts: ['#fbfaf6', '#f3ede3'],
    trousers: ['#3b4250', '#c9b79c', '#5b5f66'],
    shoes: ['#8a5a35', '#1f2328', '#c78d64']
  },
  leadership: {
    tops: ['suit', 'suit', 'blazer'],
    colours: ['#2e3238', '#1f2a44', '#16181c', '#3a3f47', '#1f4f4a'],
    shirts: ['#ffffff', '#dbe8f6', '#f3f1ec'],
    trousers: ['#2e3238', '#1f2a44', '#16181c'],
    shoes: ['#16181c', '#3b2a22']
  }
};

const SKIN = ['#f3d3b8', '#e9c4a3', '#dcae8c', '#c89574', '#b98262', '#9a6647', '#7a4f35', '#5c3a26'];
const HAIR = [
  '#141110',
  '#2b2220',
  '#3b2a22',
  '#6b4a32',
  '#8a5a35',
  '#b0703a',
  '#c9a26b',
  '#8a8683',
  '#d8d2c8'
];
/** Hairstyles, with rarer looks listed fewer times. */
const STYLES: HairStyle[] = [
  'short',
  'short',
  'crop',
  'side-part',
  'side-part',
  'bob',
  'bob',
  'long',
  'long',
  'ponytail',
  'bun',
  'curly',
  'afro',
  'braids',
  'wavy',
  'wavy',
  'buzz',
  'bald'
];
const NO_BEARD: ReadonlySet<HairStyle> = new Set(['long', 'bun', 'braids', 'ponytail', 'bob']);

/** A small deterministic stream of choices from one seed. */
function chooser(seed: number) {
  let state = seed || 1;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  return {
    next,
    pick: <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)],
    chance: (p: number) => next() < p
  };
}

/** A look for anyone: the same inputs always give the same person. `variant` re-rolls it. */
export function generateAppearance(
  id: string,
  district: DistrictId,
  accent: string,
  variant = 0
): Appearance {
  const rng = chooser(hashString(`${id}:${variant}`));
  const code = DRESS_CODES[district];
  const top = rng.pick(code.tops);
  const colour = rng.pick(code.colours);
  const layered = LAYERED.has(top);
  const hair = rng.pick(HAIR);
  const hairStyle = rng.pick(STYLES);
  const beardAllowed = !NO_BEARD.has(hairStyle);
  return {
    height: 1.55 + rng.next() * 0.35,
    build: 0.9 + rng.next() * 0.2,
    skin: rng.pick(SKIN),
    hair,
    hairStyle,
    shirt: layered ? rng.pick(code.shirts) : colour,
    jacket: layered ? colour : null,
    trousers: rng.pick(code.trousers),
    shoes: rng.pick(code.shoes),
    accent,
    glasses: rng.chance(0.25),
    top,
    beard:
      beardAllowed && rng.chance(0.2)
        ? hairStyle === 'bald' || hairStyle === 'buzz'
          ? rng.pick(HAIR)
          : hair
        : null,
    headphones: rng.chance(district === 'engineering' ? 0.25 : 0.08)
  };
}

/**
 * Everyone's look, decided once: the core team as drawn, specialists generated for their district,
 * re-rolled until nobody in the same pod (four desks, in catalog order) shares hairstyle and colour.
 */
function buildCatalog(): Map<string, Appearance> {
  const looks = new Map<string, Appearance>();
  const pods = new Map<string, string[][]>();
  for (const agent of OFFICE_AGENTS) {
    if (APPEARANCES[agent.id]) {
      looks.set(agent.id, APPEARANCES[agent.id]);
      continue;
    }
    const groups = pods.get(agent.department) ?? [];
    if (!groups.length || groups[groups.length - 1].length === 4) groups.push([]);
    groups[groups.length - 1].push(agent.id);
    pods.set(agent.department, groups);
  }
  const key = (look: Appearance) => `${look.hairStyle}|${look.jacket ?? look.shirt}`;
  for (const groups of pods.values())
    for (const pod of groups) {
      const taken = new Set<string>();
      for (const id of pod) {
        const agent = OFFICE_AGENTS.find((item) => item.id === id)!;
        const accent = districtById(agent.district).color;
        let look = generateAppearance(id, agent.district, accent);
        for (let variant = 1; taken.has(key(look)) && variant < 40; variant++)
          look = generateAppearance(id, agent.district, accent, variant);
        taken.add(key(look));
        looks.set(id, look);
      }
    }
  return looks;
}

let catalog: Map<string, Appearance> | null = null;

/** Stable identities for the full catalog. */
export function appearanceFor(id: string, accent?: string): Appearance {
  catalog ??= buildCatalog();
  const look = catalog.get(id);
  if (look) return accent && !APPEARANCES[id] ? { ...look, accent } : look;
  return generateAppearance(id, 'commons', accent ?? FALLBACK_APPEARANCE.accent);
}
