import * as THREE from 'three';

/** Warm, light office palette taken from the reference artwork. */
export const PALETTE = {
  floor: '#e8d4b2',
  wall: '#f3efe9',
  wallCap: '#aab3bd',
  slab: '#b9c1ca',
  wood: '#c79c6b',
  woodLight: '#e2c8a0',
  woodDark: '#9f7549',
  white: '#f6f5f2',
  offWhite: '#e9e4db',
  metal: '#c7cbd1',
  darkMetal: '#3b4048',
  black: '#262a30',
  fabricBlue: '#8096ad',
  fabricCream: '#ece5d8',
  fabricGray: '#d4d6d9',
  rug: '#d6d3cd',
  glass: '#d6ebf2',
  bronze: '#9a7a52',
  leaf: '#4c8a47',
  leafLight: '#6aa85a',
  leafDark: '#3d7039',
  pot: '#f0ede7',
  clay: '#c78d64',
  window: '#d3e6f1',
  screenOff: '#1d2530',
  paper: '#fbfaf6'
} as const;

const materials = new Map<string, THREE.MeshStandardMaterial>();

export interface MaterialOptions {
  roughness?: number;
  metalness?: number;
  emissive?: string;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  flat?: boolean;
  map?: THREE.Texture;
  /** Colour comes from the geometry's per-vertex colours (faceted things), tinted by `color`. */
  vertexColors?: boolean;
  /**
   * Pulls the surface toward the camera in the depth test, for things lying just on the floor
   * (rugs, contact shadows): the floors themselves are pulled by 1, so these need more.
   */
  depthPull?: number;
}

/** Shared material per look; building eight people and a whole office reuses these. */
export function mat(color: string, options: MaterialOptions = {}): THREE.MeshStandardMaterial {
  const key = JSON.stringify([
    color,
    options.roughness,
    options.metalness,
    options.emissive,
    options.emissiveIntensity,
    options.transparent,
    options.opacity,
    options.flat,
    options.map?.uuid,
    options.vertexColors,
    options.depthPull
  ]);
  let material = materials.get(key);
  if (!material) {
    material = new THREE.MeshStandardMaterial({
      color,
      roughness: options.roughness ?? 0.82,
      metalness: options.metalness ?? 0,
      emissive: options.emissive ?? '#000000',
      emissiveIntensity: options.emissiveIntensity ?? 1,
      transparent: options.transparent ?? false,
      opacity: options.opacity ?? 1,
      flatShading: options.flat ?? false,
      map: options.map ?? null,
      vertexColors: options.vertexColors ?? false,
      polygonOffset: !!options.depthPull,
      polygonOffsetFactor: -(options.depthPull ?? 0),
      polygonOffsetUnits: -(options.depthPull ?? 0),
      depthWrite: !(options.transparent ?? false)
    });
    materials.set(key, material);
  }
  return material;
}

/** Unit primitives, scaled per use. */
export const GEOMETRY = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 20),
  cone: new THREE.CylinderGeometry(0.34, 0.5, 1, 18),
  sphere: new THREE.SphereGeometry(0.5, 20, 14),
  lowSphere: new THREE.IcosahedronGeometry(0.5, 1),
  capsule: new THREE.CapsuleGeometry(0.5, 1, 6, 14),
  plane: new THREE.PlaneGeometry(1, 1),
  disc: new THREE.CircleGeometry(0.5, 32)
} as const;

type Vec3 = [number, number, number];

