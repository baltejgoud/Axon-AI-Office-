import * as THREE from 'three';
import { ROOM } from '../simulation/layout';
import type { Vec2 } from '../simulation/types';

const YAW = 0.42; // looking in from the front right, like the reference artwork
const PITCH = 0.7;
const DISTANCE = 60;
const MIN_ZOOM = 0.85;
const MAX_ZOOM = 3.2;
/** Opens a touch closer than the whole-room fit, framed past the mostly empty front strip. */
const DEFAULT_ZOOM = 0.96;
const DEFAULT_TARGET = new THREE.Vector3(0.3, 0, -0.4);

/**
 * Elevated isometric observer camera. No free flight: the room always stays framed, and
 * pan/zoom are clamped so the office never drifts out of view.
 */
export class OfficeCameraRig {
  /** Near and far hug the room: a tight depth range keeps rugs and floor from z-fighting. */
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, DISTANCE - 28, DISTANCE + 28);
  /** Yaw that faces the camera from inside the room; people glance this way when selected. */
  readonly yawTowardViewer = YAW;
  private readonly right = new THREE.Vector3(Math.cos(YAW), 0, -Math.sin(YAW));
  private readonly back = new THREE.Vector3(-Math.sin(YAW), 0, -Math.cos(YAW));
  private readonly offset = new THREE.Vector3(
    Math.sin(YAW) * Math.cos(PITCH),
    Math.sin(PITCH),
    Math.cos(YAW) * Math.cos(PITCH)
  ).multiplyScalar(DISTANCE);
  private readonly target = DEFAULT_TARGET.clone();
  private readonly desiredTarget = DEFAULT_TARGET.clone();
  private zoom = DEFAULT_ZOOM;
  private desiredZoom = DEFAULT_ZOOM;
  private halfHeight = 10;
  private halfWidth = 10;
  private pixelHeight = 1;

  constructor() {
    this.place();
  }

  resize(width: number, height: number): void {
    if (!width || !height) return;
    this.pixelHeight = height;
    const up = new THREE.Vector3().crossVectors(this.right, this.offset.clone().normalize()).negate();
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const x of [ROOM.minX, ROOM.maxX])
      for (const z of [ROOM.minZ, ROOM.maxZ])
        for (const y of [0, 2.7]) {
          const corner = new THREE.Vector3(x, y, z);
          minX = Math.min(minX, corner.dot(this.right));
          maxX = Math.max(maxX, corner.dot(this.right));
          minY = Math.min(minY, corner.dot(up));
          maxY = Math.max(maxY, corner.dot(up));
        }
    const aspect = width / height;
    const margin = 1.06;
    this.halfHeight = Math.max((maxY - minY) / 2, (maxX - minX) / 2 / aspect) * margin;
    this.halfWidth = this.halfHeight * aspect;
    const centreX = (minX + maxX) / 2;
    const centreY = (minY + maxY) / 2;
    this.camera.left = centreX - this.halfWidth;
    this.camera.right = centreX + this.halfWidth;
    this.camera.top = centreY + this.halfHeight;
    this.camera.bottom = centreY - this.halfHeight;
    this.camera.updateProjectionMatrix();
  }

  /** Drag the floor: the point under the pointer follows it. */
  pan(dxPixels: number, dyPixels: number): void {
    const worldPerPixel = (this.halfHeight * 2) / this.zoom / this.pixelHeight;
    this.desiredTarget.addScaledVector(this.right, -dxPixels * worldPerPixel);
    this.desiredTarget.addScaledVector(this.back, (dyPixels * worldPerPixel) / Math.sin(PITCH));
    this.clamp();
  }

  /** Zoom toward the floor point under the pointer. `ndcX`/`ndcY` are -1..1. */
  zoomAt(factor: number, ndcX: number, ndcY: number): void {
    const next = THREE.MathUtils.clamp(this.desiredZoom * factor, MIN_ZOOM, MAX_ZOOM);
    const frustumCentreX = (this.camera.left + this.camera.right) / 2;
    const frustumCentreY = (this.camera.top + this.camera.bottom) / 2;
    const pointer = this.desiredTarget
      .clone()
      .addScaledVector(this.right, frustumCentreX + (ndcX * this.halfWidth) / this.desiredZoom)
      .addScaledVector(
        this.back,
        (frustumCentreY + (ndcY * this.halfHeight) / this.desiredZoom) / Math.sin(PITCH)
      );
    const keep = this.desiredZoom / next;
    this.desiredTarget.sub(pointer).multiplyScalar(keep).add(pointer);
    this.desiredZoom = next;
    this.clamp();
  }

  focus(point: Vec2, zoom: number): void {
    this.desiredZoom = THREE.MathUtils.clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    this.desiredTarget.set(point.x * 0.7, 0, point.z * 0.7);
    this.clamp();
  }

  reset(): void {
    this.desiredZoom = DEFAULT_ZOOM;
    this.desiredTarget.copy(DEFAULT_TARGET);
  }

  update(dt: number, snap: boolean): void {
    const ease = snap ? 1 : 1 - Math.exp(-7 * dt);
    this.target.lerp(this.desiredTarget, ease);
    this.zoom += (this.desiredZoom - this.zoom) * ease;
    this.place();
  }

  private clamp(): void {
    // Zoomed in, any department can be brought into view; zoomed out, the room stays centred.
    const slack = 1 - 1 / this.desiredZoom;
    const limitX = 1 + 20 * slack;
    const limitZ = 1 + 14 * slack;
    this.desiredTarget.x = THREE.MathUtils.clamp(this.desiredTarget.x, -limitX, limitX);
    this.desiredTarget.z = THREE.MathUtils.clamp(this.desiredTarget.z, -limitZ, limitZ);
  }

  private place(): void {
    this.camera.position.copy(this.target).add(this.offset);
    this.camera.lookAt(this.target);
    if (this.camera.zoom !== this.zoom) {
      this.camera.zoom = this.zoom;
      this.camera.updateProjectionMatrix();
    }
  }
}
