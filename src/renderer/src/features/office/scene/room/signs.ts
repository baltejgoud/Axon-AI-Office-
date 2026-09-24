import * as THREE from 'three';
import { signOpacity, signScale, type SignKind, type SignSpec, type SignTier } from '../../campus/signs';

/**
 * Draws every sign in the office from one shared text atlas: a mesh of quads per kind (two draw
 * calls in all), rebuilt only when the zoom or the hovered sign changes. Each sign is a face with
 * a dark rim behind it.
 */

const KINDS: readonly SignKind[] = ['district', 'nameplate'];
const PICKABLE = new Set<SignKind>(['district']);
/** Pixel size of each kind's slot in the atlas; the same shape as the panel. */
const SLOT: Record<SignKind, [number, number]> = {
  district: [512, 170],
  nameplate: [256, 82]
};
const ATLAS_WIDTH = 2048;
/** Quads per sign: the rim and the face. */
const QUADS = 2;
const RIM = 0.03;
const HOVER_GROWTH = 1.06;
const FONT = 'Inter, "Segoe UI", system-ui, sans-serif';

interface Slot {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Layer {
  kind: SignKind;
  signs: SignSpec[];
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
}

export class SignLayer {
  readonly object = new THREE.Group();
  private readonly canvas = document.createElement('canvas');
  private readonly texture: THREE.CanvasTexture;
  private readonly slots = new Map<string, Slot>();
  private readonly ink: Slot;
  private readonly layers: Layer[] = [];
  private readonly scales = new Map<string, number>();
  private readonly opacities = new Map<SignKind, number>();
  private hovered: string | null = null;
  private metresPerPixel = 0.05;
  private tier: SignTier = 'middle';