/** A mesh from a unit primitive, sized and placed in its parent's frame. */
export function part(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  size: Vec3,
  position: Vec3,
  rotation: Vec3 = [0, 0, 0]
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.scale.set(...size);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export const box = (color: string, size: Vec3, position: Vec3, options?: MaterialOptions) =>
  part(GEOMETRY.box, mat(color, options), size, position);

export const cylinder = (
  color: string,
  radius: number,
  height: number,
  position: Vec3,
  options?: MaterialOptions
) => part(GEOMETRY.cylinder, mat(color, options), [radius * 2, height, radius * 2], position);

// ---------------------------------------------------------------- procedural textures

let floorTexture: THREE.CanvasTexture | null = null;

/** Wide, pale oak planks with quiet joints, drawn once. One tile covers 4 m. */
export function woodFloorTexture(): THREE.CanvasTexture {
  if (floorTexture) return floorTexture;
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  g.fillStyle = PALETTE.floor;
  g.fillRect(0, 0, size, size);
  const rows = 12;
  const rowHeight = size / rows;
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let row = 0; row < rows; row++) {
    let x = -random() * 500;
    while (x < size) {
      const length = 380 + random() * 420;
      const shade = 0.975 + random() * 0.05;
      g.fillStyle = `rgb(${Math.round(232 * shade)}, ${Math.round(212 * shade)}, ${Math.round(178 * shade)})`;
      g.fillRect(x, row * rowHeight, length, rowHeight);
      g.globalAlpha = 0.05;
      g.strokeStyle = '#a57d51';
      for (let grain = 0; grain < 2; grain++) {
        const y = row * rowHeight + rowHeight * (0.25 + random() * 0.5);
        g.beginPath();
        g.moveTo(x, y);
        g.bezierCurveTo(x + length * 0.3, y + 3, x + length * 0.7, y - 3, x + length, y + 1);
        g.stroke();
      }
      g.globalAlpha = 0.25;
      g.fillStyle = '#b08a5f';
      g.fillRect(x, row * rowHeight, 2, rowHeight);
      g.globalAlpha = 1;
      x += length;
    }
    g.fillStyle = 'rgba(150, 115, 78, 0.22)';
    g.fillRect(0, row * rowHeight, size, 1.5);
  }
  floorTexture = new THREE.CanvasTexture(canvas);
  floorTexture.colorSpace = THREE.SRGBColorSpace;
  floorTexture.wrapS = floorTexture.wrapT = THREE.RepeatWrapping;
  floorTexture.anisotropy = 8;
  return floorTexture;
}

export type ScreenFlavor = 'document' | 'data' | 'design' | 'code';
const screenCanvases = new Map<ScreenFlavor, HTMLCanvasElement>();

/** Abstract app UI for laptop and monitor screens: no readable text, just structure. */
export function screenCanvas(flavor: ScreenFlavor): HTMLCanvasElement {
  const cached = screenCanvases.get(flavor);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 320; // twice the visible height, so the content can scroll
  const g = canvas.getContext('2d')!;
  const dark = flavor === 'code';
  g.fillStyle = dark ? '#1c2330' : '#f4f7fb';
  g.fillRect(0, 0, 256, 320);
  g.fillStyle = dark ? '#252e3d' : '#e3e9f2';
  g.fillRect(0, 0, 44, 320);
  const accents: Record<ScreenFlavor, string[]> = {
    document: ['#3b6ff5', '#9aa8bd'],
    data: ['#10a37f', '#3b6ff5', '#f59e0b'],
    design: ['#ec4899', '#8b5cf6', '#f59e0b', '#10b981'],
    code: ['#7dd3fc', '#c4b5fd', '#86efac', '#fca5a5']
  };
  let seed = flavor.length * 97;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let y = 12; y < 320; y += 14) {
    const accent = accents[flavor][Math.floor(random() * accents[flavor].length)];
    if (flavor === 'design' && random() < 0.3) {
      g.fillStyle = accent;
      g.fillRect(56 + random() * 100, y, 30 + random() * 60, 24);
      y += 14;
      continue;
    }
    if (flavor === 'data' && random() < 0.25) {
      for (let bar = 0; bar < 8; bar++) {
        g.fillStyle = accents.data[bar % 3];
        const height = 8 + random() * 26;
        g.fillRect(60 + bar * 22, y + 34 - height, 14, height);
      }
      y += 28;
      continue;
    }
    g.fillStyle = random() < 0.2 ? accent : dark ? '#4b5566' : '#c3cbd8';
    const indent = flavor === 'code' ? 56 + Math.floor(random() * 3) * 12 : 56;
    g.fillRect(indent, y, 40 + random() * (190 - indent), 6);
  }
  for (let y = 10; y < 320; y += 22) {
    g.fillStyle = dark ? '#3a4454' : '#c8d2e0';
    g.fillRect(10, y, 24, 8);
  }
  screenCanvases.set(flavor, canvas);
  return canvas;
}

// ---------------------------------------------------------------- district floors

const floorTextures = new Map<string, THREE.CanvasTexture>();

function canvasTexture(
  key: string,
  size: number,
  draw: (g: CanvasRenderingContext2D, random: () => number) => void
): THREE.CanvasTexture {
  const cached = floorTextures.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  let seed = key.length * 7919 + 17;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  draw(g, random);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  // Floors are seen at a slant: sharper filtering keeps seams and grain crisp into the distance.
  texture.anisotropy = 8;
  floorTextures.set(key, texture);
  return texture;
}

