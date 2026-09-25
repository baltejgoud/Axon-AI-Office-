import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GEOMETRY } from '../room/materials';

/**
 * The shapes a person is built from. Close-up people get enough segments to stay smooth at the
 * closest zoom and in portraits; the instanced crowd, seen from further away, gets a lighter set.
 * Everything is smooth-shaded: hair included, so it reads as hair rather than faceted helmets.
 */
export interface BodyShapes {
  box: THREE.BufferGeometry;
  sphere: THREE.BufferGeometry;
  /** Between the two: shoes, shoulders and knees. */
  mid: THREE.BufferGeometry;
  small: THREE.BufferGeometry;
  cylinder: THREE.BufferGeometry;
  capsule: THREE.BufferGeometry;
  /** Arms and legs: a capsule (three's unit capsule, 2 tall) narrowing toward the hand or foot. */
  limb: THREE.BufferGeometry;
  /** Chest to neck, 1 wide at the chest; scaled by build and depth. Spans y 0 (waist) to 0.47. */
  torso: THREE.BufferGeometry;
  /** Waist to seat, 1 wide; spans y 0.07 to -0.145 around the hip joint. */
  pelvis: THREE.BufferGeometry;
  /** A rounded head with a narrower jaw and a chin, unit sphere proportions (0.5 radius). */
  head: THREE.BufferGeometry;
  /** Hands in metres at the wrist: palm, curled fingers and a thumb. Left hand is on +x. */
  hand: Record<1 | -1, THREE.BufferGeometry>;
  /** Shoe in metres at the ankle: upper, toe and a rounded sole (sole separate for its colour). */
  shoe: THREE.BufferGeometry;
  sole: THREE.BufferGeometry;
  hairCap: THREE.BufferGeometry;
  /** A smooth closed volume for hair masses, buns and beards. */
  hairVolume: THREE.BufferGeometry;
  /** A volume with a curly surface, for curls, afros and waves. */
  curls: THREE.BufferGeometry;
  /** A tapered lock, for ponytails. */
  strand: THREE.BufferGeometry;
  /** A shallow smile, in metres, facing +z. */
  smile: THREE.BufferGeometry;
  /** The shirt showing in a jacket's open front: a triangle pointing down, flat face to +z. */
  vee: THREE.BufferGeometry;
  lens: THREE.BufferGeometry;
  band: THREE.BufferGeometry;
}

/** Drops texture coordinates and welds seams, so normals are smooth all the way round. */
function smooth(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  geometry.deleteAttribute('uv');
  const welded = mergeVertices(geometry, 1e-5);
  welded.computeVertexNormals();
  geometry.dispose();
  return welded;
}

function taperedCapsule(top: number, bottom: number, caps: number, radial: number): THREE.BufferGeometry {
  const geometry = new THREE.CapsuleGeometry(0.5, 1, caps, radial);
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const t = (position.getY(i) + 1) / 2;
    const s = bottom + (top - bottom) * t;
    position.setX(i, position.getX(i) * s);
    position.setZ(i, position.getZ(i) * s);
  }
  return smooth(geometry);
}

/** A closed shape turned around y from a profile of [radius, y] points, bottom to top. */
function lathe(profile: [number, number][], radial: number): THREE.BufferGeometry {
  const points = profile.map(([r, y]) => new THREE.Vector2(r, y));
  return smooth(new THREE.LatheGeometry(points, radial));
}

function headShape(width: number, height: number): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(0.5, width, height);
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const below = Math.max(0, -y / 0.5);
    const front = Math.max(0, z / 0.5);
    // The jaw narrows toward the chin; the chin itself stays forward. The back of the skull is fuller.
    const jaw = 1 - 0.2 * below * below;
    const chin = 1 + 0.08 * below * front;
    const skull = z < 0 ? 1.04 : 1;
    position.setXYZ(i, x * jaw, y, z * chin * skull * (1 - 0.06 * below * below * (1 - front)));
  }
  return smooth(geometry);
}

/** A sphere whose surface rises in round bumps, like tight curls or waves. */
function curlyShape(width: number, height: number, lobes: number, depth: number): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(0.5, width, height);
  const position = geometry.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i);
    const theta = Math.atan2(v.x, v.z);
    const phi = Math.acos(THREE.MathUtils.clamp(v.y / 0.5, -1, 1));
    const bumps =
      0.55 * Math.sin(lobes * theta + 1.3 * phi) * Math.sin(lobes * 0.9 * phi) +
      0.45 * Math.sin((lobes - 2) * theta - 2.1 * phi + 0.7);
    v.multiplyScalar(1 + depth * bumps);
    position.setXYZ(i, v.x, v.y, v.z);
  }
  return smooth(geometry);
}

