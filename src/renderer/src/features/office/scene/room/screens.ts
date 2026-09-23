import * as THREE from 'three';
import type { ScreenState } from '../../simulation/types';
import { screenCanvas, type ScreenFlavor } from './materials';

export interface ScreenSlot {
  deskId: string;
  flavor: ScreenFlavor;
  /** Places a unit plane: position, facing and the screen's width and height. */
  matrix: THREE.Matrix4;
}

/** Screen brightness per state; the texture is multiplied by this grey. */
const LEVEL: Record<ScreenState, number> = { off: 0.09, on: 0.62, active: 1 };

/**
 * Every laptop and monitor screen in the office, drawn as one instanced mesh per screen style.
 * Brightness follows whoever sits at the desk: dark when empty, lit when someone works there,
 * bright and gently alive while a real task runs.
 */
export class DeskScreens {
  readonly object = new THREE.Group();
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly entries: { mesh: THREE.InstancedMesh; index: number; deskId: string; level: number }[] =
    [];
  private readonly color = new THREE.Color();

  constructor(slots: ScreenSlot[]) {
    const byFlavor = new Map<ScreenFlavor, ScreenSlot[]>();
    for (const slot of slots) {
      const list = byFlavor.get(slot.flavor);
      if (list) list.push(slot);
      else byFlavor.set(slot.flavor, [slot]);
    }
    for (const [flavor, list] of byFlavor) {
      const texture = new THREE.CanvasTexture(screenCanvas(flavor));
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(1, 0.5);
      texture.offset.set(0, 0.5);
      const mesh = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: texture }),
        list.length
      );
      mesh.name = `screens-${flavor}`;
      list.forEach((slot, index) => {
        mesh.setMatrixAt(index, slot.matrix);
        mesh.setColorAt(index, this.color.setScalar(LEVEL.off));
        this.entries.push({ mesh, index, deskId: slot.deskId, level: LEVEL.off });
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.meshes.push(mesh);
      this.object.add(mesh);
    }
  }

  update(dt: number, elapsed: number, state: (deskId: string) => ScreenState): void {
    const ease = 1 - Math.exp(-dt * 4);
    const touched = new Set<THREE.InstancedMesh>();
    for (const entry of this.entries) {
      const current = state(entry.deskId);
      let target = LEVEL[current];
      // Real work flickers a little, as content changes on screen.
      if (current === 'active') target -= 0.06 * (0.5 + 0.5 * Math.sin(elapsed * 2.3 + entry.index));
      if (Math.abs(target - entry.level) < 0.002) continue;
      entry.level += (target - entry.level) * ease;
      entry.mesh.setColorAt(entry.index, this.color.setScalar(entry.level));
      touched.add(entry.mesh);
    }
    for (const mesh of touched) mesh.instanceColor!.needsUpdate = true;
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      const material = mesh.material as THREE.MeshBasicMaterial;
      material.map?.dispose();
      material.dispose();
      mesh.dispose();
    }
  }
}
