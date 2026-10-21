import { Vector3 } from 'three';
import { CellPlanetMorphCameraRig } from 'triangular-engine/worldgen/render';
import { GpuPassRecorder, summarizeGpuPasses, type IGpuPassSummary } from 'triangular-engine';
import { TestSession, buildTestLaunchUrl, parseTestLaunch, validateTestHistory, type TestSetting, type TestSuite } from 'triangular-engine/testing';
import { adapterLabel, describeGpuAdapter } from './gpu-adapter-info';
import {
  CAMERA_POSES, FREE_CAMERA_MAX_ALTITUDE_RADII, FREE_CAMERA_MIN_ALTITUDE_M, cameraViewFromPose, lookCameraView, panCameraView,
  resolveCameraPose, resolveCameraView, zoomCameraView,
} from './planet-shape-camera';
import { BODIES, SPIN_PERIOD_S, spinAngleAfter, sunDirectionBody } from './planet-shape-config';
import { FEATURES, defaultFeatureState, featureMismatches, shadowsActive, withFeature } from './planet-shape-features';
import { MORPH_CENTRE, createCameraRelativeSphereGeometry, createPlainSphereMaterial } from './planet-shape-sphere';
import {
  changedPixels, compareQuality, countHoles, frameFromProbeRgba, referenceFacetUv, referenceSphereFrame, surfaceCoordinateErrors,
  type QualityFrame, type QualityProbeCamera,
} from './planet-shape-quality';
import {
  createPlanetShapeTestAdapter, settingsMismatches, type PlanetShapeFrameSummary, type PlanetShapeSceneInfo, type PlanetShapeTestHost,
} from './planet-shape-test-adapter';
import { PLANET_SHAPE_DEFAULTS, PLANET_SHAPE_TEST_HISTORY, type PlanetShapeTestSettings } from './planet-shape-tests';

/** Frames come from a 16 ms timer, so the real adapter and session run without a GPU. */
class FakeHost implements PlanetShapeTestHost {
  state: PlanetShapeTestSettings = { ...PLANET_SHAPE_DEFAULTS, spinAngleDeg: 12 };
  frames = 0;
  sampling = false;
  error = '';
  webgpu = true;
  software = false;
  gpuPasses: IGpuPassSummary | null = null;
  readonly before = new Set<() => void>();
  readonly render = new Set<(at: number) => void>();
  private readonly timer = setInterval(() => {
    for (const callback of [...this.before]) callback();
    this.frames++;
    for (const callback of [...this.render]) callback(performance.now());
  }, 16);

  dispose(): void { clearInterval(this.timer); }
  read(): PlanetShapeTestSettings { return this.state; }
  apply(settings: PlanetShapeTestSettings): void { this.state = settings; }
  renderedFrames(): number { return this.frames; }
  errors(): string { return this.error; }
  resetErrors(): void { this.error = ''; }
  backendIsWebGpu(): boolean { return this.webgpu; }
  scene(): PlanetShapeSceneInfo {
    const drawn = this.state.kind !== 'empty';
    return { bodyDrawn: drawn, drawCalls: drawn ? 1 : 0, triangles: drawn ? 261_120 : 0, drawingBuffer: [2560, 1440] };
  }
  onBeforeRender(callback: () => void): () => void { this.before.add(callback); return () => this.before.delete(callback); }
  onRenderComplete(callback: (at: number) => void): () => void { this.render.add(callback); return () => this.render.delete(callback); }
  isSampling(): boolean { return this.sampling; }
  startSampling(): void { this.sampling = true; }
  gpuSamplesSoFar(): readonly number[] { return []; }
  thumbnail?: () => Promise<Blob | undefined>;
  qualityProbe?: PlanetShapeTestHost['qualityProbe'];
  stopSampling(): PlanetShapeFrameSummary {
    this.sampling = false;
    return {
      frames: 90, cpuMedianMs: 2, cpuP95Ms: 3, wallMedianMs: 16, wallP95Ms: 18, gpuMedianMs: null, gpuSamples: 0, invalidReasons: [], verdict: 'ok',
      gpuPasses: this.gpuPasses,
    };
  }
  environment(): Record<string, TestSetting> {
    return { backend: this.webgpu ? 'webgpu' : 'webgl2', 'gpu.software': this.software, 'gpu.timestampQuery': this.gpuPasses !== null };
  }
}

/** A small probe camera of a named pose, as the page builds it. */
function probeCamera(poseId: 'orbit' | 'ground', bodyId: '600km' | '6371km'): { camera: QualityProbeCamera; radiusM: number } {
  const pose = resolveCameraPose(poseId, bodyId);
  return {
    camera: { position: pose.position, forward: pose.forward, up: pose.up, fovDeg: 60, near: pose.near, far: pose.far },
    radiusM: BODIES.find((body) => body.id === bodyId)!.radiusM,
  };
}

/** A frame as the probe would read it: the reference itself, optionally with pixels knocked out. */
function withHoles(frame: QualityFrame, holes: readonly number[]): QualityFrame {
  const distance = Float32Array.from(frame.distance);
  for (const i of holes) distance[i] = NaN;
  return { ...frame, distance };
}

