import * as THREE from 'three';
import { useEffect, useSyncExternalStore } from 'react';
import { appearanceFor } from '../agents/appearance';
import { applyPose, buildHumanoid } from '../agents/HumanoidRig';
import { computePose } from '../agents/poses';
import { PortraitQueue } from './portraitQueue';

const SIZE = 192;
const BASE_HEIGHT = 1.68;
/** Portraits rendered per idle slice; small enough never to hold up the office. */
const PER_SLICE = 3;

interface Studio {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
}

let studio: Studio | null = null;
let unavailable = false;
let scheduled = false;
const cache = new Map<string, string>();
const listeners = new Set<() => void>();
const queue = new PortraitQueue();

function openStudio(): Studio | null {
  if (studio || unavailable) return studio;
  try {
    const canvas = document.createElement('canvas');
    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true
    });
    renderer.setPixelRatio(1);
    renderer.setSize(SIZE, SIZE, false);
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.08;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight('#ffffff', '#cdb89c', 2.1));
    const key = new THREE.DirectionalLight('#fff4e4', 2.2);
    key.position.set(1.6, 2.6, 2.4);
    const rim = new THREE.DirectionalLight('#dbe7ff', 1.3);
    rim.position.set(-2, 2.2, -1.8);
    scene.add(key, rim);
    const camera = new THREE.PerspectiveCamera(23, 1, 0.1, 20);
    studio = { renderer, scene, camera };
  } catch {
    unavailable = true;
  }
  return studio;
}

/** Head and shoulders, turned a little toward the viewer, like a friendly team photo. */
function render(id: string): string {
  const { renderer, scene, camera } = studio!;
  const look = appearanceFor(id);
  const rig = buildHumanoid(look, 'full');
  applyPose(
    rig,
    computePose({
      behavior: 'idle',
      sit: 0,
      speed: 0,
      phase: 0,
      time: 0,
      since: 10,
      seed: 0.5,
      held: null,
      seatHeight: 0.48,
      scale: rig.scale,
      lookYaw: -0.12,
      lounging: false
    })
  );
  rig.root.rotation.y = 0.32;
  scene.add(rig.root);
  const s = look.height / BASE_HEIGHT;
  camera.position.set(0.24, 1.53 * s, 1.42);
  camera.lookAt(0, 1.41 * s, 0);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/webp', 0.92);
  scene.remove(rig.root);
  rig.root.traverse((object) => {
    if (object instanceof THREE.Mesh && object.userData.ownsGeometry) object.geometry.dispose();
  });
  return url;
}

function pump(): void {
  scheduled = false;
  if (!openStudio()) return;
  let changed = false;
  for (const id of queue.take(PER_SLICE)) {
    try {
      cache.set(id, render(id));
      changed = true;
    } catch {
      unavailable = true;
      return;
    }
  }
  if (changed) listeners.forEach((listener) => listener());
  if (queue.size) schedule();
}

function schedule(): void {
  if (scheduled || unavailable) return;
  scheduled = true;
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: object) => number })
    .requestIdleCallback;
  if (idle) idle(pump, { timeout: 400 });
  else setTimeout(pump, 30);
}

/** Ask for someone's portrait; `urgent` puts them first (the selected person). */
export function requestPortrait(id: string, urgent = false): void {
  if (cache.has(id) || unavailable) return;
  queue.request(id, urgent);
  schedule();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The rendered portrait for someone, or null while it is being made (or if 3D is unavailable). */
export function usePortrait(id: string, urgent = false): string | null {
  useEffect(() => requestPortrait(id, urgent), [id, urgent]);
  return useSyncExternalStore(subscribe, () => cache.get(id) ?? null);
}
