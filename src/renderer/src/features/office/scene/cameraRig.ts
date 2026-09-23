import * as THREE from 'three';
import type { Bounds } from '../campus/districts';
import { ROOM } from '../simulation/layout';
import type { Vec2 } from '../simulation/types';

const YAW = 0.42; // looking in from the front right, like the reference artwork
const PITCH = 0.7;
const DISTANCE = 140;
/** Closest view: about this many metres of floor across the shorter side of the screen. */
const CLOSEST_SPAN = 9;
/** Where the office opens: the Commons with its neighbours around it. */
const OPENING = { point: { x: 0, z: 1 }, span: 52 };
const CAMPUS_CENTRE = new THREE.Vector3((ROOM.minX + ROOM.maxX) / 2, 0, (ROOM.minZ + ROOM.maxZ) / 2);

/**
 * Elevated isometric observer camera over the campus. Zoom 1 shows the whole floor; zooming in can
 * reach a single pod. No free flight: pan is clamped so the office never drifts out of view.
 */
export class OfficeCameraRig {
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, DISTANCE - 120, DISTANCE + 120);
  /** Yaw that faces the camera from inside the room; people glance this way when selected. */
  readonly yawTowardViewer = YAW;
  private readonly right = new THREE.Vector3(Math.cos(YAW), 0, -Math.sin(YAW));
  private readonly back = new THREE.Vector3(-Math.sin(YAW), 0, -Math.cos(YAW));
  private readonly offset = new THREE.Vector3(
    Math.sin(YAW) * Math.cos(PITCH),
    Math.sin(PITCH),
    Math.cos(YAW) * Math.cos(PITCH)
  ).multiplyScalar(DISTANCE);
  private readonly targetPoint = CAMPUS_CENTRE.clone();
  private readonly desiredTarget = CAMPUS_CENTRE.clone();
  private zoom = 1;
  private desiredZoom = 1;
  private halfHeight = 10;
  private halfWidth = 10;
  private pixelHeight = 1;
  private maxZoom = 8;
  private readonly scratch = new THREE.Vector3();

  constructor() {
    this.place();
  }

  resize(width: number, height: number): void {
    if (!width || !height) return;
    const first = this.pixelHeight === 1;
    this.pixelHeight = height;
    const up = new THREE.Vector3().crossVectors(this.right, this.offset.clone().normalize()).negate();
    // Fit the whole campus at zoom 1, with the frustum centred on the target.
    let extentX = 0;
    let extentY = 0;
    for (const x of [ROOM.minX, ROOM.maxX])
      for (const z of [ROOM.minZ, ROOM.maxZ])
        for (const y of [0, 2.7]) {
          const corner = new THREE.Vector3(x, y, z).sub(CAMPUS_CENTRE);
          extentX = Math.max(extentX, Math.abs(corner.dot(this.right)));
          extentY = Math.max(extentY, Math.abs(corner.dot(up)));
        }
    const aspect = width / height;
    this.halfHeight = Math.max(extentY, extentX / aspect) * 1.04;
    this.halfWidth = this.halfHeight * aspect;
    Object.assign(this.camera, {
      left: -this.halfWidth,
      right: this.halfWidth,
      top: this.halfHeight,
      bottom: -this.halfHeight
    });
    this.camera.updateProjectionMatrix();
    this.maxZoom = this.zoomForSpan(CLOSEST_SPAN);
    if (first) {
      this.desiredTarget.set(OPENING.point.x, 0, OPENING.point.z);
      this.desiredZoom = this.zoomForSpan(OPENING.span);
      this.targetPoint.copy(this.desiredTarget);
      this.zoom = this.desiredZoom;
      this.clamp();
      this.targetPoint.copy(this.desiredTarget);
      this.place();
    }
  }

  /** Zoom at which `span` metres of floor fill the shorter side of the view. */
  private zoomForSpan(span: number): number {
    const shorterWorld = Math.min(this.halfWidth * 2, (this.halfHeight * 2) / Math.sin(PITCH));
    return THREE.MathUtils.clamp(shorterWorld / span, 1, 60);
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
    const next = THREE.MathUtils.clamp(this.desiredZoom * factor, 1, this.maxZoom);
    const pointer = this.desiredTarget
      .clone()
      .addScaledVector(this.right, (ndcX * this.halfWidth) / this.desiredZoom)
      .addScaledVector(this.back, (ndcY * this.halfHeight) / this.desiredZoom / Math.sin(PITCH));
    const keep = this.desiredZoom / next;
    this.desiredTarget.sub(pointer).multiplyScalar(keep).add(pointer);
    this.desiredZoom = next;
    this.clamp();
  }

  /** Glide to a floor point, framing about `span` metres across the shorter side. */
  focus(point: Vec2, span: number): void {
    this.desiredZoom = THREE.MathUtils.clamp(this.zoomForSpan(span), 1, this.maxZoom);
    this.desiredTarget.set(point.x, 0, point.z);
    this.clamp();
  }

  /** Centre on a floor point without changing zoom (minimap). */
  lookAt(point: Vec2): void {
    this.desiredTarget.set(point.x, 0, point.z);
    this.clamp();
  }

  /** The whole campus. */
  overview(): void {
    this.desiredZoom = 1;
    this.desiredTarget.copy(CAMPUS_CENTRE);
  }

  /** Back to the opening view of the Commons. */
  reset(): void {
    this.focus(OPENING.point, OPENING.span);
  }

  update(dt: number, snap: boolean): void {
    const ease = snap ? 1 : 1 - Math.exp(-7 * dt);
    this.targetPoint.lerp(this.desiredTarget, ease);
    this.zoom += (this.desiredZoom - this.zoom) * ease;
    this.place();
  }

  /** Floor point at the centre of the view. */
  target(): Vec2 {
    return { x: this.targetPoint.x, z: this.targetPoint.z };
  }

  /** Metres of floor per screen pixel, along the screen's horizontal. */
  metresPerPixel(): number {
    return (this.halfHeight * 2) / this.zoom / this.pixelHeight;
  }

  /** The floor rectangle the view currently covers (axis-aligned, clipped to the campus). */
  viewBounds(): Bounds {
    const forward = this.scratch.copy(this.offset).normalize().negate();
    const up = new THREE.Vector3().crossVectors(this.right, forward);
    const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (const sx of [-1, 1])
      for (const sy of [-1, 1]) {
        const origin = this.camera.position
          .clone()
          .addScaledVector(this.right, (sx * this.halfWidth) / this.zoom)
          .addScaledVector(up, (sy * this.halfHeight) / this.zoom);
        const t = -origin.y / forward.y;
        const x = origin.x + forward.x * t;
        const z = origin.z + forward.z * t;
        bounds.minX = Math.min(bounds.minX, x);
        bounds.maxX = Math.max(bounds.maxX, x);
        bounds.minZ = Math.min(bounds.minZ, z);
        bounds.maxZ = Math.max(bounds.maxZ, z);
      }
    return {
      minX: Math.max(ROOM.minX, bounds.minX),
      maxX: Math.min(ROOM.maxX, bounds.maxX),
      minZ: Math.max(ROOM.minZ, bounds.minZ),
      maxZ: Math.min(ROOM.maxZ, bounds.maxZ)
    };
  }

  /** Rough radius of the visible floor, for the shadow camera. */
  viewRadius(): number {
    const b = this.viewBounds();
    return Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2;
  }

  private clamp(): void {
    // Zoomed in, any corner of the campus can be brought into view; zoomed out, it stays centred.
    const slack = 1 - 1 / this.desiredZoom;
    const halfX = ((ROOM.maxX - ROOM.minX) / 2) * slack;
    const halfZ = ((ROOM.maxZ - ROOM.minZ) / 2) * slack;
    this.desiredTarget.x = THREE.MathUtils.clamp(
      this.desiredTarget.x,
      CAMPUS_CENTRE.x - halfX,
      CAMPUS_CENTRE.x + halfX
    );
    this.desiredTarget.z = THREE.MathUtils.clamp(
      this.desiredTarget.z,
      CAMPUS_CENTRE.z - halfZ,
      CAMPUS_CENTRE.z + halfZ
    );
  }

  private place(): void {
    this.camera.position.copy(this.targetPoint).add(this.offset);
    this.camera.lookAt(this.targetPoint);
    if (this.camera.zoom !== this.zoom) {
      this.camera.zoom = this.zoom;
      this.camera.updateProjectionMatrix();
    }
  }
}
