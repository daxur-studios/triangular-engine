import { BehaviorSubject, Subject } from 'rxjs';
import { InstancedMesh, Mesh, BoxGeometry, MeshBasicMaterial, PerspectiveCamera, Scene } from 'three';
import type { EngineService } from 'triangular-engine';
import { PerfHarness } from './perf-harness';
import { PERF_SCENARIOS, findPerfScenario, gridPosition, mulberry32, resolvePerfParams } from './perf-scenarios';

/**
 * Minimal stand-in for EngineService: the harness only needs the frame
 * subjects, a scene/camera and renderer.info. `render()` counts draw calls
 * and triangles like three's WebGLInfo so scenario checks can be exercised
 * without a WebGL context.
 */
class FakeEngine {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera();
  readonly renderComplete$ = new Subject<{ frameId: number; renderedAt: number }>();
  readonly tick$ = new BehaviorSubject<number>(0);
  readonly error$ = new Subject<{ phase: string; error: unknown }>();
  readonly elapsedTime$ = new BehaviorSubject<number>(0);
  readonly renderer = {
    info: { render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 }, programs: [] as unknown[] },
    domElement: document.createElement('canvas'),
  };
  private frameId = 0;
  private timer?: number;

  start(): void {
    // Calls through the instance property, as the real animation loop does.
    this.timer = window.setInterval(() => this.tick(performance.now()), 5);
  }

  stop(): void {
    window.clearInterval(this.timer);
  }

  tick(time: number): void {
    this.tick$.next(0.016);
    this.elapsedTime$.next(this.elapsedTime$.value + 0.016);
    this.render(time);
  }

  render(_time: number): void {
    let calls = 0;
    let triangles = 0;
    this.scene.traverseVisible((object) => {
      if (!(object as Mesh).isMesh) return;
      const mesh = object as Mesh;
      const perInstance = (mesh.geometry.index?.count ?? mesh.geometry.attributes['position'].count) / 3;
      const instances = (mesh as InstancedMesh).isInstancedMesh ? (mesh as InstancedMesh).count : 1;
      if (instances === 0) return;
      calls++;
      triangles += perInstance * instances;
    });
    this.renderer.info.render.calls = calls;
    this.renderer.info.render.triangles = triangles;
    this.renderComplete$.next({ frameId: ++this.frameId, renderedAt: performance.now() });
  }
}

describe('PerfHarness', () => {
  let engine: FakeEngine;
  let harness: PerfHarness;

  beforeEach(() => {
    engine = new FakeEngine();
    harness = new PerfHarness(engine as unknown as EngineService);
    engine.start();
  });

  afterEach(() => {
    engine.stop();
    harness.destroy();
  });

  it('loads a scenario and reports passing functional checks', async () => {
    const result = await harness.load('instanced-static', { count: 100 });
    expect(result.params['count']).toBe(100);
    expect(result.facts.frame.drawCalls).toBe(1);
    expect(result.facts.frame.triangles).toBe(100 * 12);
    expect(result.facts.checks.every((check) => check.pass)).toBeTrue();
    expect(result.setupMs).toBeGreaterThanOrEqual(0);
  });

  it('subtracts draw calls the page renders outside the scenario', async () => {
    engine.scene.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()));
    const result = await harness.load('empty');
    expect(result.facts.overhead.drawCalls).toBe(1);
    expect(result.facts.checks.every((check) => check.pass)).toBeTrue();
  });

  it('samples frame intervals, tick and render timings while measuring', async () => {
    await harness.load('instanced-dynamic', { count: 50 });
    const window = await harness.measure({ warmupMs: 0, durationMs: 120 });
    expect(window.frames).toBeGreaterThan(2);
    expect(window.cpuFrameMs.length).toBeGreaterThan(0);
    expect(window.renderCpuMs.length).toBeGreaterThan(0);
    expect(window.frameIntervalMs.length).toBe(window.frames - 1);
    expect(window.custom['scenarioUpdateMs']?.length).toBeGreaterThan(0);
    expect(window.errors).toEqual([]);
  });

  it('records scatter bucketing and build timings on rebuild', async () => {
    await harness.load('scatter-lod-rebuild', { count: 300 });
    const window = await harness.measure({ warmupMs: 0, durationMs: 80 });
    expect(window.custom['scatterBucketMs']?.length).toBeGreaterThan(0);
    expect(window.custom['scatterBuildMs']?.length).toBeGreaterThan(0);
    const facts = await harness.facts();
    expect(Number(facts.scenarioFacts['rebuilds'])).toBeGreaterThan(1);
    expect(facts.checks.every((check) => check.pass)).toBeTrue();
  });

  it('rejects measuring before load, unknown scenarios and unknown params', async () => {
    await expectAsync(harness.measure({ warmupMs: 0, durationMs: 10 })).toBeRejectedWithError(/NOT_LOADED/);
    await expectAsync(harness.load('missing')).toBeRejectedWithError(/SCENARIO_NOT_FOUND/);
    await expectAsync(harness.load('instanced-static', { nope: 1 })).toBeRejectedWithError(/INVALID_PARAM/);
  });

  it('reports template-driven scenarios as unsupported without a host', async () => {
    await expectAsync(harness.load('instanced-component', { count: 10 })).toBeRejectedWithError(/UNSUPPORTED/);
  });

  it('unloads scenario objects and removes its instrumentation on destroy', async () => {
    await harness.load('meshes-individual', { count: 10 });
    await harness.unload();
    expect((await harness.facts()).frame.drawCalls).toBe(0);
    expect(Object.prototype.hasOwnProperty.call(engine, 'tick')).toBeTrue();
    harness.destroy();
    expect(Object.prototype.hasOwnProperty.call(engine, 'tick')).toBeFalse();
    expect(Object.prototype.hasOwnProperty.call(engine, 'render')).toBeFalse();
    expect(engine.scene.getObjectByName('perf-harness-root')).toBeUndefined();
  });
});

describe('perf scenarios', () => {
  it('have unique ids and resolve their defaults', () => {
    const ids = PERF_SCENARIOS.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const scenario of PERF_SCENARIOS) expect(resolvePerfParams(scenario)).toEqual(scenario.defaults);
    expect(() => findPerfScenario('missing')).toThrowError(/SCENARIO_NOT_FOUND/);
  });

  it('place instances deterministically', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(gridPosition(0, 4, 2)).toEqual([-1, 0, -1]);
    expect(gridPosition(3, 4, 2)).toEqual([1, 0, 1]);
  });
});
