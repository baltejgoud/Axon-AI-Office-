import * as THREE from 'three';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * Draws the office. With `ao` on (High quality): the scene into a multisampled target, soft ambient
 * occlusion from its depth (at half resolution, with normals rebuilt from depth, so there is no
 * second scene render), then tone mapping and colour space onto the canvas. With `ao` off (Balanced)
 * the scene goes straight to the canvas, as cheap as the office has ever been.
 */
export class RenderPipeline {
  ao = true;
  private readonly sceneTarget: THREE.WebGLRenderTarget;
  private readonly aoTarget: THREE.WebGLRenderTarget;
  private readonly gtao: GTAOPass;
  private readonly output = new OutputPass();

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera
  ) {
    const depthTexture = new THREE.DepthTexture(1, 1);
    this.sceneTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: 4,
      depthTexture
    });
    this.aoTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    // Built with its own buffers first: in three 0.186 passing a depth texture to the constructor
    // fails on a normal buffer it never created. Handing ours over afterwards skips its normal render.
    this.gtao = new GTAOPass(scene, camera, 1, 1);
    this.gtao.setGBuffer(depthTexture);
    // Tuned for the office's scale: a tight radius grounds furniture without smudging glass walls.
    this.gtao.updateGtaoMaterial({
      radius: 0.6,
      distanceExponent: 1.5,
      thickness: 0.6,
      distanceFallOff: 1,
      scale: 1.7,
      samples: 16
    });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 10, rings: 3, samples: 16 });
    this.gtao.blendIntensity = 1;
    this.output.renderToScreen = true;
    // One frame is several renders; count them together.
    renderer.info.autoReset = false;
  }

  /** Size in CSS pixels; targets follow the renderer's pixel ratio, the shading runs at half of it. */
  setSize(width: number, height: number): void {
    const ratio = this.renderer.getPixelRatio();
    const w = Math.max(1, Math.round(width * ratio));
    const h = Math.max(1, Math.round(height * ratio));
    this.sceneTarget.setSize(w, h);
    this.aoTarget.setSize(w, h);
    this.gtao.setSize(Math.ceil(w / 2), Math.ceil(h / 2));
  }

  render(): void {
    const renderer = this.renderer;
    renderer.info.reset();
    if (!this.ao) {
      renderer.setRenderTarget(null);
      renderer.render(this.scene, this.camera);
      return;
    }
    renderer.setRenderTarget(this.sceneTarget);
    renderer.render(this.scene, this.camera);
    this.gtao.render(renderer, this.aoTarget, this.sceneTarget, 0, false);
    this.output.render(renderer, null as unknown as THREE.WebGLRenderTarget, this.aoTarget, 0, false);
  }

  dispose(): void {
    this.sceneTarget.depthTexture?.dispose();
    this.sceneTarget.dispose();
    this.aoTarget.dispose();
    this.gtao.dispose();
    this.output.dispose();
  }
}
