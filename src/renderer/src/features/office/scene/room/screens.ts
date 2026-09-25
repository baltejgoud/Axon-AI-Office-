import * as THREE from 'three';
import type { AgentStatus } from '../../data/officeAgents';
import type { ScreenState } from '../../simulation/types';
import { hashString } from '../../simulation/random';
import { CURSOR, SCROLL, SHEET, stripCode, tileOf, type ScreenApp } from './screenApps';

export interface ScreenSlot {
  deskId: string;
  app: ScreenApp;
  variant: 0 | 1;
  /** Places a unit plane: position, facing and the screen's width and height. */
  matrix: THREE.Matrix4;
}

/** Screen brightness per state; the picture is multiplied by this grey. */
const LEVEL: Record<ScreenState, number> = { off: 0.09, on: 0.62, active: 1 };
/** Strip colours for codes 1–4: working, waiting for the user, done, error. */
const STRIP = ['#3b82f6', '#f59e0b', '#22c55e', '#ef4444'];
/** While the owner works on a real task, content scrolls this much faster. */
const BUSY_SCROLL = 3;

/**
 * Every laptop and monitor screen in the office, as one instanced mesh: one draw call. Each screen
 * shows its tile of the screen sheet (its owner's app), scrolls its app's band, blinks a cursor and
 * shows the status strip while its owner works on one of the user's tasks, and is dark when the desk
 * is empty, lit when someone works there, brighter while a real task runs.
 */
export class DeskScreens {
  readonly object = new THREE.Group();
  readonly mesh: THREE.InstancedMesh;
  private readonly time = { value: 0 };
  private readonly statusAttribute: THREE.InstancedBufferAttribute;
  private readonly entries: {
    deskId: string;
    level: number;
    code: number;
    status: AgentStatus | undefined;
    since: number;
  }[] = [];
  private readonly color = new THREE.Color();

  /** Takes ownership of `sheet`: it is disposed with the screens. */
  constructor(slots: readonly ScreenSlot[], sheet: THREE.Texture) {
    const count = slots.length;
    const tile = new Float32Array(count * 2);
    const band = new Float32Array(count * 4);
    const motion = new Float32Array(count * 2);
    const cursor = new Float32Array(count * 3);
    slots.forEach((slot, i) => {
      const origin = tileOf(slot.app, slot.variant);
      tile.set([origin.x, origin.y], i * 2);
      const scroll = SCROLL[slot.app];
      if (scroll) band.set([scroll.left, scroll.top, scroll.right, scroll.bottom], i * 4);
      // Each screen starts at its own point in its loop, so a row of screens never scrolls in step.
      motion.set([scroll?.speed ?? 0, hashString(`scroll:${slot.deskId}:${i}`) % 160], i * 2);
      const spot = CURSOR[slot.app];
      if (spot) cursor.set([spot.x, spot.y, spot.light ? 1 : 2], i * 3);
    });
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.setAttribute('screenTile', new THREE.InstancedBufferAttribute(tile, 2));
    geometry.setAttribute('screenBand', new THREE.InstancedBufferAttribute(band, 4));
    geometry.setAttribute('screenMotion', new THREE.InstancedBufferAttribute(motion, 2));
    geometry.setAttribute('screenCursor', new THREE.InstancedBufferAttribute(cursor, 3));
    this.statusAttribute = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    this.statusAttribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('screenStatus', this.statusAttribute);

    const material = new THREE.MeshBasicMaterial({ map: sheet });
    const strip = STRIP.map((hex) => new THREE.Color(hex));
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.time;
      shader.uniforms.uStrip = { value: strip };
      patchScreenShader(shader);
    };
    material.customProgramCacheKey = () => 'desk-screens';