/** A reference frame with the exact facet uv filled in, as a perfect probe would read it. */
function withSurface(frame: QualityFrame, camera: QualityProbeCamera, radiusM: number, segments: { width: number; height: number }): QualityFrame {
  const u = new Float32Array(frame.distance.length).fill(NaN);
  const v = new Float32Array(frame.distance.length).fill(NaN);
  for (let i = 0; i < frame.distance.length; i++) {
    if (Number.isNaN(frame.distance[i])) continue;
    const exact = referenceFacetUv(camera, radiusM, segments, frame.width, frame.height, i % frame.width, Math.floor(i / frame.width), frame.distance[i]);
    if (exact) {
      u[i] = exact.u;
      v[i] = exact.v;
    }
  }
  return { ...frame, distance: Float32Array.from(frame.distance), u, v };
}

/** The engine's per-pass summary for `frames` frames of a scene and an output pass, with the given timestamp step. */
function gpuPassesOf(frames: number, stepNs: number): IGpuPassSummary {
  const recorder = new GpuPassRecorder();
  const records = [];
  for (let frame = 1; frame <= frames; frame++) {
    recorder.record(`r:1:2:f${frame}`, { name: 'Lab' }, null);
    recorder.record(`r:2:5:f${frame}`, { name: 'Output Color Transform', isQuadMesh: true }, null);
    const ms = (steps: number) => (steps * stepNs) / 1e6;
    records.push({ batch: recorder.attribute(new Map([[`r:1:2:f${frame}`, ms(80 + frame)], [`r:2:5:f${frame}`, ms(5)]])), totalMatches: true });
  }
  return summarizeGpuPasses(records)!;
}

const [BASELINE, MORPH, SHADOWS_AB, QUALITY] = PLANET_SHAPE_TEST_HISTORY;
const quick = (...ids: string[]): TestSuite<PlanetShapeTestSettings> => ({
  ...BASELINE,
  scenarios: BASELINE.scenarios.filter((scenario) => ids.includes(scenario.id)).map((scenario) => ({ ...scenario, durationMs: 300, warmupMs: 0 })),
});
const run = (host: FakeHost, suite: TestSuite<PlanetShapeTestSettings>, profile: 'headless-hardware' | 'visible-browser' = 'visible-browser',
  mode: 'quick' | 'standard' = 'standard') =>
  new TestSession<PlanetShapeTestSettings, PlanetShapeTestSettings>().run(suite, createPlanetShapeTestAdapter(host), { repetitions: 1, profile, mode });