  /** `yaw` is the camera's fixed yaw; signs that face the camera turn by it. */
  constructor(
    private readonly signs: readonly SignSpec[],
    private readonly yaw: number
  ) {
    this.ink = this.pack();
    this.draw();
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    for (const kind of KINDS) {
      const own = signs.filter((sign) => sign.kind === kind);
      if (!own.length) continue;
      const geometry = new THREE.BufferGeometry();
      const count = own.length * QUADS;
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 12), 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(this.uvs(own), 2));
      const index: number[] = [];
      for (let q = 0; q < count; q++) index.push(q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3);
      geometry.setIndex(index);
      const material = new THREE.MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        alphaTest: 0.5,
        toneMapped: false,
        side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `signs:${kind}`;
      mesh.renderOrder = 2;
      mesh.frustumCulled = false;
      this.object.add(mesh);
      this.layers.push({ kind, signs: own, mesh, material });
    }
    this.rebuild();
    // Draw again once the UI font has loaded, so signs match the rest of the app.
    void document.fonts?.ready.then(() => {
      this.draw();
      this.texture.needsUpdate = true;
    });
  }

  /** Follow the camera: scale signs to stay readable and fade them by zoom tier. */
  setView(metresPerPixel: number, tier: SignTier): void {
    this.metresPerPixel = metresPerPixel;
    this.tier = tier;
    this.rebuild();
  }

  setHovered(id: string | null): void {
    if (id === this.hovered) return;
    this.hovered = id;
    this.rebuild();
  }

  /** The clickable sign under the pointer, if any. */
  pick(raycaster: THREE.Raycaster): SignSpec | null {
    let best: { distance: number; sign: SignSpec } | null = null;
    for (const layer of this.layers) {
      if (!PICKABLE.has(layer.kind) || !layer.mesh.visible) continue;
      const hit = raycaster.intersectObject(layer.mesh, false)[0];
      if (!hit || hit.faceIndex == null) continue;
      if (best && best.distance <= hit.distance) continue;
      best = { distance: hit.distance, sign: layer.signs[Math.floor(hit.faceIndex / (QUADS * 2))] };
    }
    return best?.sign ?? null;
  }

  /** Where a sign's face appears on screen, in CSS pixels (for automated checks). */
  screenPoint(
    id: string,
    camera: THREE.Camera,
    width: number,
    height: number
  ): { x: number; y: number } | null {
    const sign = this.signs.find((item) => item.id === id);
    if (!sign) return null;
    const frame = this.frame(sign);
    const up = ((this.scales.get(id) ?? 1) * sign.height) / 2;
    const p = new THREE.Vector3(sign.x, sign.y, sign.z).addScaledVector(frame.up, up).project(camera);
    return { x: ((p.x + 1) * width) / 2, y: ((1 - p.y) * height) / 2 };
  }

  /** What each sign is doing, for the debug handle. */
  info(): { id: string; kind: SignKind; target: string; opacity: number; scale: number }[] {
    return this.signs.map((sign) => ({
      id: sign.id,
      kind: sign.kind,
      target: sign.target,
      opacity: this.opacities.get(sign.kind) ?? 0,
      scale: this.scales.get(sign.id) ?? 1
    }));
  }

  dispose(): void {
    for (const layer of this.layers) {
      layer.mesh.geometry.dispose();
      layer.material.dispose();
    }
    this.texture.dispose();
  }

  // ---------------------------------------------------------------- atlas

  /** Gives every sign a slot in the atlas, row by row, and sizes the canvas to fit. */
  private pack(): Slot {
    let x = 0;
    let y = 0;
    let row = 0;
    for (const sign of this.signs) {
      const [w, h] = SLOT[sign.kind];
      if (x + w > ATLAS_WIDTH) {
        x = 0;
        y += row;
        row = 0;
      }
      this.slots.set(sign.id, { x, y, w, h });
      x += w;
      row = Math.max(row, h);
    }
    const ink = { x: 0, y: y + row, w: 8, h: 8 };
    this.canvas.width = ATLAS_WIDTH;
    this.canvas.height = Math.ceil((ink.y + ink.h) / 64) * 64;
    return ink;
  }

  private draw(): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const sign of this.signs) this.drawSign(ctx, sign, this.slots.get(sign.id)!);
    ctx.fillStyle = '#1f2430';
    ctx.fillRect(this.ink.x, this.ink.y, this.ink.w, this.ink.h);
  }

  private drawSign(ctx: CanvasRenderingContext2D, sign: SignSpec, slot: Slot): void {
    const inset = 3;
    const x = slot.x + inset;
    const y = slot.y + inset;
    const w = slot.w - inset * 2;
    const h = slot.h - inset * 2;
    const plate = sign.kind === 'nameplate';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, h * 0.16);
    ctx.fillStyle = plate ? '#f4f1ea' : sign.color;
    ctx.fill();
    if (plate) {
      ctx.lineWidth = 4;
      ctx.strokeStyle = sign.color;
      ctx.stroke();
    } else {
      // A slightly darker foot, so the panel reads as a solid object.
      ctx.save();
      ctx.clip();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.14)';
      ctx.fillRect(x, y + h * 0.9, w, h * 0.1);
      ctx.restore();
    }
    ctx.fillStyle = plate ? '#2b2f36' : '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const pad = h * 0.14;
    const fit = (weight: number, value: string, px: number) => {
      ctx.font = `${weight} ${px}px ${FONT}`;
      while (px > 10 && ctx.measureText(value).width > w - pad * 2)
        ctx.font = `${weight} ${(px -= 2)}px ${FONT}`;
      return px;
    };
    const size = fit(650, sign.title, (sign.letter / sign.height) * slot.h);
    ctx.font = `650 ${size}px ${FONT}`;
    ctx.fillText(sign.title, x + w / 2, y + h / 2 - (sign.subtitle ? h * 0.13 : 0));
    if (sign.subtitle) {
      const small = fit(550, sign.subtitle, size * 0.55);
      ctx.font = `500 ${small}px ${FONT}`;
      ctx.globalAlpha = 0.85;
      ctx.fillText(sign.subtitle, x + w / 2, y + h * 0.74);
      ctx.globalAlpha = 1;
    }
  }

  // ---------------------------------------------------------------- geometry

  private uvs(signs: SignSpec[]): Float32Array {
    const out = new Float32Array(signs.length * QUADS * 8);
    const W = this.canvas.width;
    const H = this.canvas.height;
    const rect = (slot: Slot, inset = 0) => {
      const u0 = (slot.x + inset) / W;
      const u1 = (slot.x + slot.w - inset) / W;
      const v0 = 1 - (slot.y + slot.h - inset) / H;
      const v1 = 1 - (slot.y + inset) / H;
      return [u0, v0, u1, v0, u1, v1, u0, v1];
    };
    const ink = rect(this.ink, 2);
    let offset = 0;
    for (const sign of signs) {
      const face = rect(this.slots.get(sign.id)!, 3);
      for (let q = 0; q < QUADS; q++) {
        out.set(q === 1 ? face : ink, offset);
        offset += 8;
      }
    }
    return out;
  }

  /** The panel's axes: along its width, up its face and out of its face. */
  private frame(sign: SignSpec): { along: THREE.Vector3; up: THREE.Vector3; normal: THREE.Vector3 } {
    const yaw = sign.faceCamera ? this.yaw : 0;
    return {
      along: new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)),
      up: new THREE.Vector3(0, 1, 0),
      normal: new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw))
    };
  }

  /** Rewrites every quad for the current zoom, tier and hover. */
  private rebuild(): void {
    for (const kind of KINDS) this.opacities.set(kind, signOpacity(kind, this.tier));
    for (const layer of this.layers) {
      const opacity = this.opacities.get(layer.kind) ?? 0;
      layer.mesh.visible = opacity > 0;
      layer.material.opacity = opacity;
      // The cut-off trims the panels' rounded corners; it scales with opacity so faded signs still show.
      layer.material.alphaTest = 0.5 * Math.max(opacity, 0.05);
      layer.material.depthWrite = opacity >= 1;
      const position = layer.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const array = position.array as Float32Array;
      let offset = 0;
      const quad = (
        sign: SignSpec,
        scale: number,
        u0: number,
        u1: number,
        h0: number,
        h1: number,
        n: number
      ) => {
        const { along, up, normal } = this.frame(sign);
        for (const [u, h] of [
          [u0, h0],
          [u1, h0],
          [u1, h1],
          [u0, h1]
        ]) {
          array[offset++] = sign.x + along.x * u * scale + up.x * h * scale + normal.x * n;
          array[offset++] = sign.y + up.y * h * scale + normal.y * n;
          array[offset++] = sign.z + along.z * u * scale + up.z * h * scale + normal.z * n;
        }
      };
      for (const sign of layer.signs) {
        const scale = signScale(sign, this.metresPerPixel) * (sign.id === this.hovered ? HOVER_GROWTH : 1);
        this.scales.set(sign.id, scale);
        const half = sign.width / 2;
        quad(sign, scale, -half - RIM, half + RIM, -RIM, sign.height + RIM, -0.012);
        quad(sign, scale, -half, half, 0, sign.height, 0.012);
      }
      position.needsUpdate = true;
      layer.mesh.geometry.computeBoundingSphere();
    }
  }
}
