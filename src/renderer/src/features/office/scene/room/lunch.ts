import * as THREE from 'three';
import { lunchPlacement, surfaceOf } from '../../campus/deskPlacement';
import { DESK_SETUPS, poiById } from '../../simulation/layout';
import { mat } from './materials';

/** Salad, noodles, curry, rice, tomato pasta. */
const FOODS = ['#8fc262', '#e9c46a', '#d9824a', '#f3eee4', '#c85a54'];
/** Cans and bottles. */
const DRINKS = ['#d94f3d', '#3f7fd9', '#f2c14e', '#5dbb7a', '#f4f1ea'];
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * Lunch on the desks of whoever is eating there: a bowl, what is in it and (where it fits) a drink.
 * One instance per desk in each of three shared meshes, shown and hidden as people eat.
 */
export class DeskLunches {
  readonly object = new THREE.Group();
  private readonly desks: string[] = [];
  private readonly bowlAt: THREE.Matrix4[] = [];
  private readonly drinkAt: (THREE.Matrix4 | null)[] = [];
  private readonly shown: boolean[] = [];
  private readonly bowls: THREE.InstancedMesh;
  private readonly food: THREE.InstancedMesh;
  private readonly drinks: THREE.InstancedMesh;

  constructor() {
    const turn = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (const setup of DESK_SETUPS) {
      const seat = poiById(setup.poiId);
      const surface = surfaceOf(setup.poiId, seat.district);
      const spot = lunchPlacement(setup.equipment, setup.props, surface);
      if (!spot) continue;
      // In the seat's frame (x to the person's right): the bowl on the left, the drink on the right.
      const desk = new THREE.Matrix4().compose(
        new THREE.Vector3(seat.position.x, 0, seat.position.z),
        turn.setFromAxisAngle(up, seat.facing),
        new THREE.Vector3(1, 1, 1)
      );
      const withDrink = spot.item === 'lunch';
      const at = (x: number) =>
        desk.clone().multiply(new THREE.Matrix4().makeTranslation(x, surface.top, spot.z));
      this.desks.push(setup.poiId);
      this.bowlAt.push(at(withDrink ? spot.x - 0.045 : spot.x));
      this.drinkAt.push(withDrink ? at(spot.x + 0.08) : null);
      this.shown.push(false);
    }

    const count = this.desks.length;
    const make = (geometry: THREE.BufferGeometry, material: THREE.Material, colours: string[] | null) => {
      const mesh = new THREE.InstancedMesh(geometry, material, count);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      // Instances are hidden by scaling to nothing, which would shrink computed bounds: never cull.
      mesh.frustumCulled = false;
      const colour = new THREE.Color();
      for (let i = 0; i < count; i++) {
        mesh.setMatrixAt(i, HIDDEN);
        if (colours) mesh.setColorAt(i, colour.set(colours[(i * 7 + 3) % colours.length]));
      }
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.object.add(mesh);
      return mesh;
    };
    this.bowls = make(
      new THREE.CylinderGeometry(0.066, 0.046, 0.045, 16).translate(0, 0.0225, 0),
      mat('#fbfaf6', { roughness: 0.35 }),
      null
    );
    this.food = make(
      new THREE.SphereGeometry(0.06, 14, 5, 0, Math.PI * 2, 0, Math.PI / 2)
        .scale(1, 0.4, 1)
        .translate(0, 0.043, 0),
      mat('#ffffff', { roughness: 0.75 }),
      FOODS
    );
    this.drinks = make(
      new THREE.CylinderGeometry(0.026, 0.026, 0.11, 12).translate(0, 0.055, 0),
      mat('#ffffff', { roughness: 0.4 }),
      DRINKS
    );
  }

  /** Shows lunch on the desks where someone is eating now, and clears it where they have finished. */
  update(lunchAt: (deskId: string) => boolean): void {
    let changed = false;
    this.desks.forEach((deskId, i) => {
      const show = lunchAt(deskId);
      if (show === this.shown[i]) return;
      this.shown[i] = show;
      changed = true;
      this.bowls.setMatrixAt(i, show ? this.bowlAt[i] : HIDDEN);
      this.food.setMatrixAt(i, show ? this.bowlAt[i] : HIDDEN);
      this.drinks.setMatrixAt(i, show ? (this.drinkAt[i] ?? HIDDEN) : HIDDEN);
    });
    if (!changed) return;
    for (const mesh of [this.bowls, this.food, this.drinks]) mesh.instanceMatrix.needsUpdate = true;
  }

  /** Desks with lunch on them now. */
  count(): number {
    return this.shown.filter(Boolean).length;
  }

  dispose(): void {
    for (const mesh of [this.bowls, this.food, this.drinks]) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
  }
}