describe('planet shape lab', () => {
  describe('camera poses', () => {
    it('resolves every pose on every body to a finite orthonormal view above the surface', () => {
      for (const body of BODIES) for (const pose of CAMERA_POSES) {
        const view = resolveCameraPose(pose.id, body.id);
        const length = (v: readonly number[]) => Math.hypot(...v);
        const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        expect(length(view.forward)).withContext(`${pose.id} ${body.id}`).toBeCloseTo(1, 12);
        expect(length(view.up)).toBeCloseTo(1, 12);
        expect(dot(view.forward, view.up)).toBeCloseTo(0, 12);
        expect(length(view.position)).toBeCloseTo(body.radiusM + view.altitudeM, 4);
        expect(view.altitudeM).toBeGreaterThan(0);
        expect(view.near).toBeLessThan(view.far);
      }
    });

    it('places the ground pose 2 m up and the orbit pose looking at the centre', () => {
      expect(resolveCameraPose('ground', '6371km').altitudeM).toBe(2);
      const orbit = resolveCameraPose('orbit', '600km');
      const toCentre = orbit.position.map((c) => -c / Math.hypot(...orbit.position));
      for (let i = 0; i < 3; i++) expect(orbit.forward[i]).toBeCloseTo(toCentre[i], 12);
    });

    it('points the horizon pose exactly along the horizon', () => {
      const view = resolveCameraPose('horizon-grazing', '600km');
      const radial = view.position.map((c) => c / Math.hypot(...view.position));
      const along = view.forward[0] * radial[0] + view.forward[1] * radial[1] + view.forward[2] * radial[2];
      // The line of sight to the horizon is tangent to the sphere: its distance to the centre is the radius.
      const distanceToCentre = Math.hypot(...view.position) * Math.sqrt(1 - along * along);
      expect(distanceToCentre).toBeCloseTo(600_000, 3);
    });

    it('free camera starts at the named pose and stays inside its altitude and pitch limits', () => {
      const start = cameraViewFromPose('orbit', '600km');
      const named = resolveCameraPose('orbit', '600km');
      const free = resolveCameraView(start, '600km', 'free');
      for (let i = 0; i < 3; i++) expect(free.position[i]).toBeCloseTo(named.position[i], 6);

      let view = zoomCameraView(start, -1000, '600km');
      expect(resolveCameraView(view, '600km', 'free').altitudeM).toBe(FREE_CAMERA_MIN_ALTITUDE_M);
      view = zoomCameraView(start, 1000, '600km');
      expect(view.altitudeM).toBe(FREE_CAMERA_MAX_ALTITUDE_RADII * 600_000);
      view = lookCameraView(start, 0, -10);
      expect(view.pitchDeg).toBe(30);
      view = panCameraView(start, 0, 100, '600km');
      expect(Math.abs(view.latDeg)).toBeLessThanOrEqual(89.9);
      expect(Number.isFinite(resolveCameraView(view, '600km', 'free').forward[0])).toBeTrue();
    });

    it('free camera pans so the ground follows the pointer: dragging down looking north moves the camera north', () => {
      const start = { ...cameraViewFromPose('orbit', '600km'), headingDeg: 0 };
      expect(panCameraView(start, 0, 0.1, '600km').latDeg).toBeGreaterThan(start.latDeg);
      expect(panCameraView(start, 0.1, 0, '600km').lonDeg).toBeLessThan(start.lonDeg);
    });
  });

  describe('camera-relative sphere', () => {
    it('keeps high plus low equal to the exact position, so a 6,371 km body is placed to well under a millimetre', () => {
      const radius = 6_371_000;
      const geometry = createCameraRelativeSphereGeometry(radius, 16, 8);
      const high = geometry.getAttribute('position');
      const low = geometry.getAttribute('aPositionLow');
      const normal = geometry.getAttribute('normal');
      let worstHigh = 0;
      for (let i = 0; i < high.count; i++) {
        const length = Math.hypot(
          high.getX(i) + low.getX(i), high.getY(i) + low.getY(i), high.getZ(i) + low.getZ(i));
        expect(Math.abs(length - radius)).toBeLessThan(1e-3);
        worstHigh = Math.max(worstHigh, Math.abs(Math.hypot(high.getX(i), high.getY(i), high.getZ(i)) - radius));
        expect(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))).toBeCloseTo(1, 5);
      }
      // The float32 position alone is off by whole decimetres: that is what the low part exists to remove.
      expect(worstHigh).toBeGreaterThan(0.01);
    });
  });

  describe('morph', () => {
    it('drives the engine morph uniforms from the sphere material, clamped to 0..1, in dynamic projection centred on +X', () => {
      const sphere = createPlainSphereMaterial();
      expect(sphere.morph.uMorph.value).toBe(0);
      sphere.setMorph(0.4);
      expect(sphere.morph.uMorph.value).toBe(0.4);
      sphere.setMorph(7);
      expect(sphere.morph.uMorph.value).toBe(1);
      sphere.setMorph(-1);
      expect(sphere.morph.uMorph.value).toBe(0);
      expect(sphere.morph.uProjMode.value).toBe(1);
      expect(MORPH_CENTRE.lonDeg).toBe(0);
      expect(sphere.morph.uProjForward.value.toArray().map((c) => Math.round(c * 1e6) / 1e6)).toEqual([0, 0, 1]);
      sphere.setBodyRadius(600_000);
      expect(sphere.morph.uRadius.value).toBe(600_000);
      expect(sphere.morph.uMapWidth.value).toBeCloseTo(2 * Math.PI * 600_000, 3);
      expect(sphere.material.positionNode).toBeTruthy();
      expect(sphere.material.normalNode).toBeTruthy();
      sphere.material.dispose();
    });

    it('gives the geometry the flat-map attributes the morph graph declares, without touching the body-fixed position', () => {
      const geometry = createCameraRelativeSphereGeometry(600_000, 16, 8);
      expect(geometry.getAttribute('aFlatPos').count).toBe(geometry.getAttribute('position').count);
      expect(geometry.getAttribute('aFlatNorm').count).toBe(geometry.getAttribute('position').count);
      expect(geometry.getAttribute('aPositionLow')).toBeDefined();
    });

    it('turns shadows off while morphed, and only then', () => {
      const on = withFeature(defaultFeatureState(), 'shadows', true);
      expect(shadowsActive(on, 0)).toBeTrue();
      expect(shadowsActive(on, 0.01)).toBeFalse();
      expect(shadowsActive(on, 1)).toBeFalse();
      expect(shadowsActive(defaultFeatureState(), 0)).toBeFalse();
    });

    it('leaves the camera on the globe pose at morph 0', () => {
      for (const pose of CAMERA_POSES) {
        expect(resolveCameraPose(pose.id, '600km', 0)).toEqual(resolveCameraPose(pose.id, '600km'));
      }
    });

    it('carries the camera onto the flat map at morph 1: same height over the same ground, facing the map', () => {
      const round = (v: readonly number[]): number[] => v.map((c) => Math.round(c * 1e6) / 1e6 + 0);
      const radius = 600_000;
      // The map is the plane z = 0 through the planet centre, centred on longitude 0, so the ground pose stands 2 m above it.
      const ground = resolveCameraPose('ground', '600km', 1);
      expect(round(ground.position)).toEqual([0, 0, 2]);
      expect(round(ground.forward)).toEqual([1, 0, 0]);
      expect(round(ground.up)).toEqual([0, 0, 1]);
      const orbit = resolveCameraPose('orbit', '600km', 1);
      expect(orbit.position[2]).toBeCloseTo(2.5 * radius, 3);
      expect(round(orbit.forward)).toEqual([0, 0, -1]);
      expect(orbit.near).toBe(resolveCameraPose('orbit', '600km').near);
    });

    // The spots that move most: off centre, both sides near the seam (lon ±180, the map's left and right edges), the seam
    // itself, high latitudes where Equal Earth squeezes the meridians, and next to a pole.
    const MORPH_SPOTS = [[30, 20], [175, 0], [-170, 45], [179.9, -30], [180, 0], [90, 80], [-60, -85], [0, 89.9]] as const;

    it('keeps height, pitch and heading over the anchored ground at every morph, at the centre, the edges and the poles', () => {
      const radius = 600_000;
      const rig = new CellPlanetMorphCameraRig({ radiusM: radius, projection: () => 'equalEarth' });
      for (const [lonDeg, latDeg] of MORPH_SPOTS) {
        const view = { lonDeg, latDeg, headingDeg: 40, pitchDeg: -35, altitudeM: 1_000, altitudeRadii: 0 };
        const lon = lonDeg * Math.PI / 180;
        const lat = latDeg * Math.PI / 180;
        const anchor = new Vector3(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon));
        for (const morph of [0, 0.25, 0.5, 0.75, 1]) {
          const at = `lon ${lonDeg} lat ${latDeg} morph ${morph}`;
          const pose = resolveCameraView(view, '600km', 'free', morph);
          const frame = rig.groundFrame(anchor, morph);
          expect([...pose.position, ...pose.forward, ...pose.up].every(Number.isFinite)).withContext(`finite at ${at}`).toBeTrue();
          const offset = new Vector3(...pose.position).sub(frame.position);
          expect(offset.dot(frame.normal)).withContext(`height at ${at}`).toBeCloseTo(1_000, 3);
          expect(offset.length()).withContext(`straight above at ${at}`).toBeCloseTo(1_000, 3);
          const forward = new Vector3(...pose.forward);
          const up = new Vector3(...pose.up);
          expect(forward.length()).withContext(`unit forward at ${at}`).toBeCloseTo(1, 9);
          expect(forward.dot(up)).withContext(`forward ⟂ up at ${at}`).toBeCloseTo(0, 9);
          expect(Math.asin(forward.dot(frame.normal)) * 180 / Math.PI).withContext(`pitch at ${at}`).toBeCloseTo(-35, 6);
          expect(Math.atan2(forward.dot(frame.east), forward.dot(frame.north)) * 180 / Math.PI).withContext(`heading at ${at}`)
            .toBeCloseTo(40, 6);
        }
      }
    });

    it('lands on the flat map plane at morph 1 at every spot, inside the Equal Earth outline', () => {
      const radius = 600_000;
      for (const [lonDeg, latDeg] of MORPH_SPOTS) {
        const view = { lonDeg, latDeg, headingDeg: 0, pitchDeg: -90, altitudeM: 2, altitudeRadii: 0 };
        const pose = resolveCameraView(view, '600km', 'free', 1);
        const at = `lon ${lonDeg} lat ${latDeg}`;
        // The map is the plane z = 0 facing +Z; the camera is 2 m in front of it, looking straight at it.
        expect(pose.position[2]).withContext(`2 m over the map at ${at}`).toBeCloseTo(2, 3);
        expect(pose.forward[2]).withContext(`looking at the map at ${at}`).toBeCloseTo(-1, 6);
        // The map is scaled to 2πR wide (`uMapWidth`): x within ±πR, y within ±0.4868πR (Equal Earth's height to width).
        expect(Math.abs(pose.position[0])).withContext(`x inside the map at ${at}`).toBeLessThanOrEqual(Math.PI * radius + 1);
        expect(Math.abs(pose.position[1])).withContext(`y inside the map at ${at}`).toBeLessThanOrEqual(0.4868 * Math.PI * radius);
      }
      // Longitude 180 is the seam: the frame puts it on the right edge, and a hair east of it is on the left edge.
      const seam = (lonDeg: number) => resolveCameraView({ lonDeg, latDeg: 0, headingDeg: 0, pitchDeg: -90, altitudeM: 2, altitudeRadii: 0 },
        '600km', 'free', 1).position[0];
      expect(seam(180)).toBeCloseTo(Math.PI * radius, 0);
      expect(seam(179.999)).toBeGreaterThan(0.99 * Math.PI * radius);
      expect(seam(-179.999)).toBeLessThan(-0.99 * Math.PI * radius);
    });

    it('defaults to 0 and is compared like any other setting', () => {
      expect(PLANET_SHAPE_DEFAULTS.morph).toBe(0);
      expect(settingsMismatches({ ...PLANET_SHAPE_DEFAULTS, morph: 0.5 }, PLANET_SHAPE_DEFAULTS)).toEqual(['morph: expected 0, found 0.5']);
    });
  });

  describe('spin and sun', () => {
    it('turns once per day at 1x and keeps the sun direction unit length', () => {
      expect(spinAngleAfter(0, SPIN_PERIOD_S / 4, 1)).toBeCloseTo(Math.PI / 2, 12);
      expect(spinAngleAfter(0, 1, 1_000_000)).toBeCloseTo((1e6 * 2 * Math.PI) / SPIN_PERIOD_S % (2 * Math.PI), 9);
      for (const angle of [0, 1, 4]) expect(Math.hypot(...sunDirectionBody(angle))).toBeCloseTo(1, 12);
      sunDirectionBody(2 * Math.PI).forEach((component, i) => expect(component).toBeCloseTo(sunDirectionBody(0)[i], 12));
    });
  });

  describe('feature registry', () => {
    it('starts honest: only real features, defaults readable and comparable', () => {
      expect(FEATURES.map((feature) => feature.id)).toEqual(['shadows']);
      expect(defaultFeatureState()).toEqual({ shadows: false });
      expect(featureMismatches(withFeature(defaultFeatureState(), 'shadows', true), defaultFeatureState())).toEqual([
        'feature shadows: expected false, found true']);
    });
  });

  describe('gpu adapter description', () => {
    it('flattens the adapter the renderer actually uses and the drawing buffer', () => {
      const info = describeGpuAdapter({
        backend: {
          isWebGPUBackend: true,
          device: {
            adapterInfo: { vendor: 'nvidia', architecture: 'ada-lovelace', device: '0x2684', description: 'NVIDIA GeForce RTX 4090' },
            features: { has: (name: string) => name === 'timestamp-query' },
          },
        },
        domElement: { width: 2560, height: 1440 },
        getPixelRatio: () => 1.5,
      }, 1.5);
      expect(info).toEqual(jasmine.objectContaining({
        backend: 'webgpu', 'gpu.source': 'renderer.backend.device.adapterInfo', 'gpu.vendor': 'nvidia', 'gpu.architecture': 'ada-lovelace',
        'gpu.device': '0x2684', 'gpu.description': 'NVIDIA GeForce RTX 4090', 'gpu.software': false, 'gpu.timestampQuery': true,
        'canvas.drawingBufferWidth': 2560, 'canvas.drawingBufferHeight': 1440, devicePixelRatio: 1.5, rendererPixelRatio: 1.5,
      }));
      expect(adapterLabel(info)).toBe('nvidia / ada-lovelace / 0x2684 / NVIDIA GeForce RTX 4090');
    });

    it('labels software adapters and reports a missing adapter instead of inventing one', () => {
      const software = describeGpuAdapter({ backend: { isWebGPUBackend: true, device: { adapterInfo: { vendor: 'google', description: 'SwiftShader Device' } } } }, 1);
      expect(software['gpu.software']).toBeTrue();
      const none = describeGpuAdapter({ backend: { isWebGPUBackend: true, device: {} } }, 1);
      expect(none['gpu.source']).toBe('unavailable');
      expect(none['gpu.software']).toBeNull();
      expect(adapterLabel(none)).toBe('adapter unavailable');
      expect(describeGpuAdapter(undefined, 1)['backend']).toBe('none');
    });
  });

  describe('quality metrics', () => {
    it('ray-traces the exact sphere: the orbit centre is the altitude, the ground pose sees sky above and ground 2 m below', () => {
      const orbit = probeCamera('orbit', '600km');
      const frame = referenceSphereFrame(orbit.camera, orbit.radiusM, 64, 36);
      // A pixel next to the image centre looks half a pixel (0.8 degrees here) past the planet centre: 1.5 R away, plus a little.
      const centre = frame.distance[18 * 64 + 32];
      expect(centre).toBeGreaterThan(1_500_000);
      expect(centre).toBeLessThan(1_500_000 * 1.001);
      expect(Number.isNaN(frame.distance[0])).toBeTrue();

      const ground = probeCamera('ground', '6371km');
      const view = referenceSphereFrame(ground.camera, ground.radiusM, 64, 36);
      expect(Array.from(view.distance.slice(0, 64)).every(Number.isNaN)).toBeTrue();
      // Bottom-centre ray: on a 6,371 km body 2 m up, the ground is flat to far under a millimetre at 4 m.
      const sy = (1 - (35.5 / 36) * 2) * Math.tan(Math.PI / 6);
      const sx = (32.5 / 64 * 2 - 1) * Math.tan(Math.PI / 6) * (64 / 36);
      const flat = (2 * Math.hypot(1, sx, sy)) / -sy;
      expect(Math.abs(view.distance[35 * 64 + 32] - flat)).toBeLessThan(1e-3);
    });

    it('finds no error against itself, and counts a hole as a crack, not a hole that opens onto the border', () => {
      const { camera, radiusM } = probeCamera('orbit', '600km');
      const reference = referenceSphereFrame(camera, radiusM, 64, 36);
      const clean = compareQuality(withHoles(reference, []), reference);
      expect(clean.cracks).toBe(0);
      expect(clean.silhouetteErrorPx.every((value) => value === 0)).toBeTrue();
      expect(clean.depthErrorM.every((value) => value < 0.1)).toBeTrue();
      expect(clean.drawnProbe).toBe(clean.drawnReference);

      const inside = 18 * 64 + 32;
      const cracked = compareQuality(withHoles(reference, [inside, inside + 1]), reference);
      expect(cracked.cracks).toBe(2);
      expect(Math.max(...cracked.silhouetteErrorPx)).toBe(1);
      // A frame wholly undrawn has no enclosed pixel.
      expect(countHoles({ width: 4, height: 3, distance: new Float32Array(12).fill(NaN) })).toBe(0);
    });

    it('reads the probe target: alpha 1 is drawn with its u/v, the cleared background is not', () => {
      const rgba = new Float32Array([5, 0.25, 0.75, 1, 0, 0, 0, 0, 7, 0.5, 0.5, 0.5]);
      const frame = frameFromProbeRgba(rgba, 3, 1);
      expect(frame.distance[0]).toBe(5);
      expect([frame.u![0], frame.v![0]]).toEqual([0.25, 0.75]);
      expect(Number.isNaN(frame.distance[1])).toBeTrue();
      expect(Number.isNaN(frame.distance[2])).toBeTrue();
      expect(Number.isNaN(frame.u![2])).toBeTrue();
      expect(changedPixels(frame, frame)).toBe(0);
      expect(changedPixels(frame, frameFromProbeRgba(new Float32Array([5.5, 0, 0, 1, 0, 0, 0, 0, 7, 0, 0, 1]), 3, 1))).toBe(2);
    });

    it('finds the exact uv on the lab sphere\'s own triangle, and turns a uv error into metres of ground', () => {
      const { camera, radiusM } = probeCamera('ground', '6371km');
      const segments = { width: 512, height: 256 };
      const frame = withSurface(referenceSphereFrame(camera, radiusM, 64, 36), camera, radiusM, segments);
      const clean = surfaceCoordinateErrors(frame, camera, radiusM, segments);
      expect(clean.unmatched).toBe(0);
      expect(clean.errorsM.length).toBeGreaterThan(0);
      // Storing the exact uv in float32 alone costs up to half a float32 step of u near 0.5 (2^-25 of the circumference,
      // 1.2 m at 6,371 km): the floor any float32 surface coordinate has on a body this size, before interpolation.
      expect(Math.max(...clean.errorsM)).toBeLessThan(2 ** -25 * 2 * Math.PI * radiusM * 1.05);
      // Every uv is in range, and the facet lies inside the sphere: its distance is never shorter than the sphere's.
      const centre = 35 * 64 + 32;
      const exact = referenceFacetUv(camera, radiusM, segments, 64, 36, 32, 35, frame.distance[centre])!;
      expect(exact.u).toBeGreaterThan(0);
      expect(exact.u).toBeLessThan(1);
      // A u off by one millionth is that fraction of the circumference at the latitude: about 40 m at the equator.
      const shifted = { ...frame, u: frame.u!.map((value) => value + 1e-6) };
      const errors = surfaceCoordinateErrors(shifted, camera, radiusM, segments).errorsM;
      const expected = 1e-6 * 2 * Math.PI * radiusM * exact.sinTheta;
      expect(Math.abs(errors[errors.length - 1] - expected)).toBeLessThan(0.05 * expected);
    });
  });

  describe('history', () => {
    it('is a valid performance suite with the noise floor, orbit and ground at three sizes', () => {
      expect(() => validateTestHistory(PLANET_SHAPE_TEST_HISTORY)).not.toThrow();
      expect(`${BASELINE.id}@${BASELINE.version}:${BASELINE.purpose}`).toBe('planet-shape-baseline@1:performance');
      expect(BASELINE.scenarios.map((scenario) => scenario.id)).toEqual([
        'empty-frame',
        'plain-sphere-orbit-64km', 'plain-sphere-ground-64km',
        'plain-sphere-orbit-600km', 'plain-sphere-ground-600km',
        'plain-sphere-orbit-6371km', 'plain-sphere-ground-6371km',
        'empty-frame-after',
      ]);
      expect(BASELINE.scenarios[0].settings.kind).toBe('empty');
    });

    it('judges the baseline suite: a committed baseline for every scenario and a GPU budget', () => {
      const ids = BASELINE.scenarios.map((scenario) => scenario.id);
      expect(Object.keys(BASELINE.baseline?.cases ?? {})).toEqual(ids);
      expect(BASELINE.baseline?.mode).toBe('standard');
      for (const scenario of BASELINE.scenarios) {
        expect(scenario.budgets?.['gpuPassTotal']?.p95).withContext(scenario.id).toBeGreaterThan(0);
        expect(Object.keys(BASELINE.baseline?.cases[scenario.id] ?? {})).withContext(scenario.id).toContain('gpuOutputPass');
      }
      expect(SHADOWS_AB.baseline).toBeUndefined();
      expect(SHADOWS_AB.scenarios.some((scenario) => scenario.budgets)).toBeFalse();
    });

    it('has the morph suite: 600 km, morph 0 / 0.5 / 1 at orbit and ground, budgeted, with a baseline for every case', () => {
      expect(() => validateTestHistory(PLANET_SHAPE_TEST_HISTORY)).not.toThrow();
      expect(`${MORPH.id}@${MORPH.version}:${MORPH.purpose}:${MORPH.expectedGpuVendor}`).toBe('planet-shape-morph@1:performance:nvidia');
      expect(MORPH.scenarios.map((scenario) => scenario.id)).toEqual([
        'morph-000-orbit-600km', 'morph-000-ground-600km', 'morph-050-orbit-600km', 'morph-050-ground-600km',
        'morph-100-orbit-600km', 'morph-100-ground-600km']);
      expect(MORPH.scenarios.map((scenario) => scenario.settings.morph)).toEqual([0, 0, 0.5, 0.5, 1, 1]);
      expect(MORPH.scenarios.map((scenario) => scenario.settings.poseId)).toEqual(['orbit', 'ground', 'orbit', 'ground', 'orbit', 'ground']);
      expect(MORPH.scenarios.every((scenario) => scenario.settings.bodyId === '600km' && scenario.settings.kind === 'sphere')).toBeTrue();
      expect(Object.keys(MORPH.baseline?.cases ?? {}).sort()).toEqual(MORPH.scenarios.map((scenario) => scenario.id).sort());
      expect(MORPH.baseline?.mode).toBe('standard');
      const sphereBudget = BASELINE.scenarios[1].budgets?.['gpuPassTotal']?.p95;
      for (const scenario of MORPH.scenarios) expect(scenario.budgets?.['gpuPassTotal']?.p95).withContext(scenario.id).toBe(sphereBudget);
      // The existing suites keep their experiment: morph 0 everywhere.
      for (const scenario of [...BASELINE.scenarios, ...SHADOWS_AB.scenarios]) expect(scenario.settings.morph).withContext(scenario.id).toBe(0);
    });

    it('alternates shadows off (A) and on (B) per pose in the A/B suite', () => {
      expect(`${SHADOWS_AB.id}@${SHADOWS_AB.version}`).toBe('planet-shape-shadows-ab@1');
      expect(SHADOWS_AB.ablation?.metrics).toEqual(['gpuPassTotal', 'gpuScenePass']);
      for (const group of ['orbit-600km', 'ground-600km']) {
        const rounds = SHADOWS_AB.scenarios.filter((scenario) => scenario.ablation?.group === group);
        expect(rounds.map((scenario) => scenario.ablation?.arm)).toEqual(['A', 'B', 'A', 'B', 'A', 'B']);
        expect(rounds.map((scenario) => scenario.settings.features.shadows)).toEqual([false, true, false, true, false, true]);
        expect(new Set(rounds.map((scenario) => `${scenario.settings.bodyId}/${scenario.settings.poseId}`)).size).toBe(1);
      }
    });

    it('has the quality suite: functional, every pose at every size, unmorphed and paused, no budgets', () => {
      expect(QUALITY.id).toBe('planet-shape-quality');
      expect(QUALITY.purpose).toBe('functional');
      expect(QUALITY.expectedGpuVendor).toBeUndefined();
      expect(QUALITY.scenarios.length).toBe(BODIES.length * CAMERA_POSES.length);
      expect(QUALITY.scenarios.every((item) => item.settings.probe === 'quality' && item.settings.morph === 0
        && item.settings.spinWarp === 0 && item.settings.kind === 'sphere' && !item.budgets)).toBeTrue();
      // The timing suites keep their settings unchanged: no probe field.
      expect([BASELINE, MORPH, SHADOWS_AB].every((suite) => suite.scenarios.every((item) => !('probe' in item.settings)))).toBeTrue();
    });

    it('builds and parses an exact-version launch link', () => {
      const base = 'http://triangular-demo.localhost:4200/planet-shape-lab';
      const url = buildTestLaunchUrl(base, BASELINE, 'visible-browser', 1);
      expect(parseTestLaunch(new URL(url), PLANET_SHAPE_TEST_HISTORY)?.key).toBe('planet-shape-baseline@1');
    });
  });

  describe('adapter run', () => {
    it('applies scenarios, checks the real state, reports metrics and restores the captured state', async () => {
      const host = new FakeHost();
      const before = host.state;
      try {
        const result = await run(host, quick('empty-frame', 'plain-sphere-ground-6371km'));
        expect(result.errors).toEqual([]);
        // A visible-browser profile in a headless run also records "Page was not focused", so the status stays inconclusive.
        expect(result.cases.map((item) => item.status)).toEqual(['completed', 'completed']);
        expect(result.automatedVerdict).toBe('pass');
        expect(result.cases.map((item) => item.checks.every((check) => check.passed))).toEqual([true, true]);
        expect(result.cases[0].checks.map((check) => check.name)).toContain('Planet not drawn');
        expect(result.cases[1].checks.map((check) => check.name)).toContain('Planet drawn');
        expect(result.cases[0].metrics.map((metric) => metric.name)).toEqual([
          'frameInterval', 'renderSubmitCpu', 'gpuScenePass', 'gpuShadowPasses', 'gpuOutputPass', 'gpuPassTotal']);
        expect(result.cases[0].metrics.slice(2).every((metric) => metric.optional)).toBeTrue();
        expect(result.cases[0].metrics[2].unavailableReason).toBe('No GPU timestamp query on this renderer');
        expect(host.state).toEqual(before);
        expect(host.before.size).toBe(0);
        expect(host.render.size).toBe(0);
        expect(host.sampling).toBeFalse();
      } finally { host.dispose(); }
    }, 20_000);

    it('applies the morph setting through the host, checks it and restores the captured value', async () => {
      const host = new FakeHost();
      const before = host.state;
      const seen: number[] = [];
      const applied = host.apply.bind(host);
      host.apply = (settings) => { seen.push(settings.morph); applied(settings); };
      const suite = { ...MORPH, scenarios: MORPH.scenarios.filter((scenario) => scenario.id === 'morph-050-ground-600km')
        .map((scenario) => ({ ...scenario, durationMs: 300, warmupMs: 0 })) };
      try {
        const result = await run(host, suite);
        expect(result.errors).toEqual([]);
        expect(result.cases[0].checks.find((check) => check.name === 'Scenario state applied as specified')?.passed).toBeTrue();
        expect(seen).toEqual([0.5, 0]);
        expect(host.state.morph).toBe(before.morph);
      } finally { host.dispose(); }
    }, 20_000);

    it('takes one still per scenario after the measurement, from the first repetition only', async () => {
      const host = new FakeHost();
      const seenWhileSampling: boolean[] = [];
      host.thumbnail = async () => { seenWhileSampling.push(host.sampling); return new Blob([new Uint8Array(8)], { type: 'image/webp' }); };
      const pictures: { scenarioId: string; repetition: number; images: number }[] = [];
      try {
        const result = await new TestSession<PlanetShapeTestSettings, PlanetShapeTestSettings>().run(
          quick('empty-frame', 'plain-sphere-ground-6371km'), createPlanetShapeTestAdapter(host),
          { repetitions: 2, profile: 'headless-hardware', mode: 'standard', onThumbnails: (entry) => { pictures.push({ scenarioId: entry.scenarioId, repetition: entry.repetition, images: entry.images.length }); } });
        expect(result.errors).toEqual([]);
        expect(pictures).toEqual([
          { scenarioId: 'empty-frame', repetition: 1, images: 1 },
          { scenarioId: 'plain-sphere-ground-6371km', repetition: 1, images: 1 },
        ]);
        // The sampling window is closed before the picture is taken.
        expect(seenWhileSampling).toEqual([false, false]);
      } finally { host.dispose(); }
    }, 20_000);

    it('offers no thumbnail hook when the page cannot take one', () => {
      const host = new FakeHost();
      try {
        expect(createPlanetShapeTestAdapter(host).thumbnail).toBeUndefined();
        host.thumbnail = async () => undefined;
        expect(createPlanetShapeTestAdapter(host).thumbnail).toBeDefined();
      } finally { host.dispose(); }
    });

    it('fails the backend check off WebGPU', async () => {
      const host = new FakeHost();
      host.webgpu = false;
      try {
        const result = await run(host, quick('plain-sphere-orbit-600km'));
        expect(result.cases[0].checks.find((check) => check.name === 'WebGPU backend in use')?.passed).toBeFalse();
        expect(result.status).toBe('failed');
      } finally { host.dispose(); }
    }, 20_000);

    it('marks a software renderer as invalid performance evidence', async () => {
      const host = new FakeHost();
      host.software = true;
      try {
        const result = await run(host, quick('empty-frame'), 'visible-browser');
        expect(result.cases[0].validityIssues).toContain('Software renderer: functional evidence only, not hardware performance');
        expect(result.performanceVerdict).toBe('inconclusive');
      } finally { host.dispose(); }
    }, 20_000);

    it('reports per-pass GPU metrics and passes the timer self-test on unrounded timestamps', async () => {
      const host = new FakeHost();
      host.gpuPasses = gpuPassesOf(20, 1024);
      try {
        const result = await run(host, quick('plain-sphere-orbit-600km'));
        const [item] = result.cases;
        const metric = (name: string) => item.metrics.find((entry) => entry.name === name)!;
        expect(metric('gpuScenePass').samples.length).toBe(20);
        expect(metric('gpuOutputPass').samples.length).toBe(20);
        expect(metric('gpuShadowPasses').unavailableReason).toBe('No shadow pass rendered (shadows feature off)');
        expect(item.checks.find((check) => check.name === 'GPU timer self-test')?.passed).toBeTrue();
        expect(item.details?.['gpuTimestampStepNs']).toBe(1024);
        expect(String(item.details?.['gpuPassLabels'])).toContain('Lab:');
      } finally { host.dispose(); }
    }, 20_000);

    it('runs the shadows A/B suite into one outcome per pose and metric', async () => {
      const host = new FakeHost();
      host.gpuPasses = gpuPassesOf(20, 1024);
      const short = { ...SHADOWS_AB, scenarios: SHADOWS_AB.scenarios.map((scenario) => ({ ...scenario, durationMs: 200, warmupMs: 0 })) };
      try {
        const result = await run(host, short);
        expect(result.ablations?.map((outcome) => `${outcome.group}/${outcome.metric}`)).toEqual([
          'orbit-600km/gpuPassTotal', 'orbit-600km/gpuScenePass', 'ground-600km/gpuPassTotal', 'ground-600km/gpuScenePass']);
        // The fake host times every round alike, so B cannot differ from A.
        expect(result.ablations?.every((outcome) => outcome.result.verdict === 'no-difference')).toBeTrue();
      } finally { host.dispose(); }
    }, 30_000);

    it('ends a quick-mode window early once frame pacing settles', async () => {
      const host = new FakeHost();
      const long = { ...quick('plain-sphere-orbit-600km'), scenarios: [{ ...quick('plain-sphere-orbit-600km').scenarios[0], durationMs: 4000 }] };
      try {
        const result = await run(host, long, 'visible-browser', 'quick');
        expect(result.mode).toBe('quick');
        expect(result.cases[0].window?.mode).toBe('quick');
        expect(result.cases[0].window?.elapsedMs).toBeLessThanOrEqual(4100);
        expect(Object.keys(result.cases[0].window?.samples ?? {})).toEqual(['frameInterval', 'renderSubmitCpu']);
      } finally { host.dispose(); }
    }, 20_000);

    it('fails the timer self-test when timestamps are rounded', async () => {
      const host = new FakeHost();
      host.gpuPasses = gpuPassesOf(20, 65_536);
      try {
        const result = await run(host, quick('plain-sphere-orbit-600km'));
        const check = result.cases[0].checks.find((entry) => entry.name === 'GPU timer self-test');
        expect(check?.passed).toBeFalse();
        expect(check?.detail).toContain('rounded to 65536 ns');
      } finally { host.dispose(); }
    }, 20_000);

    it('measures quality against the exact sphere without a timing window, and fails on a crack', async () => {
      const host = new FakeHost();
      let holes: number[] = [];
      host.qualityProbe = async () => {
        const { camera, radiusM } = probeCamera('orbit', '600km');
        const reference = referenceSphereFrame(camera, radiusM, 64, 36);
        return { frames: [withHoles(reference, holes), withHoles(reference, holes)], camera, radiusM, segments: { width: 512, height: 256 } };
      };
      const suite = { ...QUALITY, scenarios: QUALITY.scenarios.filter((item) => item.id === 'quality-orbit-600km') };
      try {
        const clean = await run(host, suite);
        expect(clean.errors).toEqual([]);
        expect(clean.automatedVerdict).toBe('pass');
        expect(clean.cases[0].metrics.map((metric) => metric.name)).toEqual([
          'silhouetteErrorPx', 'depthErrorM', 'depthErrorRelative', 'cracks', 'flickerPixels', 'surfaceCoordErrorM']);
        expect(clean.cases[0].metrics[3].samples).toEqual([0]);
        expect(host.sampling).toBeFalse();

        holes = [18 * 64 + 32];
        const cracked = await run(host, suite);
        expect(cracked.automatedVerdict).toBe('fail');
        expect(cracked.cases[0].checks.find((check) => check.name.startsWith('No cracks'))?.passed).toBeFalse();
      } finally { host.dispose(); }
    }, 20_000);

    it('names every field the page did not honour', () => {
      expect(settingsMismatches({ ...PLANET_SHAPE_DEFAULTS, bodyId: '64km', poseId: 'ground' }, PLANET_SHAPE_DEFAULTS)).toEqual([
        'bodyId: expected 600km, found 64km', 'poseId: expected orbit, found ground']);
    });
  });
});