/** Merges shapes placed by [geometry, scale, position, rotation]; the pieces are welded apart. */
function assemble(
  pieces: [THREE.BufferGeometry, THREE.Vector3Tuple, THREE.Vector3Tuple, THREE.Vector3Tuple?][]
): THREE.BufferGeometry {
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const parts = pieces.map(([geometry, scale, position, rotation = [0, 0, 0]]) => {
    matrix.compose(
      new THREE.Vector3(...position),
      quaternion.setFromEuler(new THREE.Euler(...rotation)),
      new THREE.Vector3(...scale)
    );
    const part = geometry.clone().applyMatrix4(matrix);
    for (const name of Object.keys(part.attributes))
      if (name !== 'position' && name !== 'normal') part.deleteAttribute(name);
    return part.index ? part.toNonIndexed() : part;
  });
  const merged = mergeGeometries(parts)!;
  parts.forEach((part) => part.dispose());
  return merged;
}

/** Palm facing the body, fingers curled a little toward it, thumb forward. */
function handShape(side: 1 | -1, ball: THREE.BufferGeometry, digit: THREE.BufferGeometry, thumb: boolean) {
  const pieces: Parameters<typeof assemble>[0] = [
    [ball, [0.036, 0.074, 0.07], [0, -0.034, 0]],
    [digit, [0.03, 0.026, 0.062], [-side * 0.007, -0.078, 0.002], [0, 0, -side * 0.28]]
  ];
  if (thumb)
    pieces.push([digit, [0.024, 0.02, 0.024], [-side * 0.01, -0.036, 0.034], [-0.75, 0, -side * 0.2]]);
  return assemble(pieces);
}

function build(detail: 'full' | 'low'): BodyShapes {
  const full = detail === 'full';
  const sphere = smooth(full ? new THREE.SphereGeometry(0.5, 14, 10) : new THREE.SphereGeometry(0.5, 10, 7));
  const mid = smooth(full ? new THREE.SphereGeometry(0.5, 10, 7) : new THREE.SphereGeometry(0.5, 6, 4));
  const small = smooth(full ? new THREE.SphereGeometry(0.5, 8, 6) : new THREE.SphereGeometry(0.5, 6, 4));
  const digit = smooth(new THREE.CapsuleGeometry(0.5, 1, 2, full ? 8 : 5));
  const radial = full ? 14 : 10;
  return {
    box: GEOMETRY.box,
    sphere,
    mid,
    small,
    cylinder: full ? new THREE.CylinderGeometry(0.5, 0.5, 1, 12) : new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
    capsule: smooth(new THREE.CapsuleGeometry(0.5, 1, 3, full ? 10 : 8)),
    limb: taperedCapsule(1, 0.8, full ? 3 : 2, full ? 12 : 8),
    torso: lathe(
      [
        [0, 0],
        [0.15, 0.004],
        [0.168, 0.04],
        [0.172, 0.12],
        [0.186, 0.22],
        [0.2, 0.31],
        [0.201, 0.4],
        [0.19, 0.435],
        [0.155, 0.458],
        [0.08, 0.47],
        [0, 0.472]
      ].map(([r, y]) => [r / 0.2, y] as [number, number]),
      radial
    ),
    pelvis: lathe(
      [
        [0, -0.145],
        [0.09, -0.138],
        [0.15, -0.108],
        [0.172, -0.055],
        [0.176, 0.01],
        [0.17, 0.07],
        [0, 0.07]
      ].map(([r, y]) => [r / 0.176, y] as [number, number]),
      radial
    ),
    head: full ? headShape(20, 14) : headShape(14, 10),
    hand: { 1: handShape(1, small, digit, full), [-1]: handShape(-1, small, digit, full) } as Record<
      1 | -1,
      THREE.BufferGeometry
    >,
    shoe: assemble([
      [mid, [0.102, 0.08, 0.2], [0, -0.012, 0.022]],
      [mid, [0.098, 0.062, 0.13], [0, -0.022, 0.1]]
    ]),
    sole: assemble([[mid, [0.106, 0.03, 0.262], [0, -0.042, 0.048]]]),
    hairCap: smooth(
      new THREE.SphereGeometry(0.5, full ? 22 : 12, full ? 9 : 5, 0, Math.PI * 2, 0, Math.PI * 0.5)
    ),
    hairVolume: sphere,
    curls: full ? curlyShape(24, 18, 9, 0.07) : curlyShape(16, 12, 7, 0.06),
    strand: taperedCapsule(1, 0.45, 2, full ? 10 : 6),
    smile: new THREE.TorusGeometry(0.024, 0.006, 4, full ? 10 : 6, Math.PI).rotateZ(Math.PI),
    vee: new THREE.CylinderGeometry(0.5, 0, 1, 3).rotateY(Math.PI),
    lens: new THREE.TorusGeometry(0.04, 0.006, 4, full ? 12 : 10),
    band: new THREE.TorusGeometry(0.178, 0.014, 4, full ? 14 : 10, Math.PI)
  };
}

const cache = new Map<'full' | 'low', BodyShapes>();

export function bodyShapes(detail: 'full' | 'low'): BodyShapes {
  let shapes = cache.get(detail);
  if (!shapes) {
    shapes = build(detail);
    cache.set(detail, shapes);
  }
  return shapes;
}
