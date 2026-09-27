import { Scene } from 'three';
import { FPSController } from './fps.controller';
import { IEngine } from './engine.model';

describe('FPSController renderer draw calls', () => {
  function createController(render: { calls: number; drawCalls?: number }) {
    const engine = {
      renderer: {
        info: {
          render: { ...render, triangles: 12 },
          memory: { geometries: 0, textures: 0 },
          programs: [],
        },
      },
      scene: new Scene(),
      options: {},
    } as unknown as IEngine;
    const controller = new FPSController(engine);
    controller.previousSecond = 0;
    return controller;
  }

  it('uses WebGPU drawCalls instead of the cumulative renderer calls counter', () => {
    const controller = createController({ calls: 5000, drawCalls: 24 });

    controller.recordFrame(16);

    expect(controller.drawCalls()).toBe(24);
  });

  it('continues to use WebGL calls when drawCalls is unavailable', () => {
    const controller = createController({ calls: 24 });

    controller.recordFrame(16);

    expect(controller.drawCalls()).toBe(24);
  });
});
