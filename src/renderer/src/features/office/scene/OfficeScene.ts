import * as THREE from 'three';
import type { Bounds } from '../campus/districts';
import { OFFICE_AGENTS, type AgentStatus } from '../data/officeAgents';
import type { AmbientActivity } from '../simulation/agentProfiles';
import { FURNITURE, HOME_DESKS, POINTS_OF_INTEREST, ZONE_ANCHORS, poiById } from '../simulation/layout';
import { OfficeSimulation } from '../simulation/OfficeSimulation';
import { FILES_HOTSPOT, LIBRARY_HOTSPOT } from '../campus/commons';
import { SIGNS, type SignKind, type SignSpec } from '../campus/signs';
import { labelTier } from '../shell/framing';
import { SignLayer } from './room/signs';
import { BoardLayer } from './room/boards';
import { TASK_BOARDS } from '../campus/boards';
import type { Team } from '../tasks';
import type { TaskItem, TaskStatus } from '../../../../../shared/types';
import type { AgentView, ScreenState, Vec2, ZoneId } from '../simulation/types';
import { OfficeAgentCharacter } from './agents/OfficeAgentCharacter';
import { appearanceFor } from './agents/appearance';
import { OfficeCameraRig } from './cameraRig';
import { CrowdRenderer } from './people/CrowdRenderer';
import { chooseFullTier } from './people/tiers';
import { buildOffice, type OfficeRoom } from './room/buildOffice';
import { MIDDAY, followsTimeOfDay, lightingAt, type Lighting } from './room/lighting';
import { LAMP_BASE, windowGlass } from './room/materials';
import { RACK_LIGHTS } from './room/props';
import { RenderPipeline } from './render/pipeline';
import { AutoQuality, qualityPreference, type QualityLevel, type QualityMode } from './render/quality';

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
  /** The chosen quality and what is drawn now; `setQuality` overrides the choice until reload. */
  quality(): { mode: QualityMode; level: QualityLevel };
  setQuality(mode: QualityMode): void;
  view(): OfficeView;
  /** Every sign with its current opacity and scale. */
  signs(): { id: string; kind: SignKind; target: string; opacity: number; scale: number }[];
  /** Where a sign's face is on screen, in canvas pixels. */
  signPoint(id: string): { x: number; y: number } | null;
  /** What each task board shows. */
  boards(): { team: string; cards: { title: string; status: TaskStatus }[] }[];
  /** Where a team's board is on screen, in canvas pixels. */
  boardPoint(team: string): { x: number; y: number } | null;
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

/** A name tag that follows a person. */
interface SceneLabel {
  element: HTMLElement;
  agentId: string;
}

/** An invisible box over part of the room that reacts to clicks. */
const hotspot = (area: { x: number; z: number; w: number; d: number; h: number }) => {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(area.w, area.h, area.d),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  mesh.position.set(area.x, area.h / 2, area.z);
  return mesh;
};

