import {
  Camera,
  DepthTexture,
  MeshDepthMaterial,
  Object3D,
  Scene,
  UnsignedIntType,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';

/**
 * Captures the opaque scene's depth into a texture each frame, with a given
 * set of Object3D (the water meshes themselves) hidden, so water fragment
 * shaders can compare their own depth against whatever is behind them
 * (shoreline fade, depth tint) without a second "what counts as water"
 * classification. This resolves the open question in
 * docs/runbook/002_water_sublibrary.md ("does the depth-texture requirement
 * work in the plain forward path without the postprocessing composer?") —
 * yes, via a manual prepass. Call `capture` from `EngineService.postTick$`,
 * which fires synchronously right before the engine's own `render()` call,
 * so the texture is always fresh for the frame about to be drawn.
 */
export class WaterDepthPrepass {
  private target: WebGLRenderTarget;
  // Overrides the scene's materials during capture: the hardware depth test
  // still runs per the real geometry either way, this just skips the cost of
  // shading every opaque fragment for a color buffer the capture discards.
  private readonly depthMaterial = new MeshDepthMaterial();

  constructor(width: number, height: number) {
    this.target = createDepthTarget(width, height);
  }

  get texture(): DepthTexture {
    return this.target.depthTexture!;
  }

  setSize(width: number, height: number): void {
    if (this.target.width === width && this.target.height === height) return;
    this.target.dispose();
    this.target = createDepthTarget(width, height);
  }

  /** Renders `scene` through `camera` with `hidden` objects temporarily invisible. */
  capture(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
    hidden: readonly Object3D[],
  ): void {
    const visibility = hidden.map((object) => object.visible);
    for (const object of hidden) object.visible = false;

    const previousTarget = renderer.getRenderTarget();
    const previousOverride = scene.overrideMaterial;
    scene.overrideMaterial = this.depthMaterial;
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    scene.overrideMaterial = previousOverride;
    renderer.setRenderTarget(previousTarget);

    for (let i = 0; i < hidden.length; i++) hidden[i].visible = visibility[i];
  }

  dispose(): void {
    this.target.dispose();
    this.depthMaterial.dispose();
  }
}

function createDepthTarget(width: number, height: number): WebGLRenderTarget {
  const target = new WebGLRenderTarget(width, height);
  target.depthTexture = new DepthTexture(width, height);
  target.depthTexture.type = UnsignedIntType;
  return target;
}
