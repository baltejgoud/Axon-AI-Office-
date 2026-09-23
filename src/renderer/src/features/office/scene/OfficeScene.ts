import * as THREE from 'three';
import type { Bounds } from '../campus/districts';
import { OFFICE_AGENTS, type AgentStatus } from '../data/officeAgents';
import type { AmbientActivity } from '../simulation/agentProfiles';
import {
  DEPARTMENT_ANCHORS,
  DISTRICT_ANCHORS,
  HOME_DESKS,
  POINTS_OF_INTEREST,
  ZONE_ANCHORS,
  poiById
} from '../simulation/layout';
import { OfficeSimulation } from '../simulation/OfficeSimulation';
import type { AgentView, ScreenState, Vec2, ZoneId } from '../simulation/types';
import { OfficeAgentCharacter } from './agents/OfficeAgentCharacter';
import { appearanceFor } from './agents/appearance';
import { OfficeCameraRig } from './cameraRig';
import { CrowdRenderer } from './people/CrowdRenderer';
import { chooseFullTier } from './people/tiers';
import { buildOffice, type OfficeRoom } from './room/buildOffice';

/** Opt-in inspection handle for automated checks (set localStorage `axon.officeDebug` to "1"). */
export interface OfficeDebugHandle {
  views(): AgentView[];
  request(agentId: string, activity: AmbientActivity): boolean;
  screen(deskId: string): ScreenState;
  tiers(): { full: number; crowd: number };
  stats(): { fps: number; calls: number; triangles: number };
  focus(x: number, z: number, span: number): void;
  breakdown(): Record<string, { meshes: number; triangles: number }>;
  shadows(on: boolean): void;
  seed: number;
}

declare global {
  interface Window {
    __axonOffice?: OfficeDebugHandle;
  }
}

/** What the office chrome needs to follow the camera: minimap, labels, team strip. */
export interface OfficeView {
  bounds: Bounds;
  target: Vec2;
  metresPerPixel: number;
}

type SceneLabel =
  | { element: HTMLElement; kind: 'point'; point: THREE.Vector3 }
  | { element: HTMLElement; kind: 'agent'; agentId: string };

/** Commons room cards float above the back wall of each room, or over open floor. */
const ROOM_SIGNS: Record<ZoneId, THREE.Vector3> = {
  chat: new THREE.Vector3(-9.8, 3.25, -9.1),
  workspaces: new THREE.Vector3(-2.0, 3.25, -9.1),
  knowledge: new THREE.Vector3(5.2, 3.25, -9.1),
  files: new THREE.Vector3(10.8, 3.25, -9.1),
  agents: new THREE.Vector3(0.2, 2.6, 3.4),
  cafe: new THREE.Vector3(9.4, 2.7, 1.1)
};

const LOUNGE_SEATS = new Set(POINTS_OF_INTEREST.filter((poi) => poi.type === 'lounge').map((poi) => poi.id));
/** Seconds between decisions about who is drawn in full. */
const TIER_INTERVAL = 0.25;
/** A rig that stays unused this long is released. */
const RIG_IDLE_SECONDS = 30;

/**
 * The 3D campus: a lit low-poly office, every coworker at their desk, and the simulation deciding
 * what each of them is doing. Most people are drawn by the instanced crowd; the few who move,
 * work on a real task, are selected or sit close to the camera get a full animated rig.
 * Real task status comes in through `updateAgentStatus`.
 */
export class OfficeScene {
  public readonly scene = new THREE.Scene();
  public readonly renderer: THREE.WebGLRenderer;
  public onAgentClick?: (agentId: string) => void;
  public onAgentHover?: (agentId: string | null) => void;
  public onViewChange?: (view: OfficeView) => void;

  private readonly cameraRig = new OfficeCameraRig();
  private readonly simulation: OfficeSimulation;
  private readonly crowd: CrowdRenderer;
  private readonly characters = new Map<string, OfficeAgentCharacter>();
  private readonly idleSince = new Map<string, number>();
  private readonly statuses = new Map<string, AgentStatus>();
  private readonly room: OfficeRoom;
  private readonly reducedMotion: boolean;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly scratch = new THREE.Vector3();
  private readonly sun: THREE.DirectionalLight;
  private labels: SceneLabel[] = [];
  private full = new Set<string>();
  private selectedId: string | null = null;
  private hoveredAgentId: string | null = null;
  private dragging = false;
  private pointerDown = { x: 0, y: 0 };
  private lastPointer = { x: 0, y: 0 };
  private animationFrameId: number | null = null;
  private lastFrame = 0;
  private elapsed = 0;
  private tierClock = TIER_INTERVAL;
  private viewClock = 0;
  private lastViewKey = '';
  private shadowExtent = 0;
  private fps = 60;
  private ready = false;
  private cleanupListeners: () => void = () => {};