    this.mesh = new THREE.InstancedMesh(geometry, material, count);
    this.mesh.name = 'screens';
    slots.forEach((slot, i) => {
      this.mesh.setMatrixAt(i, slot.matrix);
      this.mesh.setColorAt(i, this.color.setScalar(LEVEL.off));
      this.entries.push({ deskId: slot.deskId, level: LEVEL.off, code: 0, status: undefined, since: 0 });
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.computeBoundingSphere();
    this.object.add(this.mesh);
  }

  update(
    dt: number,
    elapsed: number,
    state: (deskId: string) => ScreenState,
    status: (deskId: string) => AgentStatus | undefined
  ): void {
    // Wrapped so the shader's float time stays precise however long the office has been open.
    this.time.value = elapsed % 3600;
    const ease = 1 - Math.exp(-dt * 4);
    let colours = false;
    let strips = false;
    this.entries.forEach((entry, i) => {
      const now = status(entry.deskId);
      if (now !== entry.status) {
        entry.status = now;
        entry.since = elapsed;
      }
      const code = stripCode(now, elapsed - entry.since);
      if (code !== entry.code) {
        entry.code = code;
        this.statusAttribute.setX(i, code);
        strips = true;
      }
      const target = LEVEL[state(entry.deskId)];
      if (Math.abs(target - entry.level) < 0.002) return;
      entry.level += (target - entry.level) * ease;
      this.mesh.setColorAt(i, this.color.setScalar(entry.level));
      colours = true;
    });
    if (colours && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    if (strips) this.statusAttribute.needsUpdate = true;
  }

  /** The strip a desk's screens show now (0 none, 1 working, 2 waiting, 3 done, 4 error). */
  stripOf(deskId: string): number {
    return this.entries.find((entry) => entry.deskId === deskId)?.code ?? 0;
  }

  dispose(): void {
    const material = this.mesh.material as THREE.MeshBasicMaterial;
    material.map?.dispose();
    material.dispose();
    this.mesh.geometry.dispose();
    this.mesh.dispose();
  }
}

/**
 * The screen shader: `MeshBasicMaterial` whose map lookup picks the instance's tile and scrolls its
 * band (wrapping inside the band), then, after the brightness, a blinking cursor while working and
 * the status strip along the bottom 7%.
 */
function patchScreenShader(shader: { vertexShader: string; fragmentShader: string }): void {
  const f = (n: number) => n.toFixed(1);
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
attribute vec2 screenTile;
attribute vec4 screenBand;
attribute vec2 screenMotion;
attribute vec3 screenCursor;
attribute float screenStatus;
varying vec2 vScreenUv;
varying vec2 vScreenTile;
varying vec4 vScreenBand;
varying vec2 vScreenMotion;
varying vec3 vScreenCursor;
varying float vScreenStatus;`
    )
    .replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
vScreenUv = uv;
vScreenTile = screenTile;
vScreenBand = screenBand;
vScreenMotion = screenMotion;
vScreenCursor = screenCursor;
vScreenStatus = screenStatus;`
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
uniform float uTime;
uniform vec3 uStrip[4];
varying vec2 vScreenUv;
varying vec2 vScreenTile;
varying vec4 vScreenBand;
varying vec2 vScreenMotion;
varying vec3 vScreenCursor;
varying float vScreenStatus;`
    )
    .replace(
      '#include <map_fragment>',
      `vec2 screenPx = vec2(vScreenUv.x * ${f(SHEET.tileWidth)}, (1.0 - vScreenUv.y) * ${f(SHEET.tileHeight)});
vec2 samplePx = screenPx;
float scrollSpeed = vScreenMotion.x * (vScreenStatus > 0.5 && vScreenStatus < 1.5 ? ${f(BUSY_SCROLL)} : 1.0);
if (scrollSpeed > 0.0 && screenPx.x > vScreenBand.x && screenPx.x < vScreenBand.z && screenPx.y > vScreenBand.y && screenPx.y < vScreenBand.w) {
  float span = vScreenBand.w - vScreenBand.y;
  samplePx.y = vScreenBand.y + mod(screenPx.y - vScreenBand.y + vScreenMotion.y + uTime * scrollSpeed, span);
}
samplePx = clamp(samplePx, vec2(0.5), vec2(${f(SHEET.tileWidth - 0.5)}, ${f(SHEET.tileHeight - 0.5)}));
vec2 sheetScale = vec2(1.0 / ${f(SHEET.width)}, 1.0 / ${f(SHEET.height)});
vec2 sheetUv = vec2((vScreenTile.x + samplePx.x) * sheetScale.x, 1.0 - (vScreenTile.y + samplePx.y) * sheetScale.y);
// Mip level from the unscrolled position, so the wrap line does not pick a blurry mip.
vec2 gradientUv = vec2((vScreenTile.x + screenPx.x) * sheetScale.x, 1.0 - (vScreenTile.y + screenPx.y) * sheetScale.y);
diffuseColor *= textureGrad(map, sheetUv, dFdx(gradientUv), dFdy(gradientUv));`
    )
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
if (vScreenStatus > 0.5 && vScreenStatus < 1.5 && vScreenCursor.z > 0.5 && fract(uTime * 1.6) < 0.5 &&
    abs(screenPx.x - vScreenCursor.x) < 1.5 && abs(screenPx.y - vScreenCursor.y) < 3.0)
  diffuseColor.rgb = vScreenCursor.z < 1.5 ? vec3(0.9) : vec3(0.05);
if (vScreenStatus > 0.5 && vScreenUv.y < 0.07) {
  int code = int(vScreenStatus + 0.5);
  vec3 strip = uStrip[code - 1];
  if (code == 1) strip = mix(strip, vec3(1.0), 0.55 * smoothstep(0.7, 1.0, fract(vScreenUv.x * 0.8 - uTime * 0.35)));
  if (code == 2) strip *= 0.7 + 0.3 * sin(uTime * 4.0);
  diffuseColor.rgb = strip;
}`
    );
}
