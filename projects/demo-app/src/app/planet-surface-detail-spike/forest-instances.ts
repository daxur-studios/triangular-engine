import { BufferGeometry, ConeGeometry, CylinderGeometry, IcosahedronGeometry, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { float, normalWorld, normalize, positionView, positionWorld, smoothstep, uniform } from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PlanetAtmosphereBinding } from 'triangular-engine/atmosphere';
import { FOREST_CROWN_WIDTH_M, FOREST_TREE_HEIGHT_M, SCATTER_STRIDE } from './forest-field';
import { ROCK_SIZE_RANGE_M } from './rock-field';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** A placeholder conifer: a cone crown on a short trunk, `FOREST_TREE_HEIGHT_M` tall and `FOREST_CROWN_WIDTH_M` wide. */
export function treeGeometry(): BufferGeometry {
  const trunkHeight = FOREST_TREE_HEIGHT_M * 0.2;
  const crownHeight = FOREST_TREE_HEIGHT_M - trunkHeight * 0.6;
  const trunk = new CylinderGeometry(0.35, 0.5, trunkHeight, 4, 1, true);
  trunk.translate(0, trunkHeight / 2, 0);
  const crown = new ConeGeometry(FOREST_CROWN_WIDTH_M / 2, crownHeight, 6, 1, true);
  crown.translate(0, trunkHeight * 0.6 + crownHeight / 2, 0);
  const parts = [trunk.toNonIndexed(), crown.toNonIndexed()];
  // Positions and normals only: the colour is one flat albedo lit by the planet stages.
  for (const part of parts) part.deleteAttribute('uv');
  return mergeGeometries(parts);
}

/** A placeholder boulder: a faceted lump one metre across, sunk a little into the ground. Scaled 1 to 3 per instance. */
export function rockGeometry(): BufferGeometry {
  const lump = new IcosahedronGeometry(0.5, 1).toNonIndexed();
  lump.scale(1, 0.62, 0.85);
  lump.translate(0, 0.12, 0);
  lump.deleteAttribute('uv');
  return lump;
}

/** How an instance's size and lift come from its cell's random draw. */
export interface IInstanceShape {
  /** Uniform scale in [min, max], or a three-axis scale. */
  scale(random: number): number;
  /** Extra yaw is always `random * 2 pi`; the ground lift (metres along the up axis) is fixed per class. */
  readonly liftM: number;
}

export const TREE_SHAPE: IInstanceShape = { scale: (r) => 0.75 + r * 0.5, liftM: 0 };
export const ROCK_SHAPE: IInstanceShape = { scale: (r) => ROCK_SIZE_RANGE_M[0] + r * (ROCK_SIZE_RANGE_M[1] - ROCK_SIZE_RANGE_M[0]), liftM: -0.1 };

export interface ISurfaceInstancesConfig {
  readonly geometry: BufferGeometry;
  readonly shape: IInstanceShape;
  readonly capacity: number;
  /** Colour of one instance, a node shared with the far form so both read the same albedo. */
  readonly albedo: any;
  /** Opacity at a camera distance (node): 1 near, 0 once the far form has taken over. */
  opacity(distance: any): any;
  /** How far from the window centre (metres) an instance can be before it is dissolved out: the window's own edge. */
  readonly windowRadiusM: number;
  /** Width of the dissolve inside that edge, metres. */
  readonly windowFadeM: number;
}

/**
 * One class of the near form: an `InstancedMesh` placed from `scatterCells`. The material runs the planet's own
 * lighting and aerial perspective (`binding.lighting()` and `binding.perspective()`, the stages the surface material
 * gets) on the albedo the far form uses, and dissolves with an alpha hash as the far form dissolves in.
 *
 * Two dissolves multiply: the class's distance band, and the window's edge. A window is only ever as big as the band
 * needs, but it recentres in steps and a camera can outrun a request; the edge dissolve makes the shortfall a fade
 * instead of a cut.
 */
export class SurfaceInstances {
  readonly mesh: InstancedMesh;
  private readonly material: MeshBasicNodeMaterial;
  private readonly ground = new Vector3();
  private readonly windowCentreScene: any = uniform(new Vector3());
  private readonly windowRadius: any;
  private count = 0;

  /** `bodyCentreScene` is the surface material's `morph.uBodyCentreScene` uniform node: the planet's centre in scene space. */
  constructor(
    private readonly config: ISurfaceInstancesConfig,
    binding: PlanetAtmosphereBinding,
    private readonly bodyCentreScene: any,
  ) {
    this.windowRadius = uniform(config.windowRadiusM);
    this.material = new MeshBasicNodeMaterial();
    const radial: any = normalize(positionWorld.sub(bodyCentreScene));
    // A pure up-vector would light every instance like the ground; lean 30 % on the face normal so a crown has a sunny side.
    const shading: any = normalize(radial.mul(0.7).add(normalize(normalWorld).mul(0.3)));
    const context = { sphereNormal: shading, radialDirection: radial, cameraDistance: positionView.length() };
    const lit = binding.lighting()(context, { color: config.albedo, sunVisibility: float(1), surface: { albedo: config.albedo }, emissive: null });
    this.material.colorNode = binding.perspective()(context, lit);
    this.material.alphaHash = true;
    const edge: any = float(1).sub(smoothstep(this.windowRadius.sub(config.windowFadeM), this.windowRadius, positionWorld.sub(this.windowCentreScene).length()));
    this.material.opacityNode = config.opacity(positionView.length()).mul(edge);

    this.mesh = new InstancedMesh(config.geometry, this.material, config.capacity);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  get instanceCount(): number {
    return this.count;
  }

  /** Radius of the window the dissolve is measured against; set it to the radius that was requested. */
  setWindowRadius(radiusM: number): void {
    this.windowRadius.value = radiusM;
  }

  /**
   * Places the scatter. `ground` is the body-fixed point under the scatter's centre at height 0 (metres): the
   * instances are offsets from it, so they stay small in float32.
   */
  setInstances(ground: Vector3, instances: Float32Array): void {
    this.ground.copy(ground);
    const n = Math.min(instances.length / SCATTER_STRIDE, this.mesh.instanceMatrix.count);
    const matrix = new Matrix4();
    const quaternion = new Quaternion();
    const yaw = new Quaternion();
    const up = new Vector3();
    const position = new Vector3();
    const scale = new Vector3();
    const y = new Vector3(0, 1, 0);
    for (let i = 0; i < n; i += 1) {
      const o = i * SCATTER_STRIDE;
      position.set(instances[o], instances[o + 1], instances[o + 2]);
      up.copy(position).add(ground).normalize();
      // Lift along the local up, so a rock sinks into the slope instead of the datum.
      position.addScaledVector(up, this.config.shape.liftM);
      quaternion.setFromUnitVectors(y, up);
      yaw.setFromAxisAngle(y, instances[o + 3] * Math.PI * 2);
      quaternion.multiply(yaw);
      const s = this.config.shape.scale(instances[o + 3]);
      scale.set(s, s, s);
      matrix.compose(position, quaternion, scale);
      this.mesh.setMatrixAt(i, matrix);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.count = n;
  }

  /** Follows the floating origin: the mesh sits at the body centre plus the scatter's ground point. Call every frame. */
  update(): void {
    this.mesh.position.copy(this.ground).add(this.bodyCentreScene.value);
    this.mesh.updateMatrixWorld();
    this.windowCentreScene.value.copy(this.mesh.position);
  }

  dispose(): void {
    this.config.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