  constructor(
    private readonly container: HTMLElement,
    private readonly onFailure: () => void,
    private readonly onReady: () => void
  ) {
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.setAttribute('role', 'img');
    this.renderer.domElement.setAttribute(
      'aria-label',
      'Animated office campus. Use the coworker buttons to select a person, scroll to zoom, or drag to explore.'
    );
    container.appendChild(this.renderer.domElement);

    this.sun = this.addLights();
    this.room = buildOffice();
    this.scene.add(this.room.root);

    const seed = Math.floor(Math.random() * 1e9);
    this.simulation = new OfficeSimulation({
      agentIds: OFFICE_AGENTS.map((agent) => agent.id),
      seed,
      reducedMotion: this.reducedMotion
    });
    this.crowd = new CrowdRenderer(
      OFFICE_AGENTS.map((agent) => {
        const seat = poiById(HOME_DESKS[agent.id]);
        return {
          id: agent.id,
          look: appearanceFor(agent.id, agent.accentColor),
          seat: { x: seat.position.x, z: seat.position.z, facing: seat.facing }
        };
      })
    );
    this.scene.add(this.crowd.object);

    if (localStorage.getItem('axon.officeDebug') === '1') {
      window.__axonOffice = {
        views: () => this.simulation.views(),
        request: (agentId, activity) => this.simulation.requestActivity(agentId, activity),
        screen: (deskId) => this.simulation.screenState(deskId),
        tiers: () => ({ full: this.full.size, crowd: OFFICE_AGENTS.length - this.full.size }),
        stats: () => ({
          fps: Math.round(this.fps),
          calls: this.renderer.info.render.calls,
          triangles: this.renderer.info.render.triangles
        }),
        focus: (x, z, span) => this.cameraRig.focus({ x, z }, span),
        shadows: (on) => {
          this.sun.castShadow = on;
        },
        breakdown: () => {
          const out: Record<string, { meshes: number; triangles: number }> = {};
          this.scene.traverse((object) => {
            if (!(object instanceof THREE.Mesh) || !object.visible) return;
            const geometry = object.geometry as THREE.BufferGeometry;
            const per = (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
            const count = object instanceof THREE.InstancedMesh ? object.count : 1;
            const key = object.name.startsWith('crowd')
              ? 'crowd'
              : object.parent === this.room.root
                ? `room:${(object.material as THREE.MeshStandardMaterial).color?.getHexString?.() ?? '?'}`
                : 'characters';
            const entry = (out[key] ??= { meshes: 0, triangles: 0 });
            entry.meshes++;
            entry.triangles += per * count;
          });
          return out;
        },
        seed
      };
    }

    this.initEvents();
    this.handleResize();
    this.start();
  }

  private addLights(): THREE.DirectionalLight {
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#d8c6ab', 1.9));
    // From the viewer's side, so the two tall walls throw their shadows outward, not across the room.
    const sun = new THREE.DirectionalLight('#fff3df', 2.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun, sun.target);
    const fill = new THREE.DirectionalLight('#e2ecff', 0.55);
    fill.position.set(14, 9, -8);
    this.scene.add(fill);
    return sun;
  }

  /** The sun's shadow follows the view, covering what is on screen with as much detail as it can. */
  private followWithShadow(): void {
    const target = this.cameraRig.target();
    const x = Math.round(target.x);
    const z = Math.round(target.z);
    this.sun.target.position.set(x, 0, z);
    this.sun.position.set(x + 15, 30, z + 13.5);
    const extent = Math.round(THREE.MathUtils.clamp(this.cameraRig.viewRadius() * 0.9, 14, 62) / 2) * 2;
    if (extent === this.shadowExtent) return;
    this.shadowExtent = extent;
    Object.assign(this.sun.shadow.camera, {
      left: -extent,
      right: extent,
      top: extent,
      bottom: -extent,
      near: 1,
      far: 90
    });
    this.sun.shadow.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- API used by OfficeCanvas

  public setSelectedAgent(agentId: string, focusAgent = false): void {
    this.selectedId = agentId;
    this.characters.forEach((character, id) => character.setSelected(id === agentId, this.elapsed));
    this.updateTiers();
    const view = this.simulation.view(agentId);
    if (view && focusAgent) this.cameraRig.focus(view.position, 12);
  }

  /** Frame one of the Commons rooms. */
  public focusZone(zoneId: string): void {
    const anchor = ZONE_ANCHORS[zoneId as ZoneId];
    if (anchor) this.cameraRig.focus(anchor, 16);
  }

  /** Frame any floor point with `span` metres across the shorter side of the view. */
  public focusPoint(point: Vec2, span: number): void {
    this.cameraRig.focus(point, span);
  }

  /** Centre the view on a floor point, keeping the zoom (minimap). */
  public lookAt(point: Vec2): void {
    this.cameraRig.lookAt(point);
  }

  public overview(): void {
    this.cameraRig.overview();
  }

  public resetCamera(): void {
    this.cameraRig.reset();
  }

  /**
   * Floating HTML labels. Each element carries `data-anchor`: `zone:<id>` pins it above a Commons
   * room, `district:<id>` and `department:<name>` above those areas, `agent:<id>` follows a person.
   */
  public setLabels(elements: HTMLElement[]): void {
    this.labels = elements.flatMap((element): SceneLabel[] => {
      const anchor = element.dataset.anchor ?? '';
      const split = anchor.indexOf(':');
      const kind = anchor.slice(0, split);
      const id = anchor.slice(split + 1);
      if (kind === 'zone' && id in ROOM_SIGNS)
        return [{ element, kind: 'point', point: ROOM_SIGNS[id as ZoneId].clone() }];
      if (kind === 'district' && id in DISTRICT_ANCHORS) {
        const p = DISTRICT_ANCHORS[id as keyof typeof DISTRICT_ANCHORS];
        return [{ element, kind: 'point', point: new THREE.Vector3(p.x, 4.2, p.z) }];
      }
      if (kind === 'department' && id in DEPARTMENT_ANCHORS) {
        const p = DEPARTMENT_ANCHORS[id];
        return [{ element, kind: 'point', point: new THREE.Vector3(p.x, 2.6, p.z) }];
      }
      if (kind === 'agent' && this.crowd.has(id)) return [{ element, kind: 'agent', agentId: id }];
      return [];
    });
  }

  public updateAgentStatus(agentId: string, status: AgentStatus): void {
    this.statuses.set(agentId, status);
    this.simulation.setTaskStatus(agentId, status);
    this.characters.get(agentId)?.setWorking(status === 'working');
  }

  // ---------------------------------------------------------------- tiers

  /** Detail follows the view: extra full rigs only when the camera is close enough to see them. */
  private tierBudget(): number {
    const metresPerPixel = this.cameraRig.metresPerPixel();
    return metresPerPixel < 0.03 ? 24 : metresPerPixel < 0.06 ? 10 : 0;
  }

  private updateTiers(): void {
    this.tierClock = 0;
    const inputs = this.simulation.views().map((view) => {
      const seatedAtHome =
        view.poiId === HOME_DESKS[view.id] && view.sit > 0.95 && view.behavior !== 'walking';
      const canBeCrowd = seatedAtHome && !view.onTask && !view.attention && view.id !== this.selectedId;
      return { id: view.id, x: view.position.x, z: view.position.z, mustBeFull: !canBeCrowd, canBeCrowd };
    });
    const next = chooseFullTier(inputs, this.cameraRig.target(), this.tierBudget(), this.full);
    // Required people appear at once; extra detail near the camera arrives a few rigs at a time,
    // so a quick zoom never stalls a frame building two dozen people.
    const required = new Set(inputs.filter((input) => input.mustBeFull).map((input) => input.id));
    let extra = 0;
    for (const id of [...next]) {
      if (this.full.has(id)) continue;
      if (!required.has(id) && !this.characters.has(id) && ++extra > 4) {
        next.delete(id);
        continue;
      }
      this.promote(id);
    }
    for (const id of this.full) if (!next.has(id)) this.demote(id);
    this.full = next;
    // Release rigs nobody has needed for a while.
    for (const [id, since] of this.idleSince) {
      if (this.elapsed - since < RIG_IDLE_SECONDS) continue;
      this.characters.get(id)?.dispose();
      this.characters.delete(id);
      this.idleSince.delete(id);
    }
    this.followWithShadow();
  }

  private promote(id: string): void {
    let character = this.characters.get(id);
    if (!character) {
      const agent = OFFICE_AGENTS.find((item) => item.id === id);
      character = new OfficeAgentCharacter(id, agent?.accentColor);
      character.setSelected(id === this.selectedId, this.elapsed);
      character.setWorking(this.statuses.get(id) === 'working');
      this.characters.set(id, character);
      this.scene.add(character.root);
    }
    this.idleSince.delete(id);
    character.root.visible = true;
    // Snap straight into the current pose, so the swap from the crowd figure is invisible.
    const view = this.simulation.view(id);
    if (view) this.updateCharacter(character, view, 1);
    this.crowd.setVisible(id, false);
  }

  private demote(id: string): void {
    const character = this.characters.get(id);
    if (character) character.root.visible = false;
    this.idleSince.set(id, this.elapsed);
    this.crowd.setVisible(id, true);
  }

  private updateCharacter(character: OfficeAgentCharacter, view: AgentView, dt: number): void {
    const seat =
      view.poiId && view.sit > 0
        ? { height: this.room.seatHeight(view.poiId), lounging: LOUNGE_SEATS.has(view.poiId) }
        : null;
    character.update(view, dt, this.elapsed, seat, this.cameraRig.yawTowardViewer, this.reducedMotion);
  }

  // ---------------------------------------------------------------- input

  private updatePointer(event: MouseEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private agentAtPointer(): string | null {
    this.raycaster.setFromCamera(this.pointer, this.cameraRig.camera);
    const boxes = [...this.full].flatMap((id) => {
      const character = this.characters.get(id);
      return character ? [character.hitBox] : [];
    });
    const hit = this.raycaster.intersectObjects(boxes, false)[0]?.object;
    return (hit?.userData.agentId as string | undefined) ?? this.crowd.pick(this.raycaster);
  }

  private setHovered(agentId: string | null): void {
    if (agentId === this.hoveredAgentId) return;
    if (this.hoveredAgentId) this.characters.get(this.hoveredAgentId)?.setHovered(false);
    this.hoveredAgentId = agentId;
    if (agentId) this.characters.get(agentId)?.setHovered(true);
    this.renderer.domElement.style.cursor = agentId ? 'pointer' : 'grab';
    this.onAgentHover?.(agentId);
  }

  private initEvents(): void {
    const canvas = this.renderer.domElement;
    const onMove = (event: MouseEvent) => {
      this.updatePointer(event);
      if (this.dragging) {
        this.cameraRig.pan(event.clientX - this.lastPointer.x, event.clientY - this.lastPointer.y);
        this.lastPointer = { x: event.clientX, y: event.clientY };
        return;
      }
      this.setHovered(this.agentAtPointer());
    };
    const onDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      this.pointerDown = { x: event.clientX, y: event.clientY };
      this.lastPointer = { ...this.pointerDown };
      this.dragging = true;
      canvas.style.cursor = 'grabbing';
    };
    const onUp = (event: MouseEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      const moved = Math.hypot(event.clientX - this.pointerDown.x, event.clientY - this.pointerDown.y) > 4;
      this.updatePointer(event);
      if (!moved) {
        const agentId = this.agentAtPointer();
        if (agentId) this.onAgentClick?.(agentId);
      }
      canvas.style.cursor = this.hoveredAgentId ? 'pointer' : 'grab';
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      this.updatePointer(event);
      this.cameraRig.zoomAt(event.deltaY < 0 ? 1.12 : 1 / 1.12, this.pointer.x, this.pointer.y);
    };
    const onLeave = () => this.setHovered(null);
    const onContextLost = (event: Event) => {
      event.preventDefault();
      this.onFailure();
    };
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('mouseleave', onLeave);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('webglcontextlost', onContextLost);
    this.cleanupListeners = () => {
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mousedown', onDown);
      canvas.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('webglcontextlost', onContextLost);
    };
  }

  // ---------------------------------------------------------------- frame loop

  private start(): void {
    const frame = (now: number) => {
      this.animationFrameId = requestAnimationFrame(frame);
      if (document.hidden) {
        this.lastFrame = 0;
        return;
      }
      const dt = this.lastFrame ? Math.min((now - this.lastFrame) / 1000, 0.1) : 1 / 60;
      this.lastFrame = now;
      this.elapsed += dt;
      this.fps += (1 / Math.max(dt, 1e-3) - this.fps) * 0.05;
      this.tick(dt);
    };
    this.animationFrameId = requestAnimationFrame(frame);
  }

  private tick(dt: number): void {
    this.simulation.step(dt);
    this.tierClock += dt;
    if (this.tierClock >= TIER_INTERVAL) this.updateTiers();
    for (const id of this.full) {
      const character = this.characters.get(id);
      const view = this.simulation.view(id);
      if (character && view) this.updateCharacter(character, view, dt);
    }
    this.crowd.update(this.elapsed, this.reducedMotion);
    this.room.update(
      dt,
      this.elapsed,
      (deskId) => this.simulation.screenState(deskId),
      (poiId) => this.simulation.occupantsOf(poiId).length > 0
    );
    this.cameraRig.update(dt, this.reducedMotion);
    this.renderer.render(this.scene, this.cameraRig.camera);
    this.placeLabels();
    this.notifyView(dt);
    if (!this.ready) {
      this.ready = true;
      this.updateTiers();
      this.onReady();
    }
  }

  private notifyView(dt: number): void {
    this.viewClock += dt;
    if (!this.onViewChange || this.viewClock < 0.15) return;
    this.viewClock = 0;
    const bounds = this.cameraRig.viewBounds();
    const target = this.cameraRig.target();
    const metresPerPixel = this.cameraRig.metresPerPixel();
    const key = [bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ, metresPerPixel * 1000]
      .map((n) => Math.round(n * 2))
      .join(',');
    if (key === this.lastViewKey) return;
    this.lastViewKey = key;
    this.onViewChange({ bounds, target, metresPerPixel });
  }

  private labelPoint(agentId: string, target: THREE.Vector3): THREE.Vector3 | null {
    const character = this.full.has(agentId) ? this.characters.get(agentId) : undefined;
    return character ? character.labelPoint(target) : this.crowd.labelPoint(agentId, target);
  }

  private placeLabels(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    const occupied: { x: number; y: number; w: number; h: number }[] = [];
    const ordered = [...this.labels].sort((a, b) => {
      const priority = (label: SceneLabel) =>
        label.element.getAttribute('aria-pressed') === 'true' ? 0 : label.kind === 'point' ? 1 : 2;
      return priority(a) - priority(b);
    });
    const dimensions = new Map(
      ordered.map((label) => [label, { w: label.element.offsetWidth, h: label.element.offsetHeight }])
    );
    for (const label of ordered) {
      let point: THREE.Vector3 | null;
      if (label.kind === 'point') point = this.scratch.copy(label.point);
      else {
        point = this.labelPoint(label.agentId, this.scratch);
        const behavior = this.simulation.view(label.agentId)?.behavior ?? 'idle';
        if (label.element.dataset.behavior !== behavior) label.element.dataset.behavior = behavior;
      }
      if (!point) continue;
      const projected = point.project(this.cameraRig.camera);
      const x = ((projected.x + 1) * width) / 2;
      const y = ((1 - projected.y) * height) / 2;
      const { w, h } = dimensions.get(label)!;
      const onScreen = x > 0 && x < width && y > 0 && y < height;
      if (!onScreen) {
        label.element.style.visibility = 'hidden';
        continue;
      }
      const placedX = Math.max(w / 2 + 6, Math.min(width - w / 2 - 6, x));
      let placedY = Math.max(h / 2 + 6, Math.min(height - h / 2 - 6, y));
      const collides = (cy: number) =>
        occupied.some(
          (rect) =>
            Math.abs(placedX - rect.x) < (w + rect.w) / 2 + 5 && Math.abs(cy - rect.y) < (h + rect.h) / 2 + 4
        );
      let free = !collides(placedY);
      if (!free && label.kind === 'agent')
        for (const offset of [-28, 28, -56, 56]) {
          const candidateY = placedY + offset;
          if (candidateY < h / 2 || candidateY > height - h / 2 || collides(candidateY)) continue;
          placedY = candidateY;
          free = true;
          break;
        }
      // A label that cannot find room is hidden rather than piled on top of another.
      if (!free && label.element.getAttribute('aria-pressed') !== 'true') {
        label.element.style.visibility = 'hidden';
        continue;
      }
      label.element.style.visibility = 'visible';
      occupied.push({ x: placedX, y: placedY, w, h });
      label.element.style.left = `${placedX}px`;
      label.element.style.top = `${placedY}px`;
    }
  }

  public handleResize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (!width || !height) return;
    this.cameraRig.resize(width, height);
    this.renderer.setSize(width, height);
  }

  public destroy(): void {
    if (this.animationFrameId !== null) cancelAnimationFrame(this.animationFrameId);
    this.cleanupListeners();
    if (window.__axonOffice) delete window.__axonOffice;
    this.characters.forEach((character) => character.dispose());
    this.crowd.dispose();
    this.room.dispose();
    this.renderer.dispose();
    if (this.container.contains(this.renderer.domElement))
      this.container.removeChild(this.renderer.domElement);
  }
}
