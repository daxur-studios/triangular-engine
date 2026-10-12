import { PerspectiveCamera, Scene } from 'three';
import { FPSController } from './fps.controller';
import { IEngine } from './engine.model';

describe('FPSController', () => {
  function createController(options?: {
    render?: { calls: number; drawCalls?: number; triangles?: number };
    camera?: PerspectiveCamera;
  }) {
    const render = options?.render ?? { calls: 24, drawCalls: 24, triangles: 12 };
    const camera = options?.camera ?? new PerspectiveCamera(60, 1, 0.1, 1000);
    const engine = {
      renderer: {
        info: {
          render: { ...render, triangles: render.triangles ?? 12 },
          memory: { geometries: 0, textures: 0 },
          programs: [],
        },
      },
      scene: new Scene(),
      options: {},
      camera,
      width: 1280,
      height: 720,
    } as unknown as IEngine;

    const controller = new FPSController(engine);
    // Ensure the 1-second boundary check triggers immediately on recordFrame
    controller.previousSecond = performance.now() - 1001;
    return { controller, engine, camera };
  }

  describe('renderer draw calls', () => {
    it('uses WebGPU drawCalls instead of the cumulative renderer calls counter', () => {
      const { controller } = createController({
        render: { calls: 5000, drawCalls: 24 },
      });

      controller.recordFrame(16);

      expect(controller.drawCalls()).toBe(24);
    });

    it('continues to use WebGL calls when drawCalls is unavailable', () => {
      const { controller } = createController({
        render: { calls: 24 },
      });

      controller.recordFrame(16);

      expect(controller.drawCalls()).toBe(24);
    });
  });

  describe('camera motion tracking', () => {
    it('records "idle" when camera does not move', () => {
      const { controller } = createController();

      // First frame sets baseline
      controller.recordFrame(16);
      // Advance to next second without moving
      controller.previousSecond = performance.now() - 1001;
      controller.recordFrame(16);

      const history = controller.cameraHistory();
      expect(history.length).toBeGreaterThan(0);
      expect(history[history.length - 1]).toBe('idle');
    });

    it('records "rot" when camera rotates', () => {
      const { controller, camera } = createController();

      // Frame 1: baseline
      controller.recordFrame(16);

      // Rotate camera
      camera.rotation.y += 0.5;

      controller.previousSecond = performance.now() - 1001;
      controller.recordFrame(16);

      const history = controller.cameraHistory();
      expect(history[history.length - 1]).toBe('rot');
    });

    it('records "zoom" when camera FOV changes', () => {
      const { controller, camera } = createController();

      // Frame 1: baseline
      controller.recordFrame(16);

      // Zoom in
      camera.fov = 30;

      controller.previousSecond = performance.now() - 1001;
      controller.recordFrame(16);

      const history = controller.cameraHistory();
      expect(history[history.length - 1]).toBe('zoom');
    });

    it('records "rot+zoom" when camera rotates and zooms in same second', () => {
      const { controller, camera } = createController();

      controller.recordFrame(16);

      camera.rotation.y += 0.5;
      camera.fov = 30;

      controller.previousSecond = performance.now() - 1001;
      controller.recordFrame(16);

      const history = controller.cameraHistory();
      expect(history[history.length - 1]).toBe('rot+zoom');
    });

    it('records "move" when camera position changes', () => {
      const { controller, camera } = createController();

      controller.recordFrame(16);

      camera.position.x += 10;

      controller.previousSecond = performance.now() - 1001;
      controller.recordFrame(16);

      const history = controller.cameraHistory();
      expect(history[history.length - 1]).toBe('move');
    });

    it('records "move+zoom" (not "zoom") when position and FOV change without rotation', () => {
      const { controller, camera } = createController();
      controller.recordFrame(16);

      camera.position.x += 10;
      camera.fov = 30;

      controller.previousSecond = performance.now() - 1001;
      controller.recordFrame(16);

      const history = controller.cameraHistory();
      expect(history[history.length - 1]).toBe('move+zoom');
    });

    it('records "orbit" when position and rotation change in the same frame', () => {
      const { controller, camera } = createController();
      controller.recordFrame(16);

      camera.position.x += 10;
      camera.rotation.y += 0.5;

      controller.previousSecond = performance.now() - 1001;
      controller.recordFrame(16);

      const history = controller.cameraHistory();
      expect(history[history.length - 1]).toBe('orbit');
    });
  });

  describe('performance drops and agent export', () => {
    it('detects drop event when FPS drops significantly', () => {
      const { controller } = createController();

      // Second 1: establish baseline at 60 FPS (simulate 60 frames)
      controller.previousSecond = performance.now();
      for (let i = 0; i < 59; i++) {
        controller.recordFrame(16.6);
      }
      controller.previousSecond = performance.now() - 1001;
      controller.recordFrame(16.6);

      expect(controller.displayCount()).toBe(60);

      // Second 2: simulate drop to 20 FPS (20 frames, high frame time)
      controller.previousSecond = performance.now();
      for (let i = 0; i < 19; i++) {
        controller.recordFrame(50);
      }
      controller.previousSecond = performance.now() - 1001;
      controller.recordFrame(50);

      expect(controller.displayCount()).toBe(20);

      const drop = controller.recentDropEvent();
      expect(drop).not.toBeNull();
      expect(drop?.baselineFps).toBe(60);
      expect(drop?.dropFps).toBe(20);
    });

    it('detects a gradual decline that never drops 20% in a single second', () => {
      const { controller } = createController();
      const second = (frames: number) => {
        controller.previousSecond = performance.now();
        for (let i = 0; i < frames - 1; i++) {
          controller.recordFrame(1000 / frames);
        }
        controller.previousSecond = performance.now() - 1001;
        controller.recordFrame(1000 / frames);
      };

      [144, 136, 128, 120, 112].forEach(second);
      expect(controller.recentDropEvent()).toBeNull();

      second(90); // 90 <= 0.8 * mean(144..112 = 128)
      expect(controller.recentDropEvent()).not.toBeNull();
      expect(controller.recentDropEvent()?.dropFps).toBe(90);
    });

    it('omits stale drop events and zero/unavailable timings from the report', () => {
      const { controller } = createController();
      controller.recordFrame(16);
      controller.recentDropEvent.set({
        timestamp: performance.now() - 120_000,
        baselineFps: 60,
        dropFps: 20,
        worstFrameMs: 50,
        cameraAction: 'orbit',
        cameraPosition: [0, 0, 0],
        drawCallsDelta: 0,
        trianglesDelta: 0,
      });

      const output = controller.formatTelemetryForAgent();
      expect(output).not.toContain('drop_event');
      expect(output).not.toContain('physics');
      expect(output).not.toContain('assetLoad');
      expect(output).not.toContain('gpu n/a');
    });

    it('explains the status level and reports the worst real frame interval', () => {
      const { controller } = createController({
        render: { calls: 400, drawCalls: 400, triangles: 3_000_000 },
      });
      controller.recordFrame(16);

      expect(controller.status()).toBe('critical');
      expect(controller.statusReason()).toBe('calls>=300,tris>=2M');

      const output = controller.formatTelemetryForAgent();
      expect(output).toContain('status: critical (calls>=300,tris>=2M)');
      expect(output).toContain('worstFrame60s:');
    });

    it('tracks the longest frame-to-frame gap, not CPU time', async () => {
      const { controller } = createController();
      controller.recordFrame(1);
      await new Promise((r) => setTimeout(r, 40));
      controller.previousSecond = performance.now() - 1001;
      controller.recordFrame(1);

      expect(controller.maxSpikeMs()).toBeGreaterThanOrEqual(35);
    });

    it('formats telemetry for agent in compact markdown syntax', () => {
      const { controller } = createController();

      controller.recordFrame(16);

      const output = controller.formatTelemetryForAgent();
      expect(output).toContain('```triangular-telemetry');
      expect(output).toContain('status: good');
      expect(output).toContain('viewport: 1280x720@1');
      expect(output).toContain('camera: pos(0.0, 0.0, 0.0)');
      expect(output).toContain('```');
    });
  });
});
