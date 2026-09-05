import { Injectable, OnDestroy, inject } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Camera, OrthographicCamera, PerspectiveCamera } from 'three';
import { EngineRenderPipeline } from '../models';
import { EngineService } from './engine.service';

export interface IViewportCamera {
  camera: Camera;
  viewport: [x: number, y: number, width: number, height: number];
}

/**
 * Manages multi-viewport rendering for a single scene.
 * Register cameras with viewports, and this service handles splitting
 * the screen into multiple rectangular regions per camera.
 */
@Injectable()
export class MultiViewportService implements OnDestroy {
  private readonly engineService = inject(EngineService);

  private viewportCameras$ = new BehaviorSubject<IViewportCamera[]>([]);

  /** This instance's own pipeline registration, so it can be cleanly unregistered on destroy — a shared EngineService (multiple <scene> reusing a parent-provided instance) otherwise leaves a stale, empty pipeline registered after this instance's scene tears down. */
  private pipeline: EngineRenderPipeline | undefined;

  /**
   * Register a camera to render to a specific viewport region.
   * Viewport is normalized: [x (0-1), y (0-1), width (0-1), height (0-1)]
   * Origin (0,0) is bottom-left to match Three.js convention.
   */
  registerViewportCamera(
    camera: Camera,
    viewport: [x: number, y: number, width: number, height: number],
  ): void {
    const cameras = this.viewportCameras$.value;
    // Remove if already registered
    const filtered = cameras.filter((c) => c.camera !== camera);
    this.viewportCameras$.next([...filtered, { camera, viewport }]);
    this.ensurePipelineRegistered();
  }

  /**
   * Unregister a camera from viewport rendering.
   */
  unregisterViewportCamera(camera: Camera): void {
    const cameras = this.viewportCameras$.value;
    const remaining = cameras.filter((c) => c.camera !== camera);
    this.viewportCameras$.next(remaining);
    if (remaining.length === 0 && this.pipeline) {
      this.engineService.unregisterRenderPipeline(this.pipeline);
      this.pipeline = undefined;
    }
  }

  ngOnDestroy(): void {
    if (this.pipeline) {
      this.engineService.unregisterRenderPipeline(this.pipeline);
      this.pipeline = undefined;
    }
  }

  private ensurePipelineRegistered(): void {
    if (this.pipeline) return;

    this.pipeline = {
      render: (deltaTime) => this.renderViewports(deltaTime),
      setSize: () => {
        // Viewports are normalized [0-1], so no action needed on resize
      },
    };
    this.engineService.registerRenderPipeline(this.pipeline);
  }

  /**
   * Render all registered viewport cameras.
   * This is called from the render pipeline.
   */
  private renderViewports(deltaTime: number): void {
    const cameras = this.viewportCameras$.value;
    if (cameras.length === 0) return;

    const renderer = this.engineService.renderer;
    const width = this.engineService.width;
    const height = this.engineService.height;

    // Clear once for all viewports
    renderer.setScissorTest(false);
    renderer.clear(true, true);
    renderer.setScissorTest(true);

    // Render each camera to its viewport
    for (const { camera, viewport } of cameras) {
      const [vx, vy, vw, vh] = viewport;

      // Convert normalized [0-1] coordinates to pixel coordinates.
      // WebGL gl.viewport/gl.scissor origin (0, 0) is bottom-left, matching
      // Three.js viewport convention directly.
      const pixelX = Math.floor(vx * width);
      const pixelY = Math.floor(vy * height);
      const pixelW = Math.floor(vw * width);
      const pixelH = Math.floor(vh * height);

      // Set scissor test to prevent rendering outside viewport
      renderer.setScissor(pixelX, pixelY, pixelW, pixelH);
      renderer.setViewport(pixelX, pixelY, pixelW, pixelH);

      // Update camera aspect ratio for this viewport
      const aspect = pixelW / pixelH;
      if (camera instanceof PerspectiveCamera) {
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
      } else if (camera instanceof OrthographicCamera) {
        const orthoHeight = camera.top - camera.bottom;
        camera.left = -(aspect * orthoHeight) / 2;
        camera.right = (aspect * orthoHeight) / 2;
        camera.updateProjectionMatrix();
      }

      // Render scene with this camera
      renderer.render(this.engineService.scene, camera);
    }

    // Reset to full viewport (cleanup) — without this, WebGLRenderer keeps
    // the last camera's small viewport rect set, so anything that renders
    // via the plain `renderer.render(scene, camera)` path afterward (e.g.
    // EngineService's single-camera fallback) gets squished into that rect
    // instead of filling the canvas.
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, width, height);
  }

  /**
   * Get all registered viewport cameras.
   */
  getViewportCameras(): IViewportCamera[] {
    return this.viewportCameras$.value;
  }
}
