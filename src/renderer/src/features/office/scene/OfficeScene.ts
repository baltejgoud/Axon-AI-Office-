import * as THREE from 'three';
import officeWorldUrl from '@/assets/office/office-populated.png';
import { OFFICE_AGENTS } from '../data/officeAgents';
import { AgentAvatar3D } from './AgentAvatar3D';

const OFFICE_WIDTH = 12;
const OFFICE_HEIGHT = 8;

export class OfficeScene {
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.OrthographicCamera;
  public readonly renderer: THREE.WebGLRenderer;
  public readonly avatars = new Map<string, AgentAvatar3D>();
  public readonly hitObjects: THREE.Object3D[] = [];

  private readonly clock = new THREE.Clock();
  private readonly textureLoader = new THREE.TextureLoader();
  private readonly room = new THREE.Group();
  private readonly targetRoomPosition = new THREE.Vector3();
  private readonly currentRoomPosition = new THREE.Vector3();
  private targetScale = 1;
  private currentScale = 1;
  private animationFrameId: number | null = null;
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private hoveredAgentId: string | null = null;
  private isDragging = false;
  private pointerDownPosition = { x: 0, y: 0 };
  private previousMousePosition = { x: 0, y: 0 };
  private cleanupListeners: () => void = () => {};
  private disposed = false;
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private labels: { element: HTMLElement; point: THREE.Vector3 }[] = [];

  public onAgentClick?: (agentId: string) => void;
  public onAgentHover?: (agentId: string | null) => void;

  constructor(
    private readonly container: HTMLElement,
    private readonly onFailure: () => void,
    private readonly onReady: () => void
  ) {
    this.scene = new THREE.Scene();
    this.scene.background = null;
    this.camera = new THREE.OrthographicCamera(-6, 6, 4, -4, 0.1, 100);
    this.camera.position.set(0, 0, 20);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    this.buildWorld();
    this.spawnAgents();
    this.initEvents();
    this.handleResize();
    this.start();
  }

  private buildWorld(): void {
    const roomMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const roomImage = new THREE.Mesh(new THREE.PlaneGeometry(OFFICE_WIDTH, OFFICE_HEIGHT), roomMaterial);
    roomImage.position.z = -0.5;
    this.room.add(roomImage);

    this.textureLoader.load(
      officeWorldUrl,
      (texture) => {
        if (this.disposed) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        roomMaterial.map = texture;
        roomMaterial.needsUpdate = true;
        this.onReady();
      },
      undefined,
      () => {
        if (!this.disposed) this.onFailure();
      }
    );

    this.scene.add(this.room);
  }

  private spawnAgents(): void {
    for (const agent of OFFICE_AGENTS) {
      const avatar = new AgentAvatar3D(agent);
      this.avatars.set(agent.id, avatar);
      this.room.add(avatar.group);
      this.hitObjects.push(avatar.hitBox);
    }
  }

  public setSelectedAgent(agentId: string, focusAgent = false): void {
    this.avatars.forEach((avatar, id) => avatar.setSelected(id === agentId));
    const agent = OFFICE_AGENTS.find((item) => item.id === agentId);
    if (agent && focusAgent) this.focus(agent.mapPosition, 1.06);
  }

  public focusZone(mapPosition: [number, number]): void {
    this.focus(mapPosition, 1.12);
  }

  public setLabels(elements: HTMLElement[]): void {
    this.labels = elements.map((element) => ({
      element,
      point: new THREE.Vector3(
        (Number(element.dataset.x) - 0.5) * OFFICE_WIDTH,
        (0.5 - Number(element.dataset.y)) * OFFICE_HEIGHT,
        0.3
      )
    }));
  }

  private focus(mapPosition: [number, number], scale: number): void {
    const x = (mapPosition[0] - 0.5) * OFFICE_WIDTH;
    const y = (0.5 - mapPosition[1]) * OFFICE_HEIGHT;
    this.targetScale = scale;
    this.targetRoomPosition.set(
      THREE.MathUtils.clamp(-x * 0.18, -0.6, 0.6),
      THREE.MathUtils.clamp(-y * 0.18, -0.4, 0.4),
      0
    );
  }

  public resetCamera(): void {
    this.targetRoomPosition.set(0, 0, 0);
    this.targetScale = 1;
  }

  public updateAgentStatus(agentId: string, status: string): void {
    this.avatars.get(agentId)?.updateVisualState(status);
  }

