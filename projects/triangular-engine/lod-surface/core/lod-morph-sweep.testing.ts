import { Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { cellPlanetHeights } from './lod-cell-planet-heights';
import { groundFrame, type LodDomain, type Vec3 } from './lod-domain';
import type { BakeClient } from './lod-height-bake-client';
import { runBake } from './lod-height-noise';
import { FIXTURE_GROUND, FIXTURE_HEADING_RAD, cellPlanetFor } from './lod-height-terrain';
import type { TextureHeightSource } from './lod-height-texture';
import type { LodTerrainBody, LodTerrainSettings } from './lod-terrain-body';
import type { CameraAxes } from './lod-view';

/**
 * Shared set-up of the morph sweep specs (`lod-morph-sweep.bench.spec.ts`, `lod-morph-settle.spec.ts`): the demo's `planet-scene`
 * values on the CPU, headless. Plan 059, G6 investigation.
 *
 * The page's values: radius 600 km (`PLANET_RADIUS_M`), the orbit pose (altitude 2 R = 1,200 km, pitch -90 degrees, the fixture
 * heading and ground point), a 60 degree vertical field of view, the cell planet of `cellPlanetFor(R)` baked with the default bake,
 * `<planetTerrain>`'s defaults (16 cells, 4 px cells, 4,096 leaves, hysteresis 0.15, detail noise 0.04, culling on, morph and pole
 * fan on), and the morph `0 -> 1 -> 0` over 835 frames with the demo's smoothstep.
 */

export const DEG = Math.PI / 180;
export const RADIUS_M = 600_000;
export const ORBIT_ALTITUDE_M = 2 * RADIUS_M;
export const ORBIT_PITCH = -90 * DEG;
export const FOV_DEG = 60;
export const ASPECT = 16 / 9;
export const VIEWPORT_PX = 1080;
export const FRAMES = 835;
export const GROUND: Vec3 = FIXTURE_GROUND.sphere;
export const HEADING = FIXTURE_HEADING_RAD.sphere;
export const DOMAIN: LodDomain = { kind: 'sphere', sizeM: RADIUS_M, warp: 'equal-angle' };

/** The page's terrain settings, over the given heights. */
export function pageTerrainSettings(heights: TextureHeightSource): LodTerrainSettings {
  return { domain: DOMAIN, heights, detailNoise: 0.04, leafCap: 4096, cellPixels: 4, patchCells: 16, hysteresis: 0.15, cull: true, morph: true, poleFan: true };
}

/** A bake that runs on the calling thread (the spec has no worker). */
export const inlineBake: BakeClient = (source, layout, planet) => Promise.resolve({ ...runBake(source, layout, planet), roundTripMs: 0 });

let heightsPromise: Promise<TextureHeightSource> | undefined;
/** The cell planet's heights of the page, baked once per spec bundle. */
export function pageHeights(): Promise<TextureHeightSource> {
  return (heightsPromise ??= cellPlanetHeights(inlineBake, { ...cellPlanetFor(RADIUS_M), radius: RADIUS_M }));
}

export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** `morphSweepValue` of the demo's `planet-camera.ts`: 0 at the start, 1 in the middle, 0 at the end. */
export function sweepMorph(frame: number): number {
  const s = frame / (FRAMES - 1);
  const x = s < 0.5 ? 2 * s : 2 - 2 * s;
  return x * x * (3 - 2 * x);
}

/** The orbit pose and its view: the camera, its axes and the frustum's field of view in radians. */
export interface OrbitView {
  readonly camera: PerspectiveCamera;
  readonly axes: CameraAxes;
  readonly position: Vec3;
  readonly frustumFov: number;
  /** The terrain height under the ground point, metres (the orbit is lifted by it). */
  readonly groundHeightM: number;
}

/**
 * The page's orbit camera over `body`, built as `resolvePlanetCamera` builds it, lifted by the terrain's height under the ground point
 * (as the page does). `body` must be configured (its `groundAt` is the height).
 */
export function orbitView(body: LodTerrainBody): OrbitView {
  const { up, east, north } = groundFrame('sphere', GROUND);
  const groundHeight = body.groundAt([up[0] * RADIUS_M, up[1] * RADIUS_M, up[2] * RADIUS_M]).heightM;
  const ch = Math.cos(HEADING);
  const sh = Math.sin(HEADING);
  const cp = Math.cos(ORBIT_PITCH);
  const sp = Math.sin(ORBIT_PITCH);
  const forward = [0, 1, 2].map((k) => cp * (ch * north[k] + sh * east[k]) + sp * up[k]) as Vec3;
  const right = [0, 1, 2].map((k) => ch * east[k] - sh * north[k]) as Vec3;
  const cameraUp = cross(right, forward);
  const back: Vec3 = [-forward[0], -forward[1], -forward[2]];
  const lift = RADIUS_M + groundHeight + ORBIT_ALTITUDE_M;
  const camera = new PerspectiveCamera(FOV_DEG, ASPECT, 1000, 1e9);
  camera.position.set(up[0] * lift, up[1] * lift, up[2] * lift);
  camera.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(new Vector3(...right), new Vector3(...cameraUp), new Vector3(...back)));
  camera.updateMatrixWorld(true);
  const axes: CameraAxes = { right, up: cameraUp, forward };
  const position: Vec3 = [camera.position.x, camera.position.y, camera.position.z];
  return { camera, axes, position, frustumFov: 2 * Math.atan(Math.tan((FOV_DEG * DEG) / 2)), groundHeightM: groundHeight };
}

/** The pixel angle of one pixel at the page's viewport, as `LodTerrainBody.update` takes it from the camera. */
export const PIXEL_ANGLE = (2 * Math.tan((FOV_DEG * DEG) / 2)) / VIEWPORT_PX;

/** Lets the browser run other tasks (Karma's ping) between frames: a bench that blocks it for seconds is disconnected. */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}
