import * as THREE from 'three';
import { OFFICE_AGENTS, type OfficeAgent, type AgentStatus } from '../data/officeAgents';
import type { AmbientActivity } from '../simulation/agentProfiles';
import { POINTS_OF_INTEREST, ZONE_ANCHORS, HOME_DESKS, SPECIALIST_DESKS } from '../simulation/layout';
import { OfficeSimulation } from '../simulation/OfficeSimulation';
import type { AgentView, ScreenState, ZoneId } from '../simulation/types';
import { OfficeAgentCharacter } from './agents/OfficeAgentCharacter';
import { OfficeCameraRig } from './cameraRig';
import { buildOffice, type OfficeRoom } from './room/buildOffice';

/** Opt-in inspection handle for automated checks (set localStorage `axon.officeDebug` to "1"). */
export interface OfficeDebugHandle {
  views(): AgentView[];
  request(agentId: string, activity: AmbientActivity): boolean;
  screen(deskId: string): ScreenState;
  seed: number;
}

declare global {
  interface Window {
    __axonOffice?: OfficeDebugHandle;
  }
}

type SceneLabel =
  | { element: HTMLElement; kind: 'zone'; point: THREE.Vector3 }
  | { element: HTMLElement; kind: 'agent'; agentId: string };

/**
 * Where each department's card floats: back-row rooms get a sign above the back wall, the open-plan
 * areas get one above empty floor, so the cards never sit on top of the people working there.
 */
const ZONE_SIGNS: Record<ZoneId, THREE.Vector3> = {
  chat: new THREE.Vector3(-9.8, 3.25, -9.1),
  workspaces: new THREE.Vector3(-2.0, 3.25, -9.1),
  knowledge: new THREE.Vector3(5.2, 3.25, -9.1),
  files: new THREE.Vector3(10.8, 3.25, -9.1),
  agents: new THREE.Vector3(-18.5, 0.1, 8.2),
  cafe: new THREE.Vector3(9.4, 2.7, 1.1)
};

const LOUNGE_SEATS = new Set(POINTS_OF_INTEREST.filter((poi) => poi.type === 'lounge').map((poi) => poi.id));

/**
 * The 3D office: a lit low-poly room, one animated person per coworker, and the simulation that
 * decides what each of them is doing. Real task status comes in through `updateAgentStatus`.
 */
export class OfficeScene {
  public readonly scene = new THREE.Scene();
  public readonly renderer: THREE.WebGLRenderer;
  public readonly hitObjects: THREE.Object3D[] = [];
  public onAgentClick?: (agentId: string) => void;
  public onAgentHover?: (agentId: string | null) => void;

  private readonly cameraRig = new OfficeCameraRig();
  private readonly simulation: OfficeSimulation;
  private readonly characters = new Map<string, OfficeAgentCharacter>();
  private readonly room: OfficeRoom;
  private readonly reducedMotion: boolean;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly scratch = new THREE.Vector3();
  private labels: SceneLabel[] = [];
  private hoveredAgentId: string | null = null;
  private dragging = false;
  private pointerDown = { x: 0, y: 0 };
  private lastPointer = { x: 0, y: 0 };
  private animationFrameId: number | null = null;
  private lastFrame = 0;
  private elapsed = 0;
  private ready = false;
  private cleanupListeners: () => void = () => {};

  constructor(
    private readonly container: HTMLElement,
    private readonly onFailure: () => void,
    private readonly onReady: () => void,
    agents: OfficeAgent[] = OFFICE_AGENTS.filter((agent) => !agent.wing)
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
      'Animated office. Use the coworker buttons to select a person, scroll to zoom, or drag to explore.'
    );
    container.appendChild(this.renderer.domElement);

    this.addLights();
    this.room = buildOffice();
    this.scene.add(this.room.root);

    const seed = Math.floor(Math.random() * 1e9);
    this.simulation = new OfficeSimulation({
      agentIds: agents.map((agent) => agent.id),
      homeDesks: Object.fromEntries(
        agents
          .filter((agent) => agent.wing)
          .map((agent, index) => [
            agent.id,
            SPECIALIST_DESKS[
              Math.floor((index * SPECIALIST_DESKS.length) / agents.filter((agent) => agent.wing).length)
            ]
          ])
      ),
      seed,
      reducedMotion: this.reducedMotion
    });
    for (const agent of agents) {
      const character = new OfficeAgentCharacter(agent.id, agent.accentColor);
      this.characters.set(agent.id, character);
      this.scene.add(character.root);
      this.hitObjects.push(character.hitBox);
    }
    if (localStorage.getItem('axon.officeDebug') === '1') {
      window.__axonOffice = {
        views: () => this.simulation.views(),
        request: (agentId, activity) => this.simulation.requestActivity(agentId, activity),
        screen: (deskId) => this.simulation.screenState(deskId),
        seed
      };
    }

