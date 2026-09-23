import * as THREE from 'three';
import type { OfficeAgent } from '../data/officeAgents';

/** V1 figures are rendered in the office artwork. This layer owns their interactive presence. */
export class AgentAvatar3D {
  public readonly group = new THREE.Group();
  public readonly hitBox: THREE.Mesh;
  private readonly ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private selected = false;
  private hovered = false;
  private working = false;

  constructor(public readonly agent: OfficeAgent) {
    this.group.name = `agent-${agent.id}`;
    this.group.position.set((agent.mapPosition[0] - 0.5) * 12, (0.5 - agent.mapPosition[1]) * 8, 0);
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.325, 64),
      new THREE.MeshBasicMaterial({ color: 0x3768ff, transparent: true, opacity: 0, depthWrite: false })
    );
    this.ring.position.set(0, -0.29, 0.12);
    this.ring.scale.set(1.05, 0.4, 1);
    this.group.add(this.ring);
    this.hitBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.65, 0.85, 0.1),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    this.hitBox.userData.agentId = agent.id;
    this.group.add(this.hitBox);
  }

  public setHovered(value: boolean): void {
    this.hovered = value;
  }
  public setSelected(value: boolean): void {
    this.selected = value;
  }
  public updateVisualState(status: string): void {
    this.working = status === 'working';
    this.ring.material.color.set(
      status === 'error' ? '#dc4855' : status === 'completed' ? '#159b73' : '#3768ff'
    );
  }
  public animate(elapsed: number, reducedMotion = false): void {
    this.ring.material.opacity = this.selected ? 0.95 : this.hovered ? 0.6 : 0;
    const pulse = this.working && !reducedMotion ? 1 + Math.sin(elapsed * 2) * 0.07 : 1;
    this.ring.scale.set(1.05 * pulse, 0.4 * pulse, 1);
  }
}