  private updateMouse(e: MouseEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private agentAtPointer(): string | null {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hit = this.raycaster.intersectObjects(this.hitObjects)[0]?.object;
    return (hit?.userData.agentId as string | undefined) ?? null;
  }

  private initEvents(): void {
    const canvas = this.renderer.domElement;

    const onPointerMove = (event: MouseEvent) => {
      this.updateMouse(event);
      if (this.isDragging) {
        const deltaX = event.clientX - this.previousMousePosition.x;
        const deltaY = event.clientY - this.previousMousePosition.y;
        const rect = canvas.getBoundingClientRect();
        this.targetRoomPosition.x += (deltaX / rect.width) * OFFICE_WIDTH;
        this.targetRoomPosition.y -= (deltaY / rect.height) * OFFICE_HEIGHT;
        this.previousMousePosition = { x: event.clientX, y: event.clientY };
        return;
      }

      const agentId = this.agentAtPointer();
      if (agentId === this.hoveredAgentId) return;
      if (this.hoveredAgentId) this.avatars.get(this.hoveredAgentId)?.setHovered(false);
      this.hoveredAgentId = agentId;
      if (agentId) this.avatars.get(agentId)?.setHovered(true);
      canvas.style.cursor = agentId ? 'pointer' : 'grab';
      this.onAgentHover?.(agentId);
    };

    const onPointerDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      this.pointerDownPosition = { x: event.clientX, y: event.clientY };
      this.previousMousePosition = { ...this.pointerDownPosition };
      this.isDragging = true;
      canvas.style.cursor = 'grabbing';
    };

    const onPointerUp = (event: MouseEvent) => {
      if (!this.isDragging) return;
      const moved =
        Math.hypot(event.clientX - this.pointerDownPosition.x, event.clientY - this.pointerDownPosition.y) >
        4;
      this.isDragging = false;
      this.updateMouse(event);
      if (!moved) {
        const agentId = this.agentAtPointer();
        if (agentId) this.onAgentClick?.(agentId);
      }
      canvas.style.cursor = this.hoveredAgentId ? 'pointer' : 'grab';
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const previousScale = this.targetScale;
      this.targetScale = THREE.MathUtils.clamp(
        this.targetScale * (1 - Math.sign(event.deltaY) * 0.08),
        0.9,
        1.45
      );
      this.targetRoomPosition.multiplyScalar(this.targetScale / previousScale);
    };
    const onContextLost = (event: Event) => {
      event.preventDefault();
      this.onFailure();
    };

    canvas.addEventListener('mousemove', onPointerMove);
    canvas.addEventListener('mousedown', onPointerDown);
    window.addEventListener('mouseup', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('webglcontextlost', onContextLost);
    this.cleanupListeners = () => {
      canvas.removeEventListener('mousemove', onPointerMove);
      canvas.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('mouseup', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('webglcontextlost', onContextLost);
    };
  }

  private start(): void {
    const animate = () => {
      this.animationFrameId = requestAnimationFrame(animate);
      if (document.hidden) return;
      const elapsed = this.clock.getElapsedTime();
      const easing = this.reducedMotion.matches ? 1 : 0.12;
      this.targetRoomPosition.x = THREE.MathUtils.clamp(this.targetRoomPosition.x, -1.7, 1.7);
      this.targetRoomPosition.y = THREE.MathUtils.clamp(this.targetRoomPosition.y, -1.1, 1.1);
      this.currentRoomPosition.lerp(this.targetRoomPosition, easing);
      this.currentScale = THREE.MathUtils.lerp(this.currentScale, this.targetScale, easing);
      this.room.position.copy(this.currentRoomPosition);
      this.room.scale.setScalar(this.currentScale);
      this.avatars.forEach((avatar) => avatar.animate(elapsed, this.reducedMotion.matches));
      this.renderer.render(this.scene, this.camera);
      for (const { element, point } of this.labels) {
        const position = this.room.localToWorld(point.clone()).project(this.camera);
        element.style.left = `${((position.x + 1) * this.container.clientWidth) / 2}px`;
        element.style.top = `${((1 - position.y) * this.container.clientHeight) / 2}px`;
      }
    };
    animate();
  }

  public handleResize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (!width || !height) return;

    const aspect = width / height;
    const viewHeight = Math.max(OFFICE_HEIGHT, OFFICE_WIDTH / aspect);
    this.camera.left = (-viewHeight * aspect) / 2;
    this.camera.right = (viewHeight * aspect) / 2;
    this.camera.top = viewHeight / 2;
    this.camera.bottom = -viewHeight / 2;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  public destroy(): void {
    this.disposed = true;
    if (this.animationFrameId !== null) cancelAnimationFrame(this.animationFrameId);
    this.cleanupListeners();
    this.room.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if ('map' in material && material.map instanceof THREE.Texture) material.map.dispose();
        material.dispose();
      }
    });
    this.renderer.dispose();
    if (this.container.contains(this.renderer.domElement)) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