    this.initEvents();
    this.handleResize();
    this.start();
  }

  private addLights(): void {
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#d8c6ab', 1.9));
    // From the viewer's side, so the two tall walls throw their shadows outward, not across the room.
    const sun = new THREE.DirectionalLight('#fff3df', 2.4);
    sun.position.set(10, 20, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const extent = 29;
    Object.assign(sun.shadow.camera, {
      left: -extent,
      right: extent,
      top: extent,
      bottom: -extent,
      near: 1,
      far: 60
    });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun, sun.target);
    const fill = new THREE.DirectionalLight('#e2ecff', 0.55);
    fill.position.set(14, 9, -8);
    this.scene.add(fill);
  }

  // ---------------------------------------------------------------- API used by OfficeCanvas

  public setSelectedAgent(agentId: string, focusAgent = false): void {
    this.characters.forEach((character, id) => character.setSelected(id === agentId, this.elapsed));
    const view = this.simulation.view(agentId);
    if (view && focusAgent) this.cameraRig.focus(view.position, 1.85);
  }

  public focusZone(zoneId: string): void {
    const anchor = ZONE_ANCHORS[zoneId as ZoneId];
    if (anchor) this.cameraRig.focus(anchor, 1.45);
  }

  /**
   * Floating HTML labels. Each element carries `data-anchor`: `zone:<id>` pins it above a
   * department, `agent:<id>` makes it follow that person around.
   */
  public setLabels(elements: HTMLElement[]): void {
    this.labels = elements.flatMap((element): SceneLabel[] => {
      const [kind, id] = (element.dataset.anchor ?? '').split(':');
      if (kind === 'zone' && id in ZONE_SIGNS)
        return [{ element, kind, point: ZONE_SIGNS[id as ZoneId].clone() }];
      if (kind === 'agent' && this.characters.has(id)) return [{ element, kind, agentId: id }];
      return [];
    });
  }

  public resetCamera(): void {
    this.cameraRig.reset();
  }

  public updateAgentStatus(agentId: string, status: AgentStatus): void {
    this.simulation.setTaskStatus(agentId, status);
    this.characters.get(agentId)?.setWorking(status === 'working');
  }

  // ---------------------------------------------------------------- input

  private updatePointer(event: MouseEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private agentAtPointer(): string | null {
    this.raycaster.setFromCamera(this.pointer, this.cameraRig.camera);
    const hit = this.raycaster.intersectObjects(this.hitObjects, false)[0]?.object;
    return (hit?.userData.agentId as string | undefined) ?? null;
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
      this.cameraRig.zoomAt(event.deltaY < 0 ? 1.1 : 1 / 1.1, this.pointer.x, this.pointer.y);
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
      this.tick(dt);
    };
    this.animationFrameId = requestAnimationFrame(frame);
  }

  private tick(dt: number): void {
    this.simulation.step(dt);
    for (const [id, character] of this.characters) {
      const view = this.simulation.view(id);
      if (!view) continue;
      const seat =
        view.poiId && view.sit > 0
          ? { height: this.room.seatHeight(view.poiId), lounging: LOUNGE_SEATS.has(view.poiId) }
          : null;
      character.update(view, dt, this.elapsed, seat, this.cameraRig.yawTowardViewer, this.reducedMotion);
    }
    this.room.update(
      dt,
      this.elapsed,
      (deskId) => this.simulation.screenState(deskId),
      (poiId) => this.simulation.occupantsOf(poiId).length > 0
    );
    this.cameraRig.update(dt, this.reducedMotion);
    this.renderer.render(this.scene, this.cameraRig.camera);
    this.placeLabels();
    if (!this.ready) {
      this.ready = true;
      this.onReady();
    }
  }

  private placeLabels(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    const occupied: { x: number; y: number; w: number; h: number }[] = [];
    const ordered = [...this.labels].sort((a, b) => {
      const priority = (label: SceneLabel) =>
        label.element.getAttribute('aria-pressed') === 'true' ? 0 : label.kind === 'zone' ? 1 : 2;
      return priority(a) - priority(b);
    });
    const dimensions = new Map(
      ordered.map((label) => [label, { w: label.element.offsetWidth, h: label.element.offsetHeight }])
    );
    for (const label of ordered) {
      let point: THREE.Vector3;
      if (label.kind === 'zone') point = this.scratch.copy(label.point);
      else {
        const character = this.characters.get(label.agentId)!;
        point = character.labelPoint(this.scratch);
        const behavior = this.simulation.view(label.agentId)?.behavior ?? 'idle';
        if (label.element.dataset.behavior !== behavior) label.element.dataset.behavior = behavior;
      }
      const projected = point.project(this.cameraRig.camera);
      const x = ((projected.x + 1) * width) / 2;
      const y = ((1 - projected.y) * height) / 2;
      const { w, h } = dimensions.get(label)!;
      const onScreen = x > 0 && x < width && y > 0 && y < height;
      label.element.style.visibility = onScreen ? 'visible' : 'hidden';
      if (!onScreen) continue;
      const placedX = Math.max(w / 2 + 6, Math.min(width - w / 2 - 6, x));
      let placedY = Math.max(h / 2 + 6, Math.min(height - h / 2 - 6, y));
      if (label.kind === 'agent') {
        for (const offset of [0, -28, 28, -56, 56, -84, 84]) {
          const candidateY = placedY + offset;
          if (candidateY < h / 2 || candidateY > height - h / 2) continue;
          if (
            !occupied.some(
              (rect) =>
                Math.abs(placedX - rect.x) < (w + rect.w) / 2 + 5 &&
                Math.abs(candidateY - rect.y) < (h + rect.h) / 2 + 4
            )
          ) {
            placedY = candidateY;
            break;
          }
        }
      }
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
    this.room.dispose();
    this.renderer.dispose();
    if (this.container.contains(this.renderer.domElement))
      this.container.removeChild(this.renderer.domElement);
  }
}