/** Carpet tiles: fine speckle with faint tile seams. Neutral grey; the material tints it. One tile covers 2 m. */
export function carpetTexture(): THREE.CanvasTexture {
  return canvasTexture('carpet', 512, (g, random) => {
    g.fillStyle = '#e4e4e4';
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 5000; i++) {
      const shade = 218 + Math.floor(random() * 37);
      g.fillStyle = `rgb(${shade},${shade},${shade})`;
      g.fillRect(random() * 512, random() * 512, 1.6, 1.6);
    }
    g.fillStyle = 'rgba(120,120,120,0.1)';
    g.fillRect(0, 0, 512, 2);
    g.fillRect(0, 0, 2, 512);
    g.fillRect(0, 255, 512, 1.5);
    g.fillRect(255, 0, 1.5, 512);
  });
}

/** Polished concrete: soft clouds and a few hairline cracks. One tile covers 6 m. */
export function concreteTexture(): THREE.CanvasTexture {
  return canvasTexture('concrete', 512, (g, random) => {
    g.fillStyle = '#e6e3de';
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 70; i++) {
      const x = random() * 512;
      const y = random() * 512;
      const r = 20 + random() * 70;
      const gradient = g.createRadialGradient(x, y, 0, x, y, r);
      const tone = random() < 0.5 ? '255,255,255' : '160,155,148';
      gradient.addColorStop(0, `rgba(${tone},0.12)`);
      gradient.addColorStop(1, `rgba(${tone},0)`);
      g.fillStyle = gradient;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.strokeStyle = 'rgba(120,115,110,0.25)';
    g.lineWidth = 1;
    g.strokeRect(0.5, 0.5, 511, 511);
  });
}

/**
 * Terrazzo: a warm stone base with fine chips close in tone, so from the usual distance the floor
 * reads as clean stone rather than scattered crumbs. One tile covers 3 m.
 */
export function terrazzoTexture(): THREE.CanvasTexture {
  return canvasTexture('terrazzo', 1024, (g, random) => {
    g.fillStyle = '#f1ece4';
    g.fillRect(0, 0, 1024, 1024);
    const chips = ['#ddd0bf', '#c9d0d2', '#e6cbb8', '#d3d8c6', '#cfc9c2', '#f8f1e6'];
    g.globalAlpha = 0.6;
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = chips[Math.floor(random() * chips.length)];
      g.beginPath();
      const x = random() * 1024;
      const y = random() * 1024;
      const r = 0.8 + random() * 2.2;
      g.ellipse(x, y, r, r * (0.5 + random() * 0.6), random() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
  });
}

// ---------------------------------------------------------------- lights the time of day changes

/** Warm lamp shades and bulbs, shared so the scene can turn them up in the evening. */
export const lampGlow = {
  table: () => mat('#fff6e0', { emissive: '#ffd79a', emissiveIntensity: 0.6 }),
  floor: () => mat('#fff4dc', { emissive: '#ffd690', emissiveIntensity: 0.9 }),
  desk: () => mat('#fff3d6', { emissive: '#ffd88f', emissiveIntensity: 0.7 })
};

/** Base glow of each lamp material, before the time of day scales it. */
export const LAMP_BASE: ReadonlyMap<THREE.MeshStandardMaterial, number> = new Map([
  [lampGlow.table(), 0.6],
  [lampGlow.floor(), 0.9],
  [lampGlow.desk(), 0.7]
]);

let skyTexture: THREE.CanvasTexture | null = null;

/** A soft sky in the panes: bright at the top, a touch deeper toward the sill. */
function windowSky(): THREE.CanvasTexture {
  if (skyTexture) return skyTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 128;
  const g = canvas.getContext('2d')!;
  const gradient = g.createLinearGradient(0, 0, 0, 128);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(1, '#bccbd8');
  g.fillStyle = gradient;
  g.fillRect(0, 0, 4, 128);
  skyTexture = new THREE.CanvasTexture(canvas);
  skyTexture.colorSpace = THREE.SRGBColorSpace;
  return skyTexture;
}

/** The window panes on the tall walls; the time of day tints them. */
export const windowGlass = () => {
  const material = mat(PALETTE.window, {
    emissive: '#e8f3fb',
    emissiveIntensity: 0.35,
    roughness: 0.2,
    map: windowSky()
  });
  material.emissiveMap = material.map;
  return material;
};