const LOUNGE_SEATS = new Set(POINTS_OF_INTEREST.filter((poi) => poi.type === 'lounge').map((poi) => poi.id));
/** Seconds after loading before Auto quality starts judging the frame rate (shaders are still warming up). */
const QUALITY_WARMUP = 3;
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
  /** The Files room cabinets were clicked. */
  public onFilesClick?: () => void;
  /** The Library's shelves were clicked. */
  public onLibraryClick?: () => void;
  /** A district, department or room sign was clicked. */
  public onSignClick?: (sign: SignSpec) => void;
  /** A team's task board was clicked. */
  public onBoardClick?: (team: Team) => void;

  private readonly cameraRig = new OfficeCameraRig();
  private readonly simulation: OfficeSimulation;
  private readonly crowd: CrowdRenderer;
  private readonly characters = new Map<string, OfficeAgentCharacter>();
  private readonly idleSince = new Map<string, number>();
  private readonly statuses = new Map<string, AgentStatus>();
  private readonly room: OfficeRoom;
  private readonly pipeline: RenderPipeline;
  private qualityMode: QualityMode = qualityPreference();
  private autoQuality = new AutoQuality();
  private qualityLevel: QualityLevel | null = null;
  private readonly reducedMotion: boolean;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly scratch = new THREE.Vector3();
  private readonly sun: THREE.DirectionalLight;
  private readonly hemisphere = new THREE.HemisphereLight('#ffffff', '#d8c6ab', 1.9);
  private readonly fill = new THREE.DirectionalLight('#e2ecff', 0.55);
  private lightingClock = 0;
  /** Invisible click targets over the Files room cabinets and the Library shelves. */
  private readonly filesHotspot = hotspot(FILES_HOTSPOT);
  private readonly libraryHotspot = hotspot(LIBRARY_HOTSPOT);
  private readonly signs = new SignLayer(SIGNS, this.cameraRig.yawTowardViewer);
  /** Metres per pixel the signs were last scaled for. */
  private signScaleAt = 0;
  private hoveredSign: string | null = null;
  private readonly boards = new BoardLayer(TASK_BOARDS, FURNITURE);
  private hoveredBoard: Team | null = null;
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
    this.pipeline = new RenderPipeline(this.renderer, this.scene, this.cameraRig.camera);
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
    this.scene.add(this.filesHotspot, this.libraryHotspot, this.signs.object, this.boards.object);

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
        signs: () => this.signs.info(),
        boards: () => this.boards.info(),
        boardPoint: (team) =>
          this.boards.screenPoint(
            team,
            this.cameraRig.camera,
            this.container.clientWidth,
            this.container.clientHeight
          ),
        signPoint: (id) =>
          this.signs.screenPoint(
            id,
            this.cameraRig.camera,
            this.container.clientWidth,
            this.container.clientHeight
          ),
        view: () => ({
          bounds: this.cameraRig.viewBounds(),
          target: this.cameraRig.target(),
          metresPerPixel: this.cameraRig.metresPerPixel()
        }),
        shadows: (on) => {
          this.sun.castShadow = on;
        },
        quality: () => ({ mode: this.qualityMode, level: this.qualityLevel ?? 'high' }),
        setQuality: (mode) => {
          this.qualityMode = mode;
          this.autoQuality = new AutoQuality();
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
    this.applyLighting();
    this.handleResize();
    this.start();
  }

  /** Light the office for the time of day (or midday, if the user switched that off). */
  private applyLighting(): void {
    const now = new Date();
    const light: Lighting = followsTimeOfDay() ? lightingAt(now.getHours() + now.getMinutes() / 60) : MIDDAY;
    this.hemisphere.color.set(light.sky);
    this.hemisphere.groundColor.set(light.ground);
    this.hemisphere.intensity = light.hemisphere;
    this.sun.color.set(light.sunColor);
    this.sun.intensity = light.sun;
    this.fill.intensity = light.fill;
    for (const [material, glow] of LAMP_BASE) material.emissiveIntensity = glow * (0.45 + 1.1 * light.lamps);
    const glass = windowGlass();
    glass.color.set(light.windows);
    glass.emissive.set(light.windows);
    glass.emissiveIntensity = 0.25 + 0.3 * (1 - light.lamps);
    this.container.style.background = `radial-gradient(ellipse at 45% 25%, #ffffff 0%, ${light.backdrop} 75%)`;
  }

  private addLights(): THREE.DirectionalLight {
    this.scene.add(this.hemisphere);
    // From the viewer's side, so the two tall walls throw their shadows outward, not across the room.
    const sun = new THREE.DirectionalLight('#fff3df', 2.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun, sun.target);
    this.fill.position.set(14, 9, -8);
    this.scene.add(this.fill);
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

  /** Floating name tags. Each element carries `data-anchor="agent:<id>"` and follows that person. */
  public setLabels(elements: HTMLElement[]): void {
    this.labels = elements.flatMap((element): SceneLabel[] => {
      const anchor = element.dataset.anchor ?? '';
      const id = anchor.startsWith('agent:') ? anchor.slice(6) : '';
      return id && this.crowd.has(id) ? [{ element, agentId: id }] : [];
    });
  }

  /** Send someone on an errand (the Files Agent to the cabinets, for example). */
  public sendTo(agentId: string, activity: AmbientActivity): void {
    this.simulation.requestActivity(agentId, activity);
  }

  /** The task records, drawn onto the teams' boards. */
  public setTasks(tasks: readonly TaskItem[]): void {
    this.boards.setTasks(tasks);
  }

  /** A colleague walks over to help someone; false when they can't (see the simulation). */
  public startHelp(helperId: string, hostId: string): boolean {
    return this.simulation.startHelp(helperId, hostId);
  }

  public endHelp(helperId: string): void {
    this.simulation.endHelp(helperId);
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

  /** People come first, then signs, then boards: whatever is in front reacts. */
  private setHovered(agentId: string | null, signId: string | null = null, board: Team | null = null): void {
    if (signId !== this.hoveredSign) {
      this.hoveredSign = signId;
      this.signs.setHovered(signId);
    }
    this.hoveredBoard = board;
    this.renderer.domElement.style.cursor = agentId || signId || board ? 'pointer' : 'grab';
    if (agentId === this.hoveredAgentId) return;
    if (this.hoveredAgentId) this.characters.get(this.hoveredAgentId)?.setHovered(false);
    this.hoveredAgentId = agentId;
    if (agentId) this.characters.get(agentId)?.setHovered(true);
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
      const agentId = this.agentAtPointer();
      const signId = agentId ? null : (this.signs.pick(this.raycaster)?.id ?? null);
      this.setHovered(agentId, signId, agentId || signId ? null : this.boards.pick(this.raycaster));
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
        const sign = agentId ? null : this.signs.pick(this.raycaster);
        const board = agentId || sign ? null : this.boards.pick(this.raycaster);
        if (agentId) this.onAgentClick?.(agentId);
        else if (sign) this.onSignClick?.(sign);
        else if (board) this.onBoardClick?.(board);
        else if (this.raycaster.intersectObject(this.filesHotspot, false).length) this.onFilesClick?.();
        else if (this.raycaster.intersectObject(this.libraryHotspot, false).length) this.onLibraryClick?.();
      }
      canvas.style.cursor = this.hoveredAgentId || this.hoveredSign || this.hoveredBoard ? 'pointer' : 'grab';
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      this.updatePointer(event);
      this.cameraRig.zoomAt(event.deltaY < 0 ? 1.12 : 1 / 1.12, this.pointer.x, this.pointer.y);
    };
    const onLeave = () => this.setHovered(null);
    const onLightingChange = () => this.applyLighting();
    window.addEventListener('axon-office-lighting', onLightingChange);
    const onQualityChange = () => {
      this.qualityMode = qualityPreference();
      this.autoQuality = new AutoQuality();
    };
    window.addEventListener('axon-office-quality', onQualityChange);
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
      window.removeEventListener('axon-office-lighting', onLightingChange);
      window.removeEventListener('axon-office-quality', onQualityChange);
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
    this.lightingClock += dt;
    if (this.lightingClock > 20) {
      this.lightingClock = 0;
      this.applyLighting();
    }
    // Server racks twinkle, each colour at its own pace.
    RACK_LIGHTS.forEach((material, i) => {
      material.emissiveIntensity = this.reducedMotion
        ? 1
        : 0.75 + 0.45 * Math.sin(this.elapsed * (1.7 + i * 0.9) + i);
    });
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
    this.updateSigns();
    this.updateQuality(dt);
    this.pipeline.render();
    this.placeLabels();
    this.notifyView(dt);
    if (!this.ready) {
      this.ready = true;
      this.updateTiers();
      this.onReady();
    }
  }

  /** Signs grow as the camera pulls back and fade by zoom tier; only redone when the zoom moves. */
  private updateSigns(): void {
    const metresPerPixel = this.cameraRig.metresPerPixel();
    if (this.signScaleAt && Math.abs(metresPerPixel - this.signScaleAt) / this.signScaleAt < 0.03) return;
    this.signScaleAt = metresPerPixel;
    this.signs.setView(metresPerPixel, labelTier(this.cameraRig.viewBounds()));
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
      const priority = (label: SceneLabel) => (label.element.getAttribute('aria-pressed') === 'true' ? 0 : 1);
      return priority(a) - priority(b);
    });
    const dimensions = new Map(
      ordered.map((label) => [label, { w: label.element.offsetWidth, h: label.element.offsetHeight }])
    );
    for (const label of ordered) {
      const point = this.labelPoint(label.agentId, this.scratch);
      const behavior = this.simulation.view(label.agentId)?.behavior ?? 'idle';
      if (label.element.dataset.behavior !== behavior) label.element.dataset.behavior = behavior;
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
      if (!free)
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

  /** High draws ambient occlusion; Auto judges the frame rate once the view has settled. */
  private updateQuality(dt: number): void {
    let level: QualityLevel;
    if (this.qualityMode !== 'auto') level = this.qualityMode;
    else if (this.elapsed < QUALITY_WARMUP) level = this.autoQuality.level;
    else level = this.autoQuality.sample(this.fps, dt, this.cameraRig.settled());
    if (level === this.qualityLevel) return;
    this.qualityLevel = level;
    this.pipeline.ao = level === 'high';
    this.room.setAmbientOcclusion(level === 'high');
  }

  public handleResize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (!width || !height) return;
    this.cameraRig.resize(width, height);
    this.renderer.setSize(width, height);
    this.pipeline.setSize(width, height);
  }

  public destroy(): void {
    if (this.animationFrameId !== null) cancelAnimationFrame(this.animationFrameId);
    this.cleanupListeners();
    if (window.__axonOffice) delete window.__axonOffice;
    this.characters.forEach((character) => character.dispose());
    this.crowd.dispose();
    this.signs.dispose();
    this.boards.dispose();
    for (const spot of [this.filesHotspot, this.libraryHotspot]) {
      spot.geometry.dispose();
      (spot.material as THREE.Material).dispose();
    }
    this.room.dispose();
    this.pipeline.dispose();
    this.renderer.dispose();
    if (this.container.contains(this.renderer.domElement))
      this.container.removeChild(this.renderer.domElement);
  }
}
