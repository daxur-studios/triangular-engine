import { DoubleSide, Mesh, PerspectiveCamera, PlaneGeometry, Scene } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { abs, cameraPosition, float, Fn, length, normalize, positionWorld, screenUV, select, vec3 } from 'three/tsl';
import type { PlanetAtmosphere } from 'triangular-engine/atmosphere';

/**
 * Plan 081 bt-spike P1, demo-only: no library edits. A temporary shader on a test plane that shows, side by side, the
 * froxel haze (`binding.perspective()`, the in-air term a mesh would use) and the beyond-air sky term
 * (`backdrop.skyObject()`), with a red line where the camera distance meets the froxel range limit. The owner reviews the
 * screenshot to choose the blend band. Opened by `?spike=body-tint` on the lab page.
 */

/** Camera altitude above planet A, in metres. The range limit at this height is the spike's test distance. */
const SPIKE_ALTITUDE_M = 300_000;
/** The plane's yaw about the vertical axis: sets how fast its depth changes across the screen. */
const PLANE_YAW = 0.8;
/** Half-width of the red range marker, as a share of the range limit. */
const MARKER_BAND = 0.002;
/** The plane's surface colour: a constant grey, so only the haze varies. */
const SURFACE = vec3(0.3, 0.3, 0.3);

export interface BodyTintSpike {
  /** The froxel range limit at the spike altitude, in metres: the distance the red line marks. */
  readonly rangeMaxM: number;
  readonly plane: Mesh;
  dispose(): void;
}

export interface BodyTintSpikeOptions {
  readonly atmosphere: PlanetAtmosphere;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  /** Planet A's radius in mesh units, with its centre at the origin. */
  readonly radiusUnits: number;
}

/**
 * Sets the camera {@link SPIKE_ALTITUDE_M} above the planet, looking level, and puts a plane in space ahead of it whose
 * depth runs across the range limit. Left half of the screen: the froxel result. Right half: the sky result.
 */
export function installBodyTintSpike(options: BodyTintSpikeOptions): BodyTintSpike {
  const { atmosphere, scene, camera, radiusUnits } = options;
  const binding = atmosphere.binding;
  const metersPerUnit = binding.metersPerUnit.value as number;
  const altitudeUnits = SPIKE_ALTITUDE_M / metersPerUnit;

  const rangeMaxM = binding.aerialPerspective?.rangeFor(SPIKE_ALTITUDE_M).max ?? 1;
  const distanceUnits = rangeMaxM / metersPerUnit;
  const cameraY = radiusUnits + altitudeUnits;
  camera.position.set(0, cameraY, 0);
  camera.lookAt(0, cameraY, -1);
  camera.updateMatrixWorld();

  // Depth runs D0 ± 0.6 D0 across the plane, so it straddles the range limit at D0.
  const halfWidth = (0.6 * distanceUnits) / Math.sin(PLANE_YAW);
  const geometry = new PlaneGeometry(2 * halfWidth, 0.3);
  const material = new MeshBasicNodeMaterial({ side: DoubleSide });
  const plane = new Mesh(geometry, material);
  plane.rotation.y = PLANE_YAW;
  plane.position.set(0, cameraY + 0.15, -distanceUnits);
  scene.add(plane);

  // The sky and froxel terms use TSL `If` branches, which need a shader build context: build them inside an `Fn`.
  const shade = Fn(() => {
    const toFragment = positionWorld.sub(cameraPosition);
    const distance = length(toFragment);
    const direction = normalize(toFragment);
    const froxel = binding.perspective()(
      { sphereNormal: vec3(0, 1, 0), radialDirection: vec3(0, 1, 0), cameraDistance: distance },
      SURFACE,
    );
    const sky = atmosphere.backdrop.skyObject(SURFACE, direction);
    const side = select(screenUV.x.lessThan(0.5), froxel, sky);
    const onLimit = abs(distance.mul(metersPerUnit).sub(float(rangeMaxM))).lessThan(float(rangeMaxM * MARKER_BAND));
    return select(onLimit, vec3(1, 0, 0), side);
  });
  material.outputNode = shade() as any;

  return {
    rangeMaxM,
    plane,
    dispose: () => {
      scene.remove(plane);
      geometry.dispose();
      material.dispose();
    },
  };
}
