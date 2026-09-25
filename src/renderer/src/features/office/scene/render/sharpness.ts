import type * as THREE from 'three';
import type { QualityLevel } from './quality';

/**
 * How sharply the office is drawn. High renders more pixels than the screen has and lets the browser
 * scale them down, which smooths thin chair legs, rug borders and glass frames, and gives the sun a
 * finer shadow map. Balanced draws at the screen's own resolution. Neither adds a post-processing
 * pass: the ambient occlusion High used to draw left a grainy speckle around every chair, desk and
 * sofa foot, and cost about 15 fps. Contact shadows do its grounding now.
 */
export const RENDER_QUALITY = {
  high: { supersample: 1.6, shadowMap: 4096, shadowRadius: 1.5 },
  // A wider filter than the default single texel, so shadow edges are soft rather than stepped.
  balanced: { supersample: 1, shadowMap: 2048, shadowRadius: 2 }
} as const satisfies Record<QualityLevel, { supersample: number; shadowMap: number; shadowRadius: number }>;

/** Past two pixels per CSS pixel, extra pixels cost more than they show. */
const MAX_PIXEL_RATIO = 2;

/** Pixels drawn per CSS pixel: never fewer than the screen has (up to the cap). */
export function pixelRatioFor(level: QualityLevel, devicePixelRatio: number): number {
  const native = Math.min(devicePixelRatio, MAX_PIXEL_RATIO);
  const boosted = Math.min(devicePixelRatio * RENDER_QUALITY[level].supersample, MAX_PIXEL_RATIO);
  return Math.round(Math.max(native, boosted) * 100) / 100;
}

/** Applies a quality level's resolution and sun shadow; a new map size rebuilds the shadow map. */
export function applyRenderQuality(
  renderer: THREE.WebGLRenderer,
  sun: THREE.DirectionalLight,
  level: QualityLevel
): void {
  const settings = RENDER_QUALITY[level];
  renderer.setPixelRatio(pixelRatioFor(level, window.devicePixelRatio));
  sun.shadow.radius = settings.shadowRadius;
  if (sun.shadow.mapSize.x === settings.shadowMap) return;
  sun.shadow.mapSize.set(settings.shadowMap, settings.shadowMap);
  sun.shadow.map?.dispose();
  sun.shadow.map = null;
}
